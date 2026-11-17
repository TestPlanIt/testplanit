/**
 * Locale-stripped route prefixes that do not require a signed-in session.
 * Shared by the proxy (server-side gate) and the client-side session guard so
 * the two can never disagree about what counts as public.
 */
export const PUBLIC_ROUTES = [
  "/signin",
  "/signup",
  "/verify-email",
  "/trial-expired",
  "/auth/two-factor-setup",
  "/auth/two-factor-verify",
  "/share",
  "/passwordless",
] as const;

/** `pathWithoutLocale` is the pathname with its leading locale segment removed. */
export function isPublicPath(pathWithoutLocale: string): boolean {
  return PUBLIC_ROUTES.some(
    (route) =>
      pathWithoutLocale === route || pathWithoutLocale.startsWith(`${route}/`)
  );
}
