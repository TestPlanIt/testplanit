"use client";

import { CheckCircle2, InfoIcon, Shield } from "lucide-react";
import { signIn, useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { siApple, siGoogle } from "simple-icons";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { useFindManySsoProvider } from "~/lib/hooks";
import { useRouter } from "~/lib/navigation";

const GoogleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d={siGoogle.path} />
  </svg>
);

const AppleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d={siApple.path} />
  </svg>
);

const MicrosoftIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M0 0h11.377v11.372H0zm12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623" />
  </svg>
);

export default function LinkSSOPage() {
  const router = useRouter();
  const t = useTranslations();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: allProviders } = useFindManySsoProvider({
    where: { enabled: true },
    include: { samlConfig: true },
  });
  // MAGIC_LINK is a login method, not a linkable identity provider
  const ssoProviders = allProviders?.filter((p) => p.type !== "MAGIC_LINK");

  const handleLinkProvider = async (provider: any) => {
    setLinking(provider.id);
    setError(null);

    try {
      if (provider.type === "GOOGLE") {
        await signIn("google", { callbackUrl: "/account/link-sso?linked=google" });
      } else if (provider.type === "APPLE") {
        await signIn("apple", { callbackUrl: "/account/link-sso?linked=apple" });
      } else if (provider.type === "MICROSOFT") {
        await signIn("azure-ad", { callbackUrl: "/account/link-sso?linked=microsoft" });
      } else if (provider.type === "SAML") {
        window.location.href = `/api/auth/saml/login/${provider.id}`;
      }
    } catch {
      setError(t("account.linkSso.linkingFailed"));
      setLinking(null);
    }
  };

  const linkedProvider = searchParams.get("linked");

  if (linkedProvider) {
    return (
      <div className="container max-w-2xl mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" />
              {t("account.linkSso.accountLinked")}
            </CardTitle>
            <CardDescription>
              {t("account.linkSso.description")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push(`/users/profile/${session?.user?.id}`)}>
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
                    ) : provider.type === "APPLE" ? (
                      <AppleIcon className="h-6 w-6" />
                    ) : provider.type === "MICROSOFT" ? (
                      <MicrosoftIcon className="h-6 w-6" />
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

          {allProviders && ssoProviders?.length === 0 && (
            <p className="text-center text-muted-foreground py-4">
              {t("account.linkSso.noProvidersContactAdmin")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
