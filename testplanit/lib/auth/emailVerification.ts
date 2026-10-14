/**
 * Whether an account must confirm its email address before it may sign in:
 * a password account whose address is still unconfirmed. Accounts from SSO
 * or SCIM are confirmed by their identity provider.
 */
export function needsEmailVerification(user: {
  emailVerified: Date | string | null;
  authMethod: string | null;
}): boolean {
  return (
    !user.emailVerified &&
    (user.authMethod === "INTERNAL" || user.authMethod === null)
  );
}
