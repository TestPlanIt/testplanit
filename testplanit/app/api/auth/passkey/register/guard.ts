import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import {
  canUsePasskeys,
  getPasskeyAvailability,
  isPasskeyOrigin,
} from "~/lib/passkey";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";

export interface PasskeyRegistrationUser {
  id: string;
  email: string;
  name: string | null;
  password: string | null;
  twoFactorEnabled: boolean;
  twoFactorSecret: string | null;
}

/**
 * Shared gate for the two passkey registration routes. Resolves the signed-in
 * user, or the response to send instead.
 *
 * Routes under /api/auth are not covered by the proxy's sign-in gates, so a
 * session that still owes a second factor or a forced password change is
 * turned away here: a passkey stands in for both factors at sign-in and must
 * not be obtainable with only one of them.
 */
export async function requirePasskeyRegistrationUser(
  request: NextRequest
): Promise<{ user: PasskeyRegistrationUser } | { response: NextResponse }> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  if (
    !token ||
    (token.twoFactorRequired && !token.twoFactorVerified) ||
    token.twoFactorSetupRequired ||
    token.mustChangePassword
  ) {
    return {
      response: NextResponse.json(
        { error: "Finish signing in before adding a passkey" },
        { status: 403 }
      ),
    };
  }

  const availability = await getPasskeyAvailability(db);
  if (!availability.available) {
    return {
      response: NextResponse.json(
        {
          errorCode: "users.profile.passkeys.errors.unavailable",
          error: "Passkeys are not available",
        },
        { status: 403 }
      ),
    };
  }
  if (!isPasskeyOrigin(request.headers.get("origin"))) {
    return {
      response: NextResponse.json(
        {
          errorCode: "auth.signin.passkey.addressMismatch",
          error:
            "Passkeys are set up for a different address than the one in your browser",
        },
        { status: 409 }
      ),
    };
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      isActive: true,
      isDeleted: true,
      authMethod: true,
      password: true,
      twoFactorEnabled: true,
      twoFactorSecret: true,
    },
  });
  if (!user || !user.isActive || user.isDeleted) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!canUsePasskeys(user.authMethod)) {
    return {
      response: NextResponse.json(
        {
          errorCode: "users.profile.passkeys.errors.unavailable",
          error: "Passkeys are not available for this account",
        },
        { status: 403 }
      ),
    };
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      password: user.password,
      twoFactorEnabled: user.twoFactorEnabled,
      twoFactorSecret: user.twoFactorSecret,
    },
  };
}
