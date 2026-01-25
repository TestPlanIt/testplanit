"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff, Lock, Loader2, AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

interface PasswordDialogProps {
  shareKey: string;
  projectName: string;
  onSuccess: (token: string, expiresIn: number) => void;
}

export function PasswordDialog({
  shareKey,
  projectName,
  onSuccess,
}: PasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);

  const t = useTranslations("reports.passwordDialog");
  const tCommon = useTranslations("common");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password) {
      setError(t("errors.emptyPassword"));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/share/${shareKey}/password-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          const resetAt = data.resetAt ? new Date(data.resetAt).toLocaleTimeString() : null;
          setError(
            t("errors.tooManyAttempts", { resetAt: resetAt || "" })
          );
        } else {
          setError(data.error || tCommon("errors.invalidCredentials"));
          if (data.remainingAttempts !== undefined) {
            setRemainingAttempts(data.remainingAttempts);
          }
        }
        setPassword("");
        return;
      }

      // Success
      onSuccess(data.token, data.expiresIn);
    } catch (error) {
      console.error("Error verifying password:", error);
      setError(t("errors.genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {t.rich("description", {
              projectName,
              strong: (chunks: React.ReactNode) => (
                <strong className="font-semibold">{chunks}</strong>
              ),
            })}
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {remainingAttempts !== null && remainingAttempts <= 2 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {remainingAttempts === 0
                    ? t("attempts.noAttemptsRemaining")
                    : t("attempts.attemptsRemaining", { count: remainingAttempts })}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">{tCommon("fields.password")}</Label>
              <div className="relative">
                <Input
                  data-testid="password-gate-input"
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  disabled={isLoading}
                  className="pr-10"
                  autoFocus
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  disabled={isLoading}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="sr-only">
                    {showPassword ? t("hidePassword") : t("showPassword")}
                  </span>
                </Button>
              </div>
            </div>
          </CardContent>

          <CardFooter>
            <Button data-testid="password-gate-submit" type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("verifying")}
                </>
              ) : (
                tCommon("actions.submit")
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
