"use client";

import { useState } from "react";
import { useRouter } from "~/lib/navigation";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Shield, Loader2 } from "lucide-react";
import svgIcon from "~/public/tpi_logo.svg";

export default function TwoFactorVerifyPage() {
  const router = useRouter();
  const { data: session, update: updateSession } = useSession();
  const t = useTranslations();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);

  async function handleVerify() {
    if (!verificationCode || verificationCode.length < 6) return;

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/two-factor/verify-sso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: verificationCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Verification failed");
      }

      // Update the session to mark 2FA as verified
      await updateSession({ twoFactorVerified: true });

      // Redirect to home
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSignOut() {
    // Sign out and redirect to signin
    const { signOut } = await import("next-auth/react");
    await signOut({ callbackUrl: "/signin" });
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
            {t("auth.twoFactorVerify.title")}
          </CardTitle>
          <CardDescription>
            {t("auth.twoFactorVerify.description")}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="p-3 mb-4 bg-destructive/10 border border-destructive rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {useBackupCode
                  ? t("auth.twoFactorVerify.backupCodeLabel")
                  : t("auth.twoFactorSetup.verifyLabel")}
              </label>
              {useBackupCode ? (
                <Input
                  type="text"
                  placeholder="XXXXXXXX"
                  value={verificationCode}
                  onChange={(e) =>
                    setVerificationCode(e.target.value.toUpperCase().slice(0, 8))
                  }
                  className="text-center text-lg tracking-widest font-mono"
                  autoComplete="one-time-code"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && verificationCode.length === 8) {
                      handleVerify();
                    }
                  }}
                />
              ) : (
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={6}
                    value={verificationCode}
                    onChange={(value) => setVerificationCode(value)}
                    onComplete={() => handleVerify()}
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
              )}
              <button
                type="button"
                onClick={() => {
                  setUseBackupCode(!useBackupCode);
                  setVerificationCode("");
                }}
                className="text-xs text-primary hover:underline w-full text-center"
              >
                {useBackupCode
                  ? t("auth.twoFactorVerify.useAuthenticator")
                  : t("auth.twoFactorVerify.useBackupCode")}
              </button>
            </div>

            <Button
              className="w-full"
              onClick={handleVerify}
              disabled={isLoading || verificationCode.length < (useBackupCode ? 8 : 6)}
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("common.actions.verify")}
            </Button>

            <div className="text-center">
              <Button variant="link" onClick={handleSignOut} className="text-sm">
                {t("auth.twoFactorVerify.signOut")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
