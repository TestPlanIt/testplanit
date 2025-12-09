"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "~/lib/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Shield, Loader2, Copy, Check, AlertTriangle } from "lucide-react";
import svgIcon from "~/public/tpi_logo.svg";
import { Alert } from "~/components/ui/alert";

export default function TwoFactorSetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { update: updateSession } = useSession();
  const t = useTranslations();
  const token = searchParams.get("token");
  const isSsoFlow = searchParams.get("sso") === "true";

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"setup" | "verify" | "backup">("setup");

  // Setup state
  const [setupData, setSetupData] = useState<{
    secret: string;
    qrCode: string;
  } | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // For non-SSO flow, verify token is present
  useEffect(() => {
    if (!isSsoFlow && !token) {
      router.push("/signin");
    }
  }, [token, isSsoFlow, router]);

  const startSetup = useCallback(async () => {
    if (!token && !isSsoFlow) return;

    setIsLoading(true);
    setError("");
    try {
      // Use different endpoint for SSO flow vs credentials flow
      const endpoint = isSsoFlow
        ? "/api/auth/two-factor/setup"
        : "/api/auth/two-factor/setup-required";
      const body = isSsoFlow ? {} : { setupToken: token };

      const response = await fetch(endpoint, {
        method: isSsoFlow ? "GET" : "POST",
        headers: isSsoFlow ? {} : { "Content-Type": "application/json" },
        body: isSsoFlow ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to start 2FA setup");
      }
      setSetupData(data);
      setStep("verify");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start 2FA setup"
      );
    } finally {
      setIsLoading(false);
    }
  }, [token, isSsoFlow]);

  // Start setup automatically
  useEffect(() => {
    if ((token || isSsoFlow) && !setupData) {
      startSetup();
    }
  }, [token, isSsoFlow, setupData, startSetup]);

  async function completeSetup() {
    if (!verificationCode || verificationCode.length < 6) return;
    if (!isSsoFlow && !token) return;

    setIsLoading(true);
    setError("");
    try {
      // Use different endpoint for SSO flow vs credentials flow
      const endpoint = isSsoFlow
        ? "/api/auth/two-factor/enable"
        : "/api/auth/two-factor/enable-required";
      const body = isSsoFlow
        ? { token: verificationCode }
        : { token: verificationCode, setupToken: token };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to enable 2FA");
      }
      setBackupCodes(data.backupCodes);
      setStep("backup");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable 2FA");
    } finally {
      setIsLoading(false);
    }
  }

  async function completeSignIn() {
    setIsLoading(true);

    if (isSsoFlow) {
      // For SSO flow, update session to mark 2FA setup as complete
      await updateSession({ twoFactorSetupComplete: true });
      router.push("/");
    } else {
      // For credentials flow, redirect to sign in
      router.push("/signin");
    }
  }

  function copyBackupCodes() {
    if (!backupCodes) return;
    navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  }

  if (!token && !isSsoFlow) {
    return null;
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center mb-4">
            <Image
              alt="TestPlanIt Logo"
              src={svgIcon}
              style={{ width: "40px", height: "auto" }}
              priority={true}
            />
          </div>
          <CardTitle className="flex items-center justify-center gap-2">
            <Shield className="h-5 w-5" />
            {t("auth.twoFactorSetup.title")}
          </CardTitle>
          <CardDescription>
            {step === "backup"
              ? t("auth.twoFactorSetup.backupDescription")
              : t("auth.twoFactorSetup.description")}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Warning banner */}
          {step !== "backup" && (
            <Alert
              variant="destructive"
              className="flex items-start gap-3 p-3 mb-4 border rounded-lg"
            >
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <p className="text-sm">{t("auth.twoFactorSetup.required")}</p>
            </Alert>
          )}

          {error && (
            <div className="p-3 mb-4 bg-destructive/10 border border-destructive rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {step === "setup" && (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p className="text-muted-foreground">
                {t("auth.twoFactorSetup.loading")}
              </p>
            </div>
          )}

          {step === "verify" && setupData && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-4">
                <div className="bg-white p-2 rounded-lg">
                  <Image
                    src={setupData.qrCode}
                    alt="2FA QR Code"
                    width={180}
                    height={180}
                  />
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("auth.twoFactorSetup.manualEntry")}
                  </p>
                  <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                    {setupData.secret}
                  </code>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {t("auth.twoFactorSetup.verifyLabel")}
                </label>
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={verificationCode}
                    onChange={(value) => setVerificationCode(value)}
                    onComplete={() => completeSetup()}
                    autoFocus
                  >
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
              </div>

              <Button
                className="w-full"
                onClick={completeSetup}
                disabled={isLoading || verificationCode.length < 6}
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("auth.twoFactorSetup.verify")}
              </Button>
            </div>
          )}

          {step === "backup" && backupCodes && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                {t("auth.twoFactorSetup.backupCodesInfo")}
              </p>

              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((code, index) => (
                  <code
                    key={index}
                    className="bg-muted px-3 py-2 rounded text-center font-mono text-sm"
                  >
                    {code}
                  </code>
                ))}
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={copyBackupCodes}
              >
                {copiedCodes ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    {t("common.actions.copied")}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    {t("auth.twoFactorSetup.copyCodes")}
                  </>
                )}
              </Button>

              <Separator />

              <Button
                className="w-full"
                onClick={completeSignIn}
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("auth.twoFactorSetup.continue")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
