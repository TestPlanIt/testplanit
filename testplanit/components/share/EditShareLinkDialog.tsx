"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarIcon, Loader2, Asterisk } from "lucide-react";
import { format } from "date-fns";
import { cn } from "~/utils";
import { ShareLinkMode } from "@prisma/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useUpdateShareLink } from "~/lib/hooks";
import { prepareShareLinkData } from "@/actions/share-links";
import { useTranslations } from "next-intl";

interface EditShareLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareLink: any;
  onSuccess: () => void;
}

export function EditShareLinkDialog({
  open,
  onOpenChange,
  shareLink,
  onSuccess,
}: EditShareLinkDialogProps) {
  const t = useTranslations("reports.shareDialog");

  // Form state
  const [mode, setMode] = useState<ShareLinkMode>(shareLink.mode);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | undefined>(
    shareLink.expiresAt ? new Date(shareLink.expiresAt) : undefined
  );
  const [notifyOnView, setNotifyOnView] = useState(shareLink.notifyOnView);
  const [title, setTitle] = useState(shareLink.title || "");
  const [description, setDescription] = useState(shareLink.description || "");

  // Track if mode changed to/from PASSWORD_PROTECTED
  const [modeChanged, setModeChanged] = useState(false);
  const originalMode = shareLink.mode;

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Use ZenStack hook for updating share links
  const { mutateAsync: updateShareLink, isPending: isUpdating } = useUpdateShareLink();

  // Reset form when shareLink changes
  useEffect(() => {
    setMode(shareLink.mode);
    setExpiresAt(shareLink.expiresAt ? new Date(shareLink.expiresAt) : undefined);
    setNotifyOnView(shareLink.notifyOnView);
    setTitle(shareLink.title || "");
    setDescription(shareLink.description || "");
    setPassword("");
    setConfirmPassword("");
    setModeChanged(false);
    setError(null);
    setPasswordError(null);
  }, [shareLink]);

  const handleSave = async () => {
    setError(null);
    setPasswordError(null);

    try {
      // If switching TO PASSWORD_PROTECTED, require password
      if (mode === "PASSWORD_PROTECTED" && (modeChanged || !shareLink.passwordHash)) {
        if (!password || password.length < 4) {
          setPasswordError("Password must be at least 4 characters long.");
          return;
        }

        if (password !== confirmPassword) {
          setPasswordError("Passwords do not match.");
          return;
        }
      }

      let passwordHash = shareLink.passwordHash;

      // If mode changed or new password provided
      if (mode === "PASSWORD_PROTECTED" && password) {
        // Hash new password via server action
        const result = await prepareShareLinkData({ password });
        passwordHash = result.passwordHash;
      } else if (mode !== "PASSWORD_PROTECTED") {
        // Clear password if switching away from PASSWORD_PROTECTED
        passwordHash = null;
      }

      // Update share link using ZenStack hook
      await updateShareLink({
        where: { id: shareLink.id },
        data: {
          mode,
          passwordHash,
          expiresAt: expiresAt || null,
          notifyOnView,
          title: title || null,
          description: description || null,
        },
      });

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating share:", error);
      setError(error instanceof Error ? error.message : "An error occurred");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("editDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("editDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="edit-title">{t("title.label")}</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("title.placeholder")}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="edit-description">{t("description.label")}</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("description.placeholder")}
              rows={3}
            />
          </div>

          {/* Share Mode */}
          <div className="space-y-3">
            <Label>{t("shareMode.label")}</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => {
                setMode(v as ShareLinkMode);
                setModeChanged(v !== originalMode);
                setPasswordError(null);
              }}
            >
              <div className="flex items-start space-x-2 rounded-lg border p-4">
                <RadioGroupItem value="AUTHENTICATED" id="edit-authenticated" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="edit-authenticated" className="font-medium cursor-pointer">
                    {t("shareMode.authenticated.title")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {shareLink.projectId
                      ? t("shareMode.authenticated.description")
                      : t("shareMode.authenticated.descriptionCrossProject")}
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-2 rounded-lg border p-4">
                <RadioGroupItem value="PASSWORD_PROTECTED" id="edit-password" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="edit-password" className="font-medium cursor-pointer">
                    {t("shareMode.passwordProtected.title")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {shareLink.projectId
                      ? t("shareMode.passwordProtected.description")
                      : t("shareMode.passwordProtected.descriptionCrossProject")}
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-2 rounded-lg border p-4">
                <RadioGroupItem value="PUBLIC" id="edit-public" className="mt-1" />
                <div className="flex-1">
                  <Label htmlFor="edit-public" className="font-medium cursor-pointer">
                    {t("shareMode.public.title")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("shareMode.public.description")}
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {/* Password field (conditional) */}
          {mode === "PASSWORD_PROTECTED" && (
            <div className="space-y-4">
              {!modeChanged && shareLink.passwordHash && (
                <Alert>
                  <AlertDescription>
                    {t("editDialog.passwordExists")}
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="edit-password-input" className="flex items-center">
                  {modeChanged || !shareLink.passwordHash ? "Password" : "New Password"}
                  {(modeChanged || !shareLink.passwordHash) && (
                    <sup>
                      <Asterisk className="w-3 h-3 text-destructive" />
                    </sup>
                  )}
                </Label>
                <Input
                  id="edit-password-input"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder={
                    modeChanged || !shareLink.passwordHash
                      ? "••••••••"
                      : t("editDialog.passwordPlaceholder")
                  }
                  required={modeChanged || !shareLink.passwordHash}
                  className={passwordError ? "border-destructive" : ""}
                />
                {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
              </div>
              {password && (
                <div className="space-y-2">
                  <Label htmlFor="edit-confirm-password-input" className="flex items-center">
                    Confirm Password
                    <sup>
                      <Asterisk className="w-3 h-3 text-destructive" />
                    </sup>
                  </Label>
                  <Input
                    id="edit-confirm-password-input"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setPasswordError(null);
                    }}
                    placeholder="••••••••"
                    required
                    className={passwordError ? "border-destructive" : ""}
                  />
                </div>
              )}
            </div>
          )}

          {/* Expiration date */}
          <div className="space-y-2">
            <Label>{t("expiration.label")}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !expiresAt && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="h-4 w-4" />
                  {expiresAt ? format(expiresAt, "PPP") : t("expiration.noExpiration")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={expiresAt}
                  onSelect={setExpiresAt}
                  disabled={(date) => date < new Date()}
                  initialFocus
                />
                {expiresAt && (
                  <div className="p-3 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpiresAt(undefined)}
                      className="w-full"
                    >
                      {t("expiration.clear")}
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <p className="text-xs text-muted-foreground">
              {t("expiration.expiresAtMidnight")}
            </p>
          </div>

          {/* Notify on view */}
          <div className="flex items-start space-x-2">
            <Checkbox
              id="edit-notify"
              checked={notifyOnView}
              onCheckedChange={(checked) => setNotifyOnView(checked === true)}
            />
            <div className="-mt-1">
              <Label htmlFor="edit-notify" className="font-medium cursor-pointer">
                {t("notifyOnView.label")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("notifyOnView.description")}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("editDialog.saving")}
                </>
              ) : (
                t("editDialog.save")
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
