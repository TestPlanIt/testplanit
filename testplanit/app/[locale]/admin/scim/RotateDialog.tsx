"use client";

/**
 * Overlap-window rotation for a SCIM bearer token.
 *
 * Two states, mirroring MintDialog: pick the overlap window, then a
 * show-once reveal of the replacement bearer. The plaintext lives in
 * transient `useState` only — never in a query cache, never re-fetchable —
 * and is discarded when the dialog closes.
 *
 * The window is the point of the feature: the old bearer keeps working while
 * the operator pastes the new one into the IdP, so rotation no longer means
 * a provisioning outage.
 */

import { Check, Copy, Loader2, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { rotateScimTokenAction } from "~/app/actions/scimTokenActions";
import { SCIM_DEFAULT_ROTATION_OVERLAP_MS } from "~/lib/scim/constants";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const HOUR_MS = 3_600_000;

const OVERLAP_OPTIONS: Array<{ value: string; ms: number; labelKey: string }> =
  [
    { value: "none", ms: 0, labelKey: "overlapNone" },
    { value: "1h", ms: HOUR_MS, labelKey: "overlap1h" },
    {
      value: "24h",
      ms: SCIM_DEFAULT_ROTATION_OVERLAP_MS,
      labelKey: "overlap24h",
    },
    { value: "7d", ms: 7 * 24 * HOUR_MS, labelKey: "overlap7d" },
    { value: "30d", ms: 30 * 24 * HOUR_MS, labelKey: "overlap30d" },
  ];

interface RotatedTokenState {
  plaintext: string;
  previousTokenExpiresAt: string | null;
}

interface RotateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tokenId: string | null;
  tokenName: string | null;
  onRotated: () => void;
}

export function RotateDialog({
  open,
  onOpenChange,
  tokenId,
  tokenName,
  onRotated,
}: RotateDialogProps) {
  const t = useTranslations("admin.scim.rotate");
  const tReveal = useTranslations("admin.scim.reveal");
  const tCommon = useTranslations("common");

  const [overlap, setOverlap] = useState("24h");
  const [isRotating, setIsRotating] = useState(false);
  const [rotated, setRotated] = useState<RotatedTokenState | null>(null);
  const [copied, setCopied] = useState(false);

  // Show-once invariant: closing discards the plaintext and returns the
  // dialog to a clean form rather than the prior reveal.
  useEffect(() => {
    if (!open) {
      setRotated(null);
      setCopied(false);
      setOverlap("24h");
    }
  }, [open]);

  const handleRotate = useCallback(async () => {
    if (!tokenId) return;
    const option = OVERLAP_OPTIONS.find((o) => o.value === overlap);
    if (!option) return;

    setIsRotating(true);
    try {
      const result = await rotateScimTokenAction({
        tokenId,
        overlapMs: option.ms,
      });
      if (!result.success || !result.plaintext) {
        toast.error(result.error ?? tCommon("errors.unknown"));
        return;
      }
      setRotated({
        plaintext: result.plaintext,
        previousTokenExpiresAt: result.previousTokenExpiresAt ?? null,
      });
      onRotated();
    } finally {
      setIsRotating(false);
    }
  }, [tokenId, overlap, onRotated, tCommon]);

  const handleCopy = useCallback(async () => {
    if (!rotated) return;
    try {
      await navigator.clipboard.writeText(rotated.plaintext);
      setCopied(true);
    } catch {
      toast.error(tCommon("errors.unknown"));
    }
  }, [rotated, tCommon]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        {rotated ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("revealTitle")}</DialogTitle>
              <DialogDescription>
                {rotated.previousTokenExpiresAt
                  ? t("revealDescriptionOverlap")
                  : t("revealDescriptionImmediate")}
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
              <Label className="sr-only" htmlFor="scim-rotate-reveal-token">
                {tReveal("tokenLabel")}
              </Label>
              <div className="flex items-center gap-2">
                <code
                  id="scim-rotate-reveal-token"
                  data-testid="scim-rotate-dialog-reveal-token"
                  className="grow break-all font-mono text-sm bg-muted px-2 py-1 rounded"
                >
                  {rotated.plaintext}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  data-testid="scim-rotate-dialog-copy"
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
            </div>

            <DialogFooter>
              <Button
                type="button"
                onClick={() => onOpenChange(false)}
                data-testid="scim-rotate-dialog-close"
              >
                {tReveal("close")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>
                {t("description", { name: tokenName ?? "" })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="scim-rotate-overlap">{t("overlapLabel")}</Label>
              <Select
                value={overlap}
                onValueChange={setOverlap}
                disabled={isRotating}
              >
                <SelectTrigger
                  id="scim-rotate-overlap"
                  data-testid="scim-rotate-overlap-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OVERLAP_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("overlapHint")}
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isRotating}
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="button"
                onClick={handleRotate}
                disabled={isRotating}
                data-testid="scim-rotate-dialog-submit"
              >
                {isRotating && (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                )}
                {isRotating ? t("submitting") : t("submit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
