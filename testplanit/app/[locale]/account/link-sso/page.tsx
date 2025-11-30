"use client";

import { useState } from "react";
import { useRouter } from "~/lib/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { InfoIcon, CheckCircle2, Shield } from "lucide-react";
import { useFindManySsoProvider } from "~/lib/hooks";
import { siGoogle } from "simple-icons";

const GoogleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d={siGoogle.path} />
  </svg>
);

export default function LinkSSOPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const t = useTranslations();
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch available SSO providers
  const { data: ssoProviders } = useFindManySsoProvider({
    where: { enabled: true },
    include: { samlConfig: true },
  });

  const handleLinkProvider = async (provider: any) => {
    setLinking(provider.id);
    setError(null);

    try {
      if (provider.type === "GOOGLE") {
        // For Google OAuth, redirect to sign in with linking mode
        window.location.href = `/api/auth/signin?callbackUrl=${encodeURIComponent("/account/link-sso?linked=google")}`;
      } else if (provider.type === "SAML") {
        // For SAML, initiate SAML flow with linking parameter
        window.location.href = `/api/auth/saml?provider=${provider.samlConfig.id}&callbackUrl=${encodeURIComponent("/account/link-sso?linked=saml")}`;
      }
    } catch (err) {
      setError(t("account.linkSso.linkingFailed"));
      setLinking(null);
    }
  };

  // Check if we just completed linking
  const searchParams = new URLSearchParams(window.location.search);
  const linkedProvider = searchParams.get("linked");

  if (linkedProvider) {
    return (
      <div className="container max-w-2xl mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              {t("account.linkSso.accountLinked")}
            </CardTitle>
            <CardDescription>
              {t("account.linkSso.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push("/account/settings")}>
              {t("common.actions.back")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle>{t("account.linkSso.title")}</CardTitle>
          <CardDescription>{t("account.linkSso.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Alert>
            <InfoIcon className="h-4 w-4" />
            <AlertDescription>
              {t("account.linkSso.linkingInfo")}
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            {ssoProviders?.map((provider) => (
              <Card key={provider.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    {provider.type === "GOOGLE" ? (
                      <GoogleIcon className="h-6 w-6" />
                    ) : (
                      <Shield className="h-6 w-6" />
                    )}
                    <div>
                      <h4 className="font-medium">{provider.name}</h4>
                      <p className="text-sm text-muted-foreground">
                        {provider.type === "GOOGLE"
                          ? t("account.linkSso.signInWithGoogle")
                          : t("account.linkSso.enterpriseSamlSso")}
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => handleLinkProvider(provider)}
                    disabled={linking === provider.id || linking !== null}
                  >
                    {linking === provider.id
                      ? t("account.linkSso.linking")
                      : t("account.linkSso.linkProvider")}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {(!ssoProviders || ssoProviders.length === 0) && (
            <p className="text-center text-muted-foreground py-4">
              {t("account.linkSso.noProvidersContactAdmin")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
