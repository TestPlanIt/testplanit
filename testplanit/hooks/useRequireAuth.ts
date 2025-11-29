import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "~/lib/navigation";

/**
 * Hook that requires authentication. Redirects to signin if unauthenticated.
 * Returns the session and loading/auth states.
 *
 * Uses the localized router from next-intl to maintain the current locale.
 *
 * @example
 * ```tsx
 * const { session, isLoading } = useRequireAuth();
 *
 * if (isLoading) return <Loading />;
 * // At this point, session is guaranteed to exist
 * ```
 */
export function useRequireAuth() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      // Uses localized router - will redirect to /{locale}/signin
      router.push("/signin");
    }
  }, [status, router]);

  return {
    session,
    status,
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated",
  };
}
