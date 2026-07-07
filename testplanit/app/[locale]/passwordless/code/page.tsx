import { getTranslations } from "next-intl/server";
import { KeyRound } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { Locale } from "~/i18n/navigation";
import { redirect } from "~/lib/navigation";
import {
  formatPasswordlessCode,
  isValidPasswordlessCodeFormat,
  normalizePasswordlessCode,
} from "~/lib/passwordless";

/**
 * Cross-device landing page for the device-bound passwordless flow.
 *
 * Shown when the emailed link is opened in a browser that does not hold the
 * verifier cookie (another device, incognito, an email app's webview — or a
 * mail-security scanner). Displays the relay code for the user to enter in
 * their original window. Renders only; nothing is consumed, so a scanner
 * fetching this any number of times changes no state.
 *
 * The callback route validated the code against the pending row's hash before
 * redirecting here; this page re-checks the format so it can never echo
 * arbitrary query content.
 */
export default async function PasswordlessCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { locale } = await params;
  const { code: rawCode } = await searchParams;
  const t = await getTranslations({ locale });

  const code = normalizePasswordlessCode(rawCode ?? "");
  if (!isValidPasswordlessCodeFormat(code)) {
    redirect({ href: "/passwordless/expired", locale });
  }

  return (
    <div className="flex items-center justify-center py-16">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold">
            {t("auth.passwordless.codeTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("auth.passwordless.codeInstructions")}
          </p>
          <p
            className="rounded-md bg-muted px-6 py-3 font-mono text-3xl font-bold tracking-[0.3em]"
            data-testid="passwordless-code-display"
          >
            {formatPasswordlessCode(code)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("auth.passwordless.codeCloseNotice")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
