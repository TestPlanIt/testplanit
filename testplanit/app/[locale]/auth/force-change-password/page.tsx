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
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "~/lib/navigation";
import svgIcon from "~/public/tpi_logo.svg";

interface PasswordPolicy {
  minPasswordLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requiredSpecialChars: string | null;
}

export default function ForceChangePasswordPage() {
  const router = useRouter();
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
        if (data.errors && Array.isArray(data.errors)) {
          setErrors(data.errors);
        } else {
          setErrors([data.error || t("auth.forceChangePassword.genericError")]);
        }
        return;
      }

      // Clear the mustChangePassword flag in JWT (per D-07)
      await updateSession({ mustChangePasswordCleared: true });

      // Redirect to app home — no forced re-login
      router.push("/");
    } catch {
      setErrors([t("auth.forceChangePassword.genericError")]);
    } finally {
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
          {/* Policy requirements display (per D-05, CONTEXT specifics) */}
          {policy && (
            <div className="p-3 mb-4 bg-muted rounded-md">
              <p className="text-sm font-medium mb-2">
                {t("auth.forceChangePassword.policyTitle")}
              </p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  {t("auth.forceChangePassword.policyMinLength", {
                    count: policy.minPasswordLength,
                  })}
                </li>
                {policy.requireUppercase && (
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    {t("auth.forceChangePassword.policyUppercase")}
                  </li>
                )}
                {policy.requireLowercase && (
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    {t("auth.forceChangePassword.policyLowercase")}
                  </li>
                )}
                {policy.requireNumbers && (
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    {t("auth.forceChangePassword.policyNumbers")}
                  </li>
                )}
                {policy.requiredSpecialChars && (
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    {t("auth.forceChangePassword.policySpecialChars", {
                      chars: policy.requiredSpecialChars,
                    })}
                  </li>
                )}
              </ul>
            </div>
          )}

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
