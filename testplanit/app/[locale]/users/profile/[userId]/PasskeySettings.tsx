"use client";

import { DateFormatter } from "@/components/DateFormatter";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import {
  Asterisk,
  Fingerprint,
  Info,
  Loader2,
  Plus,
  Trash,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { apiFetch } from "~/lib/basePath";
import { translateServerError } from "~/lib/i18n/translateServerError";
import { schema } from "~/zenstack/schema";

interface PasskeySettingsProps {
  userId: string;
  isOwnProfile: boolean;
  isAdmin?: boolean;
  /** The add dialog also asks for an authenticator code when this is on. */
  twoFactorEnabled: boolean;
}

// Browser support never changes while the page is open; reading it through
// useSyncExternalStore keeps the server render and first client render equal.
const subscribeToNothing = () => () => {};
const passkeysUnsupportedOnServer = () => false;

export function PasskeySettings({
  userId,
  isOwnProfile,
  isAdmin = false,
  twoFactorEnabled,
}: PasskeySettingsProps) {
  const t = useTranslations("users.profile.passkeys");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [passkeyToRemove, setPasskeyToRemove] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const passkeySupported = useSyncExternalStore(
    subscribeToNothing,
    browserSupportsWebAuthn,
    passkeysUnsupportedOnServer
  );

  const { data: passkeys, refetch: refetchPasskeys } = useClientQueries(
    schema
  ).passkey.useFindMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const removePasskey = useClientQueries(schema).passkey.useDelete();

  const { data: registrationSettings } =
    useClientQueries(schema).registrationSettings.useFindFirst();
  const { data: forcedSsoProvider } = useClientQueries(
    schema
  ).ssoProvider.useFindFirst({ where: { forceSso: true } });
  const switchedOff =
    registrationSettings?.allowPasskeys === false || !!forcedSsoProvider;

  const dateTimeFormat = `${session?.user?.preferences?.dateFormat ?? "MM_DD_YYYY_DASH"} ${session?.user?.preferences?.timeFormat ?? "HH_MM_A"}`;
  const timezone = session?.user?.preferences?.timezone;

  function closeAddDialog() {
    setIsAddOpen(false);
    setName("");
    setCurrentPassword("");
    setTotpCode("");
    setAddError("");
  }

  async function handleAddPasskey(event: FormEvent) {
    event.preventDefault();
    setIsAdding(true);
    setAddError("");
    try {
      const optionsResponse = await apiFetch(
        "/api/auth/passkey/register/options",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword,
            ...(twoFactorEnabled ? { totpCode: totpCode.trim() } : {}),
          }),
        }
      );
      const optionsData = await optionsResponse.json();
      if (!optionsResponse.ok) {
        setAddError(
          translateServerError(
            tGlobal,
            optionsData,
            t("errors.registrationFailed")
          )
        );
        return;
      }

      let registration;
      try {
        registration = await startRegistration({
          optionsJSON: optionsData.options,
        });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "";
        if (errorName === "InvalidStateError") {
          setAddError(t("errors.alreadyRegistered"));
        } else if (
          errorName !== "NotAllowedError" &&
          errorName !== "AbortError"
        ) {
          // Dismissing the browser's prompt is not an error worth reporting.
          setAddError(t("errors.registrationFailed"));
        }
        return;
      }

      const verifyResponse = await apiFetch(
        "/api/auth/passkey/register/verify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            response: registration,
            challengeToken: optionsData.challengeToken,
            name: name.trim(),
          }),
        }
      );
      if (!verifyResponse.ok) {
        const verifyData = await verifyResponse.json().catch(() => null);
        setAddError(
          translateServerError(
            tGlobal,
            verifyData,
            t("errors.registrationFailed")
          )
        );
        return;
      }

      closeAddDialog();
      void refetchPasskeys();
    } catch {
      setAddError(t("errors.registrationFailed"));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemovePasskey() {
    if (!passkeyToRemove) return;
    setIsRemoving(true);
    try {
      await removePasskey.mutateAsync({ where: { id: passkeyToRemove } });
      void refetchPasskeys();
      setPasskeyToRemove(null);
    } catch {
      toast.error(t("errors.removeFailed"));
    } finally {
      setIsRemoving(false);
    }
  }

  if (!isOwnProfile && !isAdmin) {
    return null;
  }

  const canAdd = isOwnProfile && !switchedOff && passkeySupported;
  const addDisabled =
    isAdding ||
    !name.trim() ||
    !currentPassword ||
    (twoFactorEnabled && !totpCode.trim());

  return (
    <>
      <div className="space-y-3" data-testid="passkey-settings">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">{t("title")}</span>
          </div>
          {canAdd && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddOpen(true)}
              data-testid="add-passkey-button"
            >
              <Plus className="h-3 w-3" />
              {t("add")}
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t("description")}</p>

        {(switchedOff || (isOwnProfile && !passkeySupported)) && (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2">
            <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {switchedOff ? t("disabledNotice") : t("notSupported")}
            </p>
          </div>
        )}

        {passkeys && passkeys.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tGlobal("common.name")}</TableHead>
                <TableHead>{tGlobal("common.fields.created")}</TableHead>
                <TableHead>
                  {tGlobal("admin.apiTokens.columns.lastUsed")}
                </TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {passkeys.map((passkey) => (
                <TableRow key={passkey.id} data-testid="passkey-row">
                  <TableCell className="font-medium">{passkey.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <DateFormatter
                      date={passkey.createdAt}
                      formatString={dateTimeFormat}
                      timezone={timezone}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {passkey.lastUsedAt ? (
                      <DateFormatter
                        date={passkey.lastUsedAt}
                        formatString={dateTimeFormat}
                        timezone={timezone}
                      />
                    ) : (
                      <span className="text-muted-foreground/50">
                        {tGlobal("common.never")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPasskeyToRemove(passkey.id)}
                      className="h-8 w-8 text-destructive hover:text-destructive-text"
                      aria-label={tCommon("actions.remove")}
                      data-testid="remove-passkey-button"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noPasskeys")}</p>
        )}
      </div>

      <Dialog
        open={isAddOpen}
        onOpenChange={(open) => !open && !isAdding && closeAddDialog()}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleAddPasskey}>
            <DialogHeader>
              <DialogTitle>{t("addTitle")}</DialogTitle>
              <DialogDescription>{t("addDescription")}</DialogDescription>
            </DialogHeader>

            {addError && (
              <div
                className="mt-4 rounded-md border border-destructive bg-destructive/10 p-3"
                data-testid="add-passkey-error"
              >
                <p className="text-sm text-destructive">{addError}</p>
              </div>
            )}

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="passkey-name" className="flex items-center">
                  {t("nameLabel")}
                  <sup>
                    <Asterisk className="h-3 w-3 text-destructive" />
                  </sup>
                </Label>
                <Input
                  id="passkey-name"
                  placeholder={t("namePlaceholder")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  autoFocus
                  data-testid="passkey-name-input"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="passkey-current-password"
                  className="flex items-center"
                >
                  {t("passwordLabel")}
                  <sup>
                    <Asterisk className="h-3 w-3 text-destructive" />
                  </sup>
                </Label>
                <Input
                  id="passkey-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  data-testid="passkey-password-input"
                />
              </div>
              {twoFactorEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="passkey-totp" className="flex items-center">
                    {t("codeLabel")}
                    <sup>
                      <Asterisk className="h-3 w-3 text-destructive" />
                    </sup>
                  </Label>
                  <Input
                    id="passkey-totp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    data-testid="passkey-totp-input"
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeAddDialog}
                disabled={isAdding}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={addDisabled}
                data-testid="add-passkey-submit"
              >
                {isAdding && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={passkeyToRemove !== null}
        onOpenChange={(open) => {
          if (!open && !isRemoving) setPasskeyToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("removeDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Stay open until the removal has finished or failed.
                e.preventDefault();
                void handleRemovePasskey();
              }}
              disabled={isRemoving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-remove-passkey"
            >
              {isRemoving && <Loader2 className="h-4 w-4 animate-spin" />}
              {tCommon("actions.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
