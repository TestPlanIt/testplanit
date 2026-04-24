"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PasswordStrengthIndicator,
  type PasswordPolicy,
} from "@/components/PasswordStrengthIndicator";
import {
  translatePolicyViolation,
  type PolicyViolation,
} from "~/lib/password-policy-messages";
import { KeyRound, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useState } from "react";
import svgIcon from "~/public/tpi_logo.svg";

export default function ForceChangePasswordPage() {
  const { data: session, update: updateSession } = useSession();
  const t = useTranslations();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);

  const reason = (session as any)?.mustChangePasswordReason;

  // Fetch policy requirements on mount (per D-05, CONTEXT specifics)
  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/users/${session.user.id}/password-policy`)
      .then((res) => res.json())
      .then((data) => {
        if (data.policy) setPolicy(data.policy);
      })
      .catch(() => {
        // Non-fatal — page still works, just without policy display
      });
  }, [session?.user?.id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);

    if (newPassword !== confirmPassword) {
      setErrors([t("auth.forceChangePassword.passwordsMustMatch")]);
      return;
    }

    if (!newPassword) {
      setErrors([t("auth.forceChangePassword.passwordRequired")]);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/users/${session?.user?.id}/force-change-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        // Policy violations come back as structured objects (GitHub #227) —
        // localize each with the shared helper.
        if (data.errors && Array.isArray(data.errors)) {
          setErrors(
            (data.errors as PolicyViolation[]).map((v) =>
              translatePolicyViolation(v, t)
            )
          );
        } else {
          setErrors([data.error || t("auth.forceChangePassword.genericError")]);
        }
        setIsLoading(false);
        return;
      }

      // Clear the mustChangePassword flag in JWT (per D-07)
      await updateSession({ mustChangePasswordCleared: true });

      // Hard redirect — window.location.href forces full page load,
      // ensuring middleware re-reads the updated JWT
      window.location.href = "/";
    } catch {
      setErrors([t("auth.forceChangePassword.genericError")]);
      setIsLoading(false);
    }
  }

  async function handleSignOut() {
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
            <KeyRound className="h-5 w-5" />
            {t("auth.forceChangePassword.title")}
          </CardTitle>
          <CardDescription>
            {reason === "expired"
              ? t("auth.forceChangePassword.expiredDescription")
              : t("auth.forceChangePassword.adminDescription")}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {errors.length > 0 && (
            <div className="p-3 mb-4 bg-destructive/10 border border-destructive rounded-md">
              {errors.map((err, i) => (
                <p key={i} className="text-sm text-destructive">
                  {err}
                </p>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">
                {t("auth.forceChangePassword.newPasswordLabel")}
              </Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
                autoComplete="new-password"
              />
              <PasswordStrengthIndicator
                password={newPassword}
                policy={policy}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">
                {t("auth.forceChangePassword.confirmPasswordLabel")}
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !newPassword || !confirmPassword}
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("auth.forceChangePassword.submitButton")}
            </Button>

            <div className="text-center">
              <Button
                variant="link"
                onClick={handleSignOut}
                className="text-sm"
                type="button"
              >
                {t("auth.forceChangePassword.signOut")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
