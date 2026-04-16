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
  const [error, setError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    fetch(`/api/users/${session.user.id}/password-policy`)
      .then((res) => res.json())
      .then((data) => {
        if (data.policy) setPolicy(data.policy);
      })
      .catch(() => {
        // Non-fatal — modal still works without policy display
      });
  }, [session?.user?.id]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError(t("validation.passwordsDoNotMatch"));
      return;
    }

    if (newPassword.length < 4) {
      setError(t("validation.newPasswordTooShort"));
      return;
    }

    if (!session?.user?.id) {
      setError(tCommon("errors.unauthenticated"));
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
          body: JSON.stringify({ currentPassword, newPassword }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || tCommon("errors.somethingWentWrong"));
      } else {
        toast.success(t("success.passwordChanged"));
        onClose();
      }
    } catch {
      setError(tCommon("errors.somethingWentWrong"));
    }
    setIsLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              {tGlobal("users.profile.changePasswordModal.buttonText")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {error && (
              <div className="text-destructive text-sm bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}
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
                <PasswordStrengthIndicator password={newPassword} policy={policy} />
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
              {isLoading
                ? tCommon("actions.submitting")
                : tGlobal("users.profile.changePasswordModal.buttonText")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
