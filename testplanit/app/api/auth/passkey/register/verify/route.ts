import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { completePasskeyRegistration } from "~/lib/passkey";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { db } from "~/server/db";
import { requirePasskeyRegistrationUser } from "../guard";

const RequestSchema = z.object({
  // Its shape is checked where the answer is verified.
  response: z.unknown().optional(),
  challengeToken: z.string().min(1).max(4096),
  name: z.string().trim().min(1).max(100),
});

const FAILURES = {
  malformed: {
    status: 400,
    errorCode: "users.profile.passkeys.errors.registrationFailed",
    error: "The passkey could not be registered",
  },
  challenge_invalid: {
    status: 400,
    errorCode: "users.profile.passkeys.errors.registrationFailed",
    error: "The passkey request expired. Please try again.",
  },
  verification_failed: {
    status: 400,
    errorCode: "users.profile.passkeys.errors.registrationFailed",
    error: "The passkey could not be verified",
  },
  duplicate: {
    status: 409,
    errorCode: "users.profile.passkeys.errors.alreadyRegistered",
    error: "This passkey is already registered",
  },
  limit_reached: {
    status: 409,
    errorCode: "users.profile.passkeys.errors.limitReached",
    error: "This account already has the maximum number of passkeys",
  },
} as const;

/**
 * POST /api/auth/passkey/register/verify
 *
 * Finish adding a passkey: check the browser's answer to the challenge issued
 * by register/options and store the new key. The challenge token is bound to
 * the user and can be spent once, so reaching this point means the password
 * (and authenticator code) check there was passed.
 */
const handlePOST = withAuditContext(async (request: NextRequest) => {
  try {
    const guard = await requirePasskeyRegistrationUser(request);
    if ("response" in guard) return guard.response;
    const { user } = guard;

    let body: z.infer<typeof RequestSchema>;
    try {
      body = RequestSchema.parse(await request.json());
    } catch {
      const { status, ...payload } = FAILURES.malformed;
      return NextResponse.json(payload, { status });
    }

    const result = await completePasskeyRegistration(db, {
      userId: user.id,
      response: body.response,
      challengeToken: body.challengeToken,
      name: body.name,
    });
    if (!result.ok) {
      const { status, ...payload } = FAILURES[result.reason];
      return NextResponse.json(payload, { status });
    }

    await captureAuditEvent({
      action: "PASSKEY_REGISTERED",
      entityType: "Passkey",
      entityId: result.passkey.id,
      entityName: result.passkey.name,
      userId: user.id,
      userEmail: user.email,
      userName: user.name || undefined,
    });

    return NextResponse.json(result.passkey, { status: 201 });
  } catch (error) {
    console.error("Passkey registration error:", error);
    return NextResponse.json(
      { error: "Failed to register the passkey" },
      { status: 500 }
    );
  }
});

export const POST = withRequestRouting(handlePOST);
