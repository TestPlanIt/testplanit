"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { Slider } from "@/components/ui/slider";
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
  useFindManySsoProvider,
  useUpdateSsoProvider,
  useUpsertRegistrationSettings,
} from "~/lib/hooks";

export default function SecurityAdminPage() {
  const { data: session } = useSession();
  const t = useTranslations("admin.security");
  const tCommon = useTranslations("common");

  const { data: settings, refetch } = useFindFirstRegistrationSettings();
  const { data: ssoProviders, refetch: refetchSsoProviders } =
    useFindManySsoProvider();
  const { mutateAsync: updateSsoProvider } = useUpdateSsoProvider();
  const { mutateAsync: upsertSettings } = useUpsertRegistrationSettings();

  const { data: affectedCount } = useCountUser({
    where: {
      authMethod: { in: ["INTERNAL", "BOTH"] },
      mustChangePassword: false,
      isDeleted: false,
      isActive: true,
    },
  });

  // Sign-in enforcement toggles (forceSso lives per-provider, force2FA* on
  // RegistrationSettings).
  const [forceSso, setForceSso] = useState<boolean>(false);
  const [force2FANonSSO, setForce2FANonSSO] = useState<boolean>(false);
  const [force2FAAllLogins, setForce2FAAllLogins] = useState<boolean>(false);

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
      setForce2FANonSSO(settings.force2FANonSSO ?? false);
      setForce2FAAllLogins(settings.force2FAAllLogins ?? false);
    }
  }, [settings]);

  useEffect(() => {
    if (ssoProviders) {
      setForceSso(ssoProviders.some((p) => p.forceSso));
    }
  }, [ssoProviders]);

  const handleToggleForceSso = async (enabled: boolean) => {
    setForceSso(enabled);
    try {
      await Promise.all(
        (ssoProviders ?? []).map((provider) =>
          updateSsoProvider({
            where: { id: provider.id },
            data: { forceSso: enabled },
          })
        )
      );
      toast.success(enabled ? t("forceSsoEnabled") : t("forceSsoDisabled"));
      void refetchSsoProviders();
    } catch {
      setForceSso(!enabled);
      toast.error(t("forceSsoUpdateFailed"));
    }
  };

  const handleToggleForce2FANonSSO = async (enabled: boolean) => {
    setForce2FANonSSO(enabled);
    try {
      await upsertSettings({
        where: { id: settings?.id ?? "default-registration-settings" },
        create: {
          id: "default-registration-settings",
          force2FANonSSO: enabled,
        },
        update: { force2FANonSSO: enabled },
      });
      toast.success(
        enabled ? t("force2FANonSSOEnabled") : t("force2FANonSSODisabled")
      );
      void refetch();
    } catch {
      setForce2FANonSSO(!enabled);
      toast.error(t("force2FAUpdateFailed"));
    }
  };

  const handleToggleForce2FAAllLogins = async (enabled: boolean) => {
    // Force-2FA-on-all-logins implies force-2FA-for-non-SSO too. Mirror
    // /admin/sso's behavior so the dependent toggle reflects the change.
    setForce2FAAllLogins(enabled);
    if (enabled) setForce2FANonSSO(true);
    try {
      const updates: { force2FAAllLogins: boolean; force2FANonSSO?: boolean } =
        { force2FAAllLogins: enabled };
      if (enabled) updates.force2FANonSSO = true;
      await upsertSettings({
        where: { id: settings?.id ?? "default-registration-settings" },
        create: { id: "default-registration-settings", ...updates },
        update: updates,
      });
      toast.success(
        enabled ? t("force2FAAllLoginsEnabled") : t("force2FAAllLoginsDisabled")
      );
      void refetch();
    } catch {
      setForce2FAAllLogins(!enabled);
      toast.error(t("force2FAUpdateFailed"));
    }
  };

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
        void refetch();
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
          {/* Section 1: Sign-in Enforcement */}
          <div className="space-y-4">
            <div>
              <CardTitle className="text-lg">
                {t("signInEnforcementTitle")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("signInEnforcementDescription")}
              </CardDescription>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="forceSso"
                  checked={forceSso}
                  onCheckedChange={handleToggleForceSso}
                />
                <Label htmlFor="forceSso" className="text-base font-medium">
                  {t("forceSsoTitle")}
                </Label>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {t("forceSsoDescription")}
              </p>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="force2FANonSSO"
                  checked={force2FANonSSO}
                  onCheckedChange={handleToggleForce2FANonSSO}
                  disabled={force2FAAllLogins}
                />
                <Label
                  htmlFor="force2FANonSSO"
                  className="text-base font-medium"
                >
                  {t("force2FANonSSOTitle")}
                </Label>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {t("force2FANonSSODescription")}
              </p>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <Switch
                  id="force2FAAllLogins"
                  checked={force2FAAllLogins}
                  onCheckedChange={handleToggleForce2FAAllLogins}
                />
                <Label
                  htmlFor="force2FAAllLogins"
                  className="text-base font-medium"
                >
                  {t("force2FAAllLoginsTitle")}
                </Label>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {t("force2FAAllLoginsDescription")}
              </p>
            </div>
          </div>
          <Separator />
          {/* Section 2: Password Policy */}
          <div className="space-y-4">
            <div>
              <CardTitle className="text-lg">
                {t("passwordPolicyTitle")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("passwordPolicyDescription")}
              </CardDescription>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {/* Left column: sliders */}
              <div className="space-y-6">
                {/* Min Password Length */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="minPasswordLength">
                      {t("minPasswordLengthLabel")}
                    </Label>
                    <span className="text-sm font-medium tabular-nums">
                      {minPasswordLength}
                    </span>
                  </div>
                  <Slider
                    id="minPasswordLength"
                    aria-label={t("minPasswordLengthLabel")}
                    min={8}
                    max={128}
                    step={1}
                    value={[minPasswordLength]}
                    onValueChange={([v]) => setMinPasswordLength(v)}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("minPasswordLengthDescription")}
                  </p>
                </div>
                {/* Password History Depth */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="passwordHistoryDepth">
                      {t("passwordHistoryDepthLabel")}
                    </Label>
                    <span className="text-sm font-medium tabular-nums">
                      {passwordHistoryDepth}
                    </span>
                  </div>
                  <Slider
                    id="passwordHistoryDepth"
                    aria-label={t("passwordHistoryDepthLabel")}
                    min={0}
                    max={24}
                    step={1}
                    value={[passwordHistoryDepth]}
                    onValueChange={([v]) => setPasswordHistoryDepth(v)}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("passwordHistoryDepthDescription")}
                  </p>
                </div>
                {/* Password Expiration Days */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="passwordExpirationDays">
                      {t("passwordExpirationDaysLabel")}
                    </Label>
                    <span className="text-sm font-medium tabular-nums">
                      {passwordExpirationDays}
                    </span>
                  </div>
                  <Slider
                    id="passwordExpirationDays"
                    aria-label={t("passwordExpirationDaysLabel")}
                    min={0}
                    max={365}
                    step={1}
                    value={[passwordExpirationDays]}
                    onValueChange={([v]) => setPasswordExpirationDays(v)}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("passwordExpirationDaysDescription")}
                  </p>
                </div>
              </div>

              {/* Right column: required-character toggles + special chars */}
              <div className="space-y-4">
                {/* Require Uppercase */}
                <div className="flex items-center space-x-2">
                  <Switch
                    id="requireUppercase"
                    checked={requireUppercase}
                    onCheckedChange={setRequireUppercase}
                  />
                  <Label htmlFor="requireUppercase">
                    {t("requireUppercaseLabel")}
                  </Label>
                </div>
                {/* Require Lowercase */}
                <div className="flex items-center space-x-2">
                  <Switch
                    id="requireLowercase"
                    checked={requireLowercase}
                    onCheckedChange={setRequireLowercase}
                  />
                  <Label htmlFor="requireLowercase">
                    {t("requireLowercaseLabel")}
                  </Label>
                </div>
                {/* Require Numbers */}
                <div className="flex items-center space-x-2">
                  <Switch
                    id="requireNumbers"
                    checked={requireNumbers}
                    onCheckedChange={setRequireNumbers}
                  />
                  <Label htmlFor="requireNumbers">
                    {t("requireNumbersLabel")}
                  </Label>
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
              </div>
            </div>
          </div>
          <Separator />
          {/* Section 3: Lockout Policy */}
          <div className="space-y-4">
            <div>
              <CardTitle className="text-lg">
                {t("lockoutPolicyTitle")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("lockoutPolicyDescription")}
              </CardDescription>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              {/* Lockout Threshold */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="lockoutThreshold">
                    {t("lockoutThresholdLabel")}
                  </Label>
                  <span className="text-sm font-medium tabular-nums">
                    {lockoutThreshold}
                  </span>
                </div>
                <Slider
                  id="lockoutThreshold"
                  aria-label={t("lockoutThresholdLabel")}
                  min={1}
                  max={20}
                  step={1}
                  value={[lockoutThreshold]}
                  onValueChange={([v]) => setLockoutThreshold(v)}
                />
                <p className="text-sm text-muted-foreground">
                  {t("lockoutThresholdDescription")}
                </p>
              </div>

              {/* Lockout Duration Minutes */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="lockoutDurationMinutes">
                    {t("lockoutDurationMinutesLabel")}
                  </Label>
                  <span className="text-sm font-medium tabular-nums">
                    {lockoutDurationMinutes}
                  </span>
                </div>
                <Slider
                  id="lockoutDurationMinutes"
                  aria-label={t("lockoutDurationMinutesLabel")}
                  min={1}
                  max={60}
                  step={1}
                  value={[lockoutDurationMinutes]}
                  onValueChange={([v]) => setLockoutDurationMinutes(v)}
                />
                <p className="text-sm text-muted-foreground">
                  {t("lockoutDurationMinutesDescription")}
                </p>
              </div>
            </div>
          </div>
          <Separator />
          {/* Section 4: Enforcement Actions */}
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
