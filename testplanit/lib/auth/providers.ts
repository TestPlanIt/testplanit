/** NextAuth provider id of the passkey (WebAuthn) sign-in. */
export const PASSKEY_PROVIDER_ID = "passkey";

/**
 * Whether a sign-in came through one of the app's own credential checks (the
 * password form or a passkey) rather than an identity provider or an emailed
 * link. These sign-ins are verified and audited inside their authorizer, keep
 * the account's sign-in method as it is, and are not sent on to a second
 * factor by the session callbacks: the password path enforces it before the
 * session exists, and a passkey is verified with the device's own check.
 */
export function isLocalCredentialProvider(
  provider: string | null | undefined
): boolean {
  return provider === "credentials" || provider === PASSKEY_PROVIDER_ID;
}
