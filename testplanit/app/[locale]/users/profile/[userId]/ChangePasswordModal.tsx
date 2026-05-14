"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Asterisk } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
}

export function ChangePasswordModal({
  open,
  onClose,
}: ChangePasswordModalProps) {
  const t = useTranslations("users.profile.changePasswordModal");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  // Default true so existing users see the current-password field while loading.
  const [hasPassword, setHasPassword] = useState(true);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/users/${session.user.id}/password-policy`)
      .then((res) => res.json())
      .then((data) => {
        if (data.policy) setPolicy(data.policy);
        if (typeof data.hasPassword === "boolean")
          setHasPassword(data.hasPassword);
      })
      .catch(() => {
        // Non-fatal — modal still works without policy display
      });
  }, [session?.user?.id]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors([]);

    if (newPassword !== confirmPassword) {
      setErrors([t("validation.passwordsDoNotMatch")]);
      return;
    }

    const minLen = policy?.minPasswordLength ?? 8;
    if (newPassword.length < minLen) {
      setErrors([t("validation.newPasswordTooShort")]);
      return;
    }

    if (!session?.user?.id) {
      setErrors([tCommon("errors.unauthenticated")]);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/users/${session.user.id}/change-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            currentPassword: hasPassword ? currentPassword : undefined,
            newPassword,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        // Policy violations come back as structured objects (GitHub #227) —
        // localize each with the shared helper.
        if (Array.isArray(result.errors)) {
          setErrors(
            (result.errors as PolicyViolation[]).map((v) =>
              translatePolicyViolation(v, tGlobal)
            )
          );
        } else {
          setErrors([result.error || tCommon("errors.somethingWentWrong")]);
        }
      } else {
        toast.success(t("success.passwordChanged"));
        onClose();
      }
    } catch {
      setErrors([tCommon("errors.somethingWentWrong")]);
    }
    setIsLoading(false);
  };

  const titleKey = hasPassword
    ? "users.profile.changePasswordModal.buttonText"
    : "users.profile.changePasswordModal.setPasswordButtonText";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {tGlobal(titleKey)}
            </DialogTitle>
            <DialogDescription>
              {hasPassword ? t("description") : t("setPasswordDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {errors.length > 0 && (
              <div
                className="text-destructive text-sm bg-destructive/10 p-3 rounded-md"
                role="alert"
              >
                {errors.length === 1 ? (
                  errors[0]
                ) : (
                  <ul className="list-disc list-inside space-y-1">
                    {errors.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {hasPassword && (
              <div className="grid grid-cols-4 items-center gap-4 text-right">
                <Label htmlFor="currentPassword" className="flex justify-end">
                  {t("currentPasswordLabel")}
                  <sup>
                    <Asterisk className="w-3 h-3 text-destructive shrink-0" />
                  </sup>
                </Label>
                <Input
                  id="currentPassword"
                  type="password"
                  className="col-span-3"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="grid grid-cols-4 items-center gap-4 text-right">
              <Label htmlFor="newPassword" className="flex justify-end">
                {t("newPasswordLabel")}
                <sup>
                  <Asterisk className="w-3 h-3 text-destructive shrink-0" />
                </sup>
              </Label>
              <div className="col-span-3">
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <PasswordStrengthIndicator
                  password={newPassword}
                  policy={policy}
                />
              </div>
            </div>
            <div className="grid grid-cols-4 items-center gap-4 text-right">
              <Label htmlFor="confirmPassword" className="flex justify-end">
                {t("confirmPasswordLabel")}{" "}
                <sup>
                  <Asterisk className="w-3 h-3 text-destructive shrink-0" />
                </sup>
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                className="col-span-3"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? tCommon("actions.submitting") : tGlobal(titleKey)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
