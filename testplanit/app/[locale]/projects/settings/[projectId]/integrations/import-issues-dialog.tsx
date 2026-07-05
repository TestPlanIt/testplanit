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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const DAY_WINDOW_OPTIONS = [30, 90, 180, 365] as const;
const DEFAULT_DAYS = 90;
const DEFAULT_CAP = 200;
const MAX_CAP = 1000;

interface ImportTarget {
  id: string;
  name: string;
  key: string;
}

interface ImportIssuesDialogProps {
  integrationId: number;
  target: ImportTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after an import is successfully queued, so the caller can refetch. */
  onStarted: () => void;
}

interface PreviewState {
  matched: number;
  hasMore: boolean;
  cap: number;
}

export function ImportIssuesDialog({
  integrationId,
  target,
  open,
  onOpenChange,
  onStarted,
}: ImportIssuesDialogProps) {
  const t = useTranslations("projects.settings.integrations.integration");
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [cap, setCap] = useState<number>(DEFAULT_CAP);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens for a (possibly different) target.
  useEffect(() => {
    if (open) {
      setDays(DEFAULT_DAYS);
      setCap(DEFAULT_CAP);
      setPreview(null);
      setError(null);
      setIsPreviewing(false);
      setIsImporting(false);
    }
  }, [open, target?.id]);

  // A changed filter invalidates a stale preview count.
  useEffect(() => {
    setPreview(null);
  }, [days, cap]);

  const effectiveCap = Math.min(
    Math.max(1, Math.floor(cap || DEFAULT_CAP)),
    MAX_CAP
  );

  const handlePreview = async () => {
    if (!target) return;
    setIsPreviewing(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/integrations/${integrationId}/import-issues/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            integrationProjectId: target.id,
            updatedWithinDays: days,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || t("importPreviewFailed"));
      }
      setPreview({
        matched: data.matched ?? 0,
        hasMore: Boolean(data.hasMore),
        cap: effectiveCap,
      });
    } catch (e: any) {
      setError(e?.message || t("importPreviewFailed"));
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!target) return;
    setIsImporting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/integrations/${integrationId}/import-issues`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            integrationProjectId: target.id,
            updatedWithinDays: days,
            cap: effectiveCap,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || t("importFailed"));
      }
      toast.success(t("importStarted"));
      onStarted();
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message || t("importFailed"));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("importTitle", { name: target?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{t("importDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="import-recency">{t("importUpdatedWithin")}</Label>
            <Select
              value={String(days)}
              onValueChange={(v) => setDays(Number(v))}
            >
              <SelectTrigger id="import-recency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAY_WINDOW_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {t("importLastDays", { days: String(d) })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="import-cap">{t("importMax")}</Label>
            <Input
              id="import-cap"
              type="number"
              min={1}
              max={MAX_CAP}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
            />
          </div>

          {preview && (
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <p>
                {t("importPreviewResult", {
                  count: preview.matched,
                  cap: String(preview.cap),
                })}
              </p>
              {preview.matched > preview.cap && (
                <p className="text-muted-foreground">
                  {t("importOverCap", { cap: String(preview.cap) })}
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handlePreview}
            disabled={isPreviewing || isImporting}
          >
            {isPreviewing && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("importPreview")}
          </Button>
          <Button onClick={handleImport} disabled={isImporting || isPreviewing}>
            {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("importStart")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
