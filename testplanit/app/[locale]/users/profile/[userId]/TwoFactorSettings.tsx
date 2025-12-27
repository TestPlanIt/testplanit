"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  Lock,
  Info,
} from "lucide-react";
import Image from "next/image";

interface TwoFactorSettingsProps {
  userId: string;
  twoFactorEnabled: boolean;
  isOwnProfile: boolean;
  onUpdate?: () => void;
}

export function TwoFactorSettings({
  userId,
  twoFactorEnabled,
  isOwnProfile,
  onUpdate,
}: TwoFactorSettingsProps) {
  const t = useTranslations();
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isDisableOpen, setIsDisableOpen] = useState(false);
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [ssoBypassesPersonal2FA, setSsoBypassesPersonal2FA] = useState(false);

  // Setup state
  const [setupData, setSetupData] = useState<{
    secret: string;
    qrCode: string;
  } | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Disable state
  const [disableCode, setDisableCode] = useState("");
  const [disableUseBackupCode, setDisableUseBackupCode] = useState(false);

  // Regenerate state
  const [regenerateCode, setRegenerateCode] = useState("");
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);

  // Check if 2FA is required by system settings
  useEffect(() => {
    async function checkTwoFactorRequired() {
      try {
        const response = await fetch("/api/auth/two-factor/settings");
        if (response.ok) {
          const data = await response.json();
          // Only force2FAAllLogins prevents users from disabling 2FA
          // force2FANonSSO only applies to password logins, so SSO users can still
          // toggle their personal 2FA (which only affects password logins anyway)
          setTwoFactorRequired(data.force2FAAllLogins);
          // SSO bypasses personal 2FA when force2FAAllLogins is NOT enabled
          // (force2FANonSSO only applies to password logins)
          setSsoBypassesPersonal2FA(!data.force2FAAllLogins);
        }
      } catch {
        // Silently fail - default to allowing disable
      }
    }
    checkTwoFactorRequired();
  }, []);

  async function startSetup() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/two-factor/setup");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to start 2FA setup");
      }
      setSetupData(data);
      setIsSetupOpen(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start 2FA setup"
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function completeSetup() {
    if (!verificationCode || verificationCode.length < 6) return;

    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/two-factor/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: verificationCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to enable 2FA");
      }
      setBackupCodes(data.backupCodes);
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to enable 2FA");
    } finally {
      setIsLoading(false);
    }
  }

  async function disable2FA() {
    if (!disableCode || disableCode.length < 6) return;

    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/two-factor/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: disableCode.length === 6 ? disableCode : undefined,
          backupCode: disableCode.length === 8 ? disableCode : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to disable 2FA");
      }
      setIsDisableOpen(false);
      setDisableCode("");
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable 2FA");
    } finally {
      setIsLoading(false);
    }
  }

  async function regenerateBackupCodes() {
    if (!regenerateCode || regenerateCode.length < 6) return;

    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/two-factor/regenerate-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: regenerateCode }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to regenerate backup codes");
      }
      setNewBackupCodes(data.backupCodes);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to regenerate backup codes"
      );
    } finally {
      setIsLoading(false);
    }
  }

  function copyBackupCodes(codes: string[]) {
    navigator.clipboard.writeText(codes.join("\n"));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
  }

  function closeSetup() {
    setIsSetupOpen(false);
    setSetupData(null);
    setVerificationCode("");
    setBackupCodes(null);
    setError("");
  }

  function closeDisable() {
    setIsDisableOpen(false);
    setDisableCode("");
    setDisableUseBackupCode(false);
    setError("");
  }

  function closeRegenerate() {
    setIsRegenerateOpen(false);
    setRegenerateCode("");
    setNewBackupCodes(null);
    setError("");
  }

  if (!isOwnProfile) {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{t("auth.signin.twoFactor.title")}</span>
        </div>
        <Switch checked={twoFactorEnabled} disabled />
      </div>
    );
  }

  function handleSwitchChange(checked: boolean) {
    if (checked) {
      // Enable 2FA - start setup
      startSetup();
    } else {
      // Disable 2FA - open confirmation dialog
      setIsDisableOpen(true);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{t("auth.signin.twoFactor.title")}</span>
        </div>
        <div className="flex items-center gap-2">
          {twoFactorEnabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsRegenerateOpen(true)}
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              {t("users.profile.twoFactor.regenerateCodes")}
            </Button>
          )}
          {twoFactorRequired && twoFactorEnabled ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Switch
                      checked={twoFactorEnabled}
                      disabled
                      className="cursor-not-allowed"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("users.profile.twoFactor.disableNotAllowed")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <Switch
              checked={twoFactorEnabled}
              onCheckedChange={handleSwitchChange}
              disabled={isLoading}
            />
          )}
        </div>
      </div>

      {/* Notice when SSO bypasses personal 2FA */}
      {ssoBypassesPersonal2FA && (
        <div className="flex items-center gap-2 mt-2 p-2 bg-muted/50 rounded-md">
          <Info className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            {t("users.profile.twoFactor.ssoBypassNotice")}
          </p>
        </div>
      )}

      {/* Setup Dialog */}
      <Dialog open={isSetupOpen} onOpenChange={(open) => !open && closeSetup()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {backupCodes
                ? t("users.profile.twoFactor.setup.backupCodesTitle")
                : t("auth.twoFactorSetup.title")}
            </DialogTitle>
            <DialogDescription>
              {backupCodes
                ? t("auth.twoFactorSetup.backupCodesInfo")
                : t("users.profile.twoFactor.setup.description")}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!backupCodes ? (
            <div className="space-y-4 py-4">
              {setupData?.qrCode && (
                <div className="flex flex-col items-center gap-4">
                  <div className="bg-white p-2 rounded-lg">
                    <Image
                      src={setupData.qrCode}
                      alt="2FA QR Code"
                      width={200}
                      height={200}
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
              )}

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
            </div>
          ) : (
            <div className="space-y-4 py-4">
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
                onClick={() => copyBackupCodes(backupCodes)}
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
            </div>
          )}

          <DialogFooter>
            {!backupCodes ? (
              <>
                <Button variant="outline" onClick={closeSetup}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={completeSetup}
                  disabled={isLoading || verificationCode.length < 6}
                >
                  {isLoading && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {t("auth.twoFactorSetup.verify")}
                </Button>
              </>
            ) : (
              <Button onClick={closeSetup} className="w-full">
                {t("users.profile.twoFactor.setup.done")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disable Confirmation Dialog */}
      <AlertDialog
        open={isDisableOpen}
        onOpenChange={(open) => !open && closeDisable()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("users.profile.twoFactor.disableConfirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("users.profile.twoFactor.disableConfirm.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-2 py-4">
            {disableUseBackupCode ? (
              <Input
                type="text"
                placeholder="XXXXXXXX"
                value={disableCode}
                onChange={(e) =>
                  setDisableCode(e.target.value.toUpperCase().slice(0, 8))
                }
                className="text-center text-lg tracking-widest font-mono"
                autoComplete="one-time-code"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && disableCode.length === 8) {
                    disable2FA();
                  }
                }}
              />
            ) : (
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={disableCode}
                  onChange={(value) => setDisableCode(value)}
                  onComplete={() => disable2FA()}
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
                setDisableUseBackupCode(!disableUseBackupCode);
                setDisableCode("");
              }}
              className="text-xs text-primary hover:underline w-full text-center"
            >
              {disableUseBackupCode
                ? t("auth.twoFactorVerify.useAuthenticator")
                : t("auth.twoFactorVerify.useBackupCode")}
            </button>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                disable2FA();
              }}
              disabled={
                isLoading || disableCode.length < (disableUseBackupCode ? 8 : 6)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("users.profile.twoFactor.disable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Regenerate Backup Codes Dialog */}
      <Dialog
        open={isRegenerateOpen}
        onOpenChange={(open) => !open && closeRegenerate()}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {newBackupCodes
                ? t("users.profile.twoFactor.regenerate.newCodesTitle")
                : t("users.profile.twoFactor.regenerate.title")}
            </DialogTitle>
            <DialogDescription>
              {newBackupCodes
                ? t("users.profile.twoFactor.regenerate.newCodesDescription")
                : t("users.profile.twoFactor.regenerate.description")}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive rounded-md">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!newBackupCodes ? (
            <div className="space-y-2 py-4">
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={regenerateCode}
                  onChange={(value) => setRegenerateCode(value)}
                  onComplete={() => regenerateBackupCodes()}
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
          ) : (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-2">
                {newBackupCodes.map((code, index) => (
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
                onClick={() => copyBackupCodes(newBackupCodes)}
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
            </div>
          )}

          <DialogFooter>
            {!newBackupCodes ? (
              <>
                <Button variant="outline" onClick={closeRegenerate}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={regenerateBackupCodes}
                  disabled={isLoading || regenerateCode.length < 6}
                >
                  {isLoading && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  {t("users.profile.twoFactor.regenerate.confirm")}
                </Button>
              </>
            ) : (
              <Button onClick={closeRegenerate} className="w-full">
                {t("users.profile.twoFactor.setup.done")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
