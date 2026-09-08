"use client";

import { Loading } from "@/components/Loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { INTEGRATION_AUTH_COMPLETE_MESSAGE_TYPE } from "~/lib/integrations/oauthPopup";

// Landing page for the per-user integration OAuth flow. The OAuth callback
// redirects here (via the returnUrl stored with the OAuth state) because this
// is a page every signed-in user can view — the settings pages the flow used
// to land on are restricted to admins.
function AuthCompleteContent() {
  const t = useTranslations("issues.authComplete");
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const success = !error && searchParams.get("success") === "connected";

  useEffect(() => {
    // Tell the dialog that opened this popup the flow finished so it can
    // clear its auth-required state, then close the popup.
    window.opener?.postMessage(
      { type: INTEGRATION_AUTH_COMPLETE_MESSAGE_TYPE, success },
      window.location.origin
    );
    if (success) {
      const timer = setTimeout(() => window.close(), 1500);
      return () => clearTimeout(timer);
    }
  }, [success]);

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {success ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive" />
            )}
            {success ? t("successTitle") : t("errorTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-muted-foreground">
            {success ? t("successDescription") : t("errorDescription")}
          </p>
          {error && (
            <p className="text-xs text-muted-foreground font-mono break-all">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function IntegrationAuthCompletePage() {
  return (
    <Suspense fallback={<Loading />}>
      <AuthCompleteContent />
    </Suspense>
  );
}
