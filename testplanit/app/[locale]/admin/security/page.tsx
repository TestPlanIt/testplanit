"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Shield } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useCountUser,
  useFindFirstRegistrationSettings,
} from "~/lib/hooks";

export default function SecurityAdminPage() {
  const { data: session } = useSession();
  const t = useTranslations("admin.security");
  const tCommon = useTranslations("common");

  const { data: settings, refetch } = useFindFirstRegistrationSettings();

  const { data: affectedCount } = useCountUser({
    where: {
      authMethod: { in: ["INTERNAL", "BOTH"] },
      mustChangePassword: false,
      isDeleted: false,
      isActive: true,
    },
  });

  // Local state for all policy fields
  const [minPasswordLength, setMinPasswordLength] = useState<number>(12);
  const [requireUppercase, setRequireUppercase] = useState<boolean>(false);
  const [requireLowercase, setRequireLowercase] = useState<boolean>(false);
  const [requireNumbers, setRequireNumbers] = useState<boolean>(false);
  const [requiredSpecialChars, setRequiredSpecialChars] = useState<string>("");
  const [passwordHistoryDepth, setPasswordHistoryDepth] = useState<number>(0);
  const [passwordExpirationDays, setPasswordExpirationDays] =
    useState<number>(0);
  const [lockoutThreshold, setLockoutThreshold] = useState<number>(5);
  const [lockoutDurationMinutes, setLockoutDurationMinutes] =
    useState<number>(15);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [showForceAllDialog, setShowForceAllDialog] = useState<boolean>(false);
  const [isForcing, setIsForcing] = useState<boolean>(false);

  // Sync fetched settings into local state
  useEffect(() => {
    if (settings) {
      setMinPasswordLength(settings.minPasswordLength ?? 12);
      setRequireUppercase(settings.requireUppercase ?? false);
      setRequireLowercase(settings.requireLowercase ?? false);
      setRequireNumbers(settings.requireNumbers ?? false);
      setRequiredSpecialChars(settings.requiredSpecialChars ?? "");
      setPasswordHistoryDepth(settings.passwordHistoryDepth ?? 0);
      setPasswordExpirationDays(settings.passwordExpirationDays ?? 0);
      setLockoutThreshold(settings.lockoutThreshold ?? 5);
      setLockoutDurationMinutes(settings.lockoutDurationMinutes ?? 15);
    }
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/admin/registration-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minPasswordLength,
          requireUppercase,
          requireLowercase,
          requireNumbers,
          requiredSpecialChars: requiredSpecialChars || null,
          passwordHistoryDepth,
          passwordExpirationDays,
          lockoutThreshold,
          lockoutDurationMinutes,
        }),
      });
      if (response.ok) {
        toast.success(t("saved"));
        refetch();
      } else {
        toast.error(t("saveFailed"));
      }
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleForceAll = async () => {
    setIsForcing(true);
    try {
      const response = await fetch(
        "/api/admin/users/bulk-force-change-password",
        { method: "POST" }
      );
      if (response.ok) {
        const data = await response.json();
        toast.success(t("forceAllSuccess", { count: data.count }));
        setShowForceAllDialog(false);
      } else {
        toast.error(t("forceAllFailed"));
      }
    } catch {
      toast.error(t("forceAllFailed"));
    } finally {
      setIsForcing(false);
    }
  };

  if (session?.user?.access !== "ADMIN") {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="pt-4">
        <h1 className="flex items-center text-primary text-2xl md:text-4xl font-bold">
          <Shield className="inline mr-2 h-8 w-8" />
          <span>{t("title")}</span>
        </h1>
        <p className="text-muted-foreground mt-1">{t("description")}</p>
      </div>

      <Card>
        <CardContent className="space-y-8 pt-6">
          {/* Section 1: Password Policy */}
          <div className="space-y-4">
            <div>
              <CardTitle className="text-lg">{t("passwordPolicyTitle")}</CardTitle>
              <CardDescription className="mt-1">
                {t("passwordPolicyDescription")}
              </CardDescription>
            </div>

            {/* Min Password Length */}
            <div className="space-y-2">
              <Label htmlFor="minPasswordLength">
                {t("minPasswordLengthLabel")}
              </Label>
              <Input
                id="minPasswordLength"
                type="number"
                min={8}
                max={128}
                value={minPasswordLength}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setMinPasswordLength(Math.max(8, Math.min(128, val)));
                  }
                }}
                className="max-w-xs"
              />
              <p className="text-sm text-muted-foreground">
                {t("minPasswordLengthDescription")}
              </p>
            </div>

            {/* Require Uppercase */}
            <div className="flex items-center justify-between">
              <Label htmlFor="requireUppercase">
                {t("requireUppercaseLabel")}
              </Label>
              <Switch
                id="requireUppercase"
                checked={requireUppercase}
                onCheckedChange={setRequireUppercase}
              />
            </div>

            {/* Require Lowercase */}
            <div className="flex items-center justify-between">
              <Label htmlFor="requireLowercase">
                {t("requireLowercaseLabel")}
              </Label>
              <Switch
                id="requireLowercase"
                checked={requireLowercase}
                onCheckedChange={setRequireLowercase}
              />
            </div>

            {/* Require Numbers */}
            <div className="flex items-center justify-between">
              <Label htmlFor="requireNumbers">{t("requireNumbersLabel")}</Label>
              <Switch
                id="requireNumbers"
                checked={requireNumbers}
                onCheckedChange={setRequireNumbers}
              />
            </div>

            {/* Required Special Chars */}
            <div className="space-y-2">
              <Label htmlFor="requiredSpecialChars">
                {t("requiredSpecialCharsLabel")}
              </Label>
              <Input
                id="requiredSpecialChars"
                value={requiredSpecialChars}
                onChange={(e) => setRequiredSpecialChars(e.target.value)}
                className="max-w-xs"
              />
              <p className="text-sm text-muted-foreground">
                {t("requiredSpecialCharsDescription")}
              </p>
            </div>

            {/* Password History Depth */}
            <div className="space-y-2">
              <Label htmlFor="passwordHistoryDepth">
                {t("passwordHistoryDepthLabel")}
              </Label>
              <Input
                id="passwordHistoryDepth"
                type="number"
                min={0}
                max={24}
                value={passwordHistoryDepth}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setPasswordHistoryDepth(Math.max(0, Math.min(24, val)));
                  }
                }}
                className="max-w-xs"
              />
              <p className="text-sm text-muted-foreground">
                {t("passwordHistoryDepthDescription")}
              </p>
            </div>

            {/* Password Expiration Days */}
            <div className="space-y-2">
              <Label htmlFor="passwordExpirationDays">
                {t("passwordExpirationDaysLabel")}
              </Label>
              <Input
                id="passwordExpirationDays"
                type="number"
                min={0}
                value={passwordExpirationDays}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setPasswordExpirationDays(Math.max(0, Math.min(9999, val)));
                  }
                }}
                className="max-w-xs"
              />
              <p className="text-sm text-muted-foreground">
                {t("passwordExpirationDaysDescription")}
              </p>
            </div>
          </div>

          <Separator />

          {/* Section 2: Lockout Policy */}
          <div className="space-y-4">
            <div>
              <CardTitle className="text-lg">{t("lockoutPolicyTitle")}</CardTitle>
              <CardDescription className="mt-1">
                {t("lockoutPolicyDescription")}
              </CardDescription>
            </div>

            {/* Lockout Threshold */}
            <div className="space-y-2">
              <Label htmlFor="lockoutThreshold">
                {t("lockoutThresholdLabel")}
              </Label>
              <Input
                id="lockoutThreshold"
                type="number"
                min={1}
                value={lockoutThreshold}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setLockoutThreshold(Math.max(1, Math.min(999, val)));
                  }
                }}
                className="max-w-xs"
              />
              <p className="text-sm text-muted-foreground">
                {t("lockoutThresholdDescription")}
              </p>
            </div>

            {/* Lockout Duration Minutes */}
            <div className="space-y-2">
              <Label htmlFor="lockoutDurationMinutes">
                {t("lockoutDurationMinutesLabel")}
              </Label>
              <Input
                id="lockoutDurationMinutes"
                type="number"
                min={1}
                value={lockoutDurationMinutes}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setLockoutDurationMinutes(Math.max(1, Math.min(9999, val)));
                  }
                }}
                className="max-w-xs"
              />
              <p className="text-sm text-muted-foreground">
                {t("lockoutDurationMinutesDescription")}
              </p>
            </div>
          </div>

          <Separator />

          {/* Section 3: Enforcement Actions */}
          <div className="space-y-4">
            <div>
              <CardTitle className="text-lg">{t("enforcementTitle")}</CardTitle>
              <CardDescription className="mt-1">
                {t("enforcementDescription")}
              </CardDescription>
            </div>

            <Button
              variant="destructive"
              onClick={() => setShowForceAllDialog(true)}
            >
              {t("forceAllUsers")}
            </Button>
          </div>

          <Separator />

          {/* Save Button */}
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isSaving}>
              {t("saveChanges")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Force All Users Dialog */}
      <Dialog open={showForceAllDialog} onOpenChange={setShowForceAllDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t("forceAllUsersDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("forceAllUsersDialogDescription", {
                count: affectedCount ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-destructive font-semibold">
              {t("forceAllUsersDialogWarning")}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowForceAllDialog(false)}
              disabled={isForcing}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleForceAll}
              disabled={isForcing}
            >
              {t("forceAllUsersDialogConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
