"use client";

import { getSession, signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link, useRouter } from "~/lib/navigation";

/**
 * Same-browser completion for the device-bound passwordless flow.
 *
 * The link callback redirects here only after confirming this browser holds
 * the verifier cookie for the pending sign-in. Completion goes through
 * NextAuth's passwordless-complete credentials provider (signIn handles the
 * CSRF token), which atomically consumes the PendingAuth row and mints the
 * session — the one-click path for the common case.
 */
export default function PasswordlessCompletePage() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const pendingId = searchParams.get("pid") ?? "";
    const linkToken = searchParams.get("token") ?? "";
    const rawCallbackUrl = searchParams.get("callbackUrl") ?? "/";
    const callbackUrl =
      rawCallbackUrl.startsWith("/") && !rawCallbackUrl.startsWith("//")
        ? rawCallbackUrl
        : "/";

    const finish = async () => {
      const session = await getSession();
      if (session?.user?.preferences?.locale) {
        const urlLocale = session.user.preferences.locale.replace("_", "-");
        document.cookie = `NEXT_LOCALE=${urlLocale};path=/;max-age=31536000`;
      }
      router.push(callbackUrl);
    };

    void (async () => {
      const result = await signIn("passwordless-complete", {
        redirect: false,
        pendingId,
        linkToken,
      });

      if (result?.ok) {
        await finish();
        return;
      }

      // A remount (e.g. React strict mode) can re-run this effect after the
      // row was already consumed; if a session exists the sign-in succeeded.
      const session = await getSession();
      if (session?.user) {
        await finish();
        return;
      }

      switch (result?.error) {
        case "PASSWORDLESS_EXPIRED":
          setError(t("auth.signin.passwordless.codeExpired"));
          break;
        case "PASSWORDLESS_LOCKED":
          setError(t("auth.signin.passwordless.tooManyAttempts"));
          break;
        case "PASSWORDLESS_NO_VERIFIER":
          setError(t("auth.signin.passwordless.windowLost"));
          break;
        default:
          setError(t("auth.signin.passwordless.genericError"));
      }
    })();
  }, [searchParams, router, t]);

  return (
    <div className="flex items-center justify-center py-16">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {error === null ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">
                {t("auth.passwordless.completingSignIn")}
              </p>
            </>
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <h2 className="text-lg font-semibold">
                {t("auth.passwordless.completeErrorTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button asChild className="mt-2">
                <Link href="/signin">
                  {t("auth.passwordless.requestNewLink")}
                </Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
