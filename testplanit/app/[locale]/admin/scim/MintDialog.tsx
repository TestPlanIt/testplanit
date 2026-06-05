"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { format } from "date-fns";
import {
  CalendarIcon,
  Check,
  Copy,
  Loader2,
  ShieldAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod/v4";

import { mintScimTokenAction } from "~/app/actions/scimTokenActions";
import { cn } from "~/utils";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type IdpName = "OKTA" | "ENTRA" | "ONELOGIN" | "OTHER";
type ExpiresOption = "never" | "30d" | "90d" | "1y" | "custom";

interface MintedTokenState {
  tokenId: string;
  plaintext: string;
  tokenPrefix: string;
}

interface MintDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSuccess?: (result: MintedTokenState) => void;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_YEARS_MS = 5 * 365 * ONE_DAY_MS;

function computeExpiresAt(
  option: ExpiresOption,
  customDate: Date | undefined
): Date | null {
  const now = Date.now();
  switch (option) {
    case "never":
      return null;
    case "30d":
      return new Date(now + 30 * ONE_DAY_MS);
    case "90d":
      return new Date(now + 90 * ONE_DAY_MS);
    case "1y":
      return new Date(now + 365 * ONE_DAY_MS);
    case "custom":
      return customDate ?? null;
  }
}

export function MintDialog({
  open,
  onOpenChange,
  onSuccess,
}: MintDialogProps) {
  const t = useTranslations("admin.scim.mint");
  const tReveal = useTranslations("admin.scim.reveal");
  const tCommon = useTranslations("common");

  // Plaintext bearer lives in component-local state ONLY. Never pushed to
  // any React Query cache, sessionStorage, or analytics surface. Cleared on
  // dialog close via the useEffect below to enforce the show-once invariant.
  const [mintedToken, setMintedToken] = useState<MintedTokenState | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const FormSchema = useMemo(
    () =>
      z.object({
        name: z
          .string()
          .min(1, { message: t("errorsNameRequired") })
          .max(80),
        idpName: z.enum(["OKTA", "ENTRA", "ONELOGIN", "OTHER"]),
        expiresOption: z.enum(["never", "30d", "90d", "1y", "custom"]),
        customDate: z.date().optional(),
      }),
    [t]
  );

  type FormValues = z.infer<typeof FormSchema>;

  const form = useForm<FormValues>({
    resolver: standardSchemaResolver(FormSchema),
    defaultValues: {
      name: "",
      idpName: "OKTA",
      expiresOption: "never",
      customDate: undefined,
    },
  });

  const expiresOption = form.watch("expiresOption");
  const customDate = form.watch("customDate");

  // Discard plaintext + reset form whenever the dialog closes. Show-once
  // invariant: re-opening returns to a clean form, not the prior reveal.
  useEffect(() => {
    if (!open) {
      setMintedToken(null);
      setCopied(false);
      form.reset({
        name: "",
        idpName: "OKTA",
        expiresOption: "never",
        customDate: undefined,
      });
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    }
  }, [open, form]);

  // Clean up the copy-feedback timer on unmount to avoid leaking state.
  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
    };
  }, []);

  const onSubmit = useCallback(
    async (values: FormValues) => {
      setSubmitting(true);
      try {
        const expiresAt = computeExpiresAt(
          values.expiresOption,
          values.customDate
        );
        const result = await mintScimTokenAction({
          name: values.name,
          idpName: values.idpName,
          expiresAt,
        });
        if (
          result.success &&
          result.plaintext &&
          result.tokenId &&
          result.tokenPrefix
        ) {
          const minted: MintedTokenState = {
            tokenId: result.tokenId,
            plaintext: result.plaintext,
            tokenPrefix: result.tokenPrefix,
          };
          setMintedToken(minted);
          toast.success(tReveal("toast"));
          onSuccess?.(minted);
        } else {
          toast.error(
            t("errorToast", { reason: result.error ?? "Unknown error" })
          );
        }
      } catch (err) {
        toast.error(
          t("errorToast", {
            reason: err instanceof Error ? err.message : "Unknown error",
          })
        );
      } finally {
        setSubmitting(false);
      }
    },
    [t, tReveal, onSuccess]
  );

  const handleCopy = useCallback(async () => {
    if (!mintedToken) return;
    try {
      await navigator.clipboard.writeText(mintedToken.plaintext);
      setCopied(true);
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyResetTimerRef.current = null;
      }, 2000);
    } catch {
      // Clipboard write rejected (e.g., permission policy). Surface a
      // recoverable toast; the user can still triple-click the mono code
      // value and Cmd/Ctrl-C manually.
      toast.error(t("errorToast", { reason: "Clipboard write rejected" }));
    }
  }, [mintedToken, t]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Plaintext is rendered ONCE in this code element; never via dangerouslySet
  // or to a third-party sink.
  const inRevealState = mintedToken !== null;

  // Base URL for the IdP-config hint. NEXTAUTH_URL is server-only — derive
  // from window.location.origin on mount. Falls back to empty string until
  // the effect runs (SSR safety; this component is client-only so the gap
  // is one frame).
  const [baseUrl, setBaseUrl] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  // Min / max for the Custom calendar.
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const minCustomDate = useMemo(
    () => new Date(today.getTime() + ONE_DAY_MS),
    [today]
  );
  const maxCustomDate = useMemo(
    () => new Date(today.getTime() + FIVE_YEARS_MS),
    [today]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        {inRevealState && mintedToken ? (
          <>
            <DialogHeader>
              <DialogTitle>{tReveal("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {tReveal("title")}
              </DialogDescription>
            </DialogHeader>

            <div aria-live="polite" className="sr-only">
              {tReveal("a11yAnnounce")}
            </div>

            <Alert className="border-warning bg-warning/10 text-warning-foreground">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>{tReveal("warning")}</AlertDescription>
            </Alert>

            <div className="space-y-2">
              <Label className="sr-only" htmlFor="scim-mint-dialog-reveal-token">
                {tReveal("tokenLabel")}
              </Label>
              <div className="flex items-center gap-2">
                <code
                  id="scim-mint-dialog-reveal-token"
                  data-testid="scim-mint-dialog-reveal-token"
                  className="grow break-all font-mono text-sm bg-muted px-2 py-1 rounded"
                >
                  {mintedToken.plaintext}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  data-testid="scim-mint-dialog-copy"
                  autoFocus
                  aria-label={copied ? tReveal("copied") : tReveal("copy")}
                >
                  {copied ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                  {copied ? tReveal("copied") : tReveal("copy")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {tReveal("baseUrlHint", { baseUrl })}
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="default"
                onClick={handleClose}
                data-testid="scim-mint-dialog-close"
              >
                {tReveal("close")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-3"
              noValidate
            >
              <DialogHeader>
                <DialogTitle>{t("title")}</DialogTitle>
                <DialogDescription>{t("description")}</DialogDescription>
              </DialogHeader>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("nameLabel")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        maxLength={80}
                        placeholder={t("namePlaceholder")}
                        data-testid="scim-mint-dialog-name-input"
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="idpName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("idpLabel")}</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v as IdpName)}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger
                          data-testid="scim-mint-dialog-idp-select"
                        >
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="OKTA">{t("idpOkta")}</SelectItem>
                        <SelectItem value="ENTRA">{t("idpEntra")}</SelectItem>
                        <SelectItem value="ONELOGIN">
                          {t("idpOneLogin")}
                        </SelectItem>
                        <SelectItem value="OTHER">{t("idpOther")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="expiresOption"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("expiresLabel")}</FormLabel>
                    <Select
                      onValueChange={(v) =>
                        field.onChange(v as ExpiresOption)
                      }
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger
                          data-testid="scim-mint-dialog-expires-select"
                        >
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="never">
                          {t("expiresNever")}
                        </SelectItem>
                        <SelectItem value="30d">{t("expires30")}</SelectItem>
                        <SelectItem value="90d">{t("expires90")}</SelectItem>
                        <SelectItem value="1y">{t("expires1y")}</SelectItem>
                        <SelectItem value="custom">
                          {t("expiresCustom")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {expiresOption === "custom" && (
                <FormField
                  control={form.control}
                  name="customDate"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>{t("expiresCustomLabel")}</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !field.value && "text-muted-foreground"
                              )}
                              data-testid="scim-mint-dialog-custom-date-trigger"
                            >
                              <CalendarIcon
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                              {field.value
                                ? format(field.value, "PPP")
                                : t("expiresCustomLabel")}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-auto p-0"
                          align="start"
                        >
                          <Calendar
                            mode="single"
                            selected={field.value}
                            onSelect={(d) => field.onChange(d ?? undefined)}
                            disabled={(date) =>
                              date < minCustomDate || date > maxCustomDate
                            }
                          />
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Suppress unused-var lint while customDate is read above via form.watch */}
              <span hidden aria-hidden="true">
                {customDate ? "" : ""}
              </span>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClose}
                  disabled={submitting}
                >
                  {tCommon("cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  disabled={submitting}
                  data-testid="scim-mint-dialog-submit"
                >
                  {submitting && (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {submitting ? t("submitting") : t("submit")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
