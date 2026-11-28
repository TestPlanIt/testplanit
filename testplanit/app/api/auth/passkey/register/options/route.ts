import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { verifyCurrentPassword } from "~/lib/auth/verifyCurrentPassword";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { buildPasskeyRegistrationOptions } from "~/lib/passkey";
import { auditAuthEvent } from "~/lib/services/auditLog";
import { decryptSecret, verifyTOTP } from "~/lib/two-factor";
import { db } from "~/server/db";
import { requirePasskeyRegistrationUser } from "../guard";

const RequestSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  totpCode: z.string().max(16).optional(),
});

/**
 * POST /api/auth/passkey/register/options
 *
 * Start adding a passkey. A passkey replaces both the password and the
 * authenticator code at sign-in, so the user proves both here first; only then
 * is a registration challenge issued.
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
      return NextResponse.json(
        {
          errorCode: "users.profile.passkeys.errors.invalidPassword",
          error: "Current password is required",
        },
        { status: 400 }
      );
    }

    const passwordCheck = await verifyCurrentPassword(
      user.id,
      user.password,
      body.currentPassword
    );
    if (passwordCheck === "not_set") {
      return NextResponse.json(
        {
          errorCode: "users.profile.passkeys.errors.passwordNotSet",
          error: "Set a password before adding a passkey",
        },
        { status: 409 }
      );
    }
    if (passwordCheck === "rate_limited") {
      return NextResponse.json(
        {
          errorCode: "users.profile.passkeys.errors.tooManyAttempts",
          error: "Too many attempts. Please try again later.",
        },
        { status: 429 }
      );
    }
    if (passwordCheck === "invalid") {
      auditAuthEvent("LOGIN_FAILED", user.id, user.email, {
        provider: "passkey",
        reason: "passkey_step_up_password",
      }).catch(console.error);
      return NextResponse.json(
        {
          errorCode: "users.profile.passkeys.errors.invalidPassword",
          error: "Invalid current password",
        },
        { status: 400 }
      );
    }

    if (user.twoFactorEnabled) {
      const codeIsValid =
        !!user.twoFactorSecret &&
        !!body.totpCode &&
        (await verifyTOTP(body.totpCode, decryptSecret(user.twoFactorSecret)));
      if (!codeIsValid) {
        auditAuthEvent("LOGIN_FAILED", user.id, user.email, {
          provider: "passkey",
          reason: "passkey_step_up_totp",
        }).catch(console.error);
        return NextResponse.json(
          {
            errorCode: "auth.errors.invalid2FACode",
            error: "Invalid verification code",
          },
          { status: 400 }
        );
      }
    }

    const result = await buildPasskeyRegistrationOptions(db, user);
    if (!result.ok) {
      return NextResponse.json(
        {
          errorCode: "users.profile.passkeys.errors.limitReached",
          error: "This account already has the maximum number of passkeys",
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      options: result.options,
      challengeToken: result.challengeToken,
    });
  } catch (error) {
    console.error("Passkey registration options error:", error);
    return NextResponse.json(
      { error: "Failed to start passkey registration" },
      { status: 500 }
    );
  }
});

export const POST = withRequestRouting(handlePOST);
