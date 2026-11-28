import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";

/**
 * Short-lived tokens the sign-in flows hand to the browser between steps.
 * They share one secret, so each names its step as the audience and is
 * accepted only there.
 */
export type SignInTokenPurpose =
  "saml-complete" | "saml-relay" | "two-factor-pending" | "two-factor-setup";

const ALGORITHM = "HS256";

function secret(): string {
  return process.env.NEXTAUTH_SECRET || "";
}

export function signSignInToken(
  purpose: SignInTokenPurpose,
  claims: object,
  options: { expiresIn: SignOptions["expiresIn"]; jwtid?: string }
): string {
  return jwt.sign(claims, secret(), {
    algorithm: ALGORITHM,
    audience: purpose,
    expiresIn: options.expiresIn,
    ...(options.jwtid ? { jwtid: options.jwtid } : {}),
  });
}

/** The token's claims, or null unless it is valid and minted for `purpose`. */
export function verifySignInToken<T extends object>(
  purpose: SignInTokenPurpose,
  token: string
): (T & JwtPayload) | null {
  try {
    return jwt.verify(token, secret(), {
      algorithms: [ALGORITHM],
      audience: purpose,
    }) as T & JwtPayload;
  } catch {
    return null;
  }
}
