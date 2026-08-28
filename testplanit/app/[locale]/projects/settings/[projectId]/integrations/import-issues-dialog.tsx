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
/** Sentinel Select value for "no recency window" -- paired with a cleared
 *  cap, this is what routes the run to the windowless, paged-to-completion
 *  requirements-import path instead of the windowed, capped import-issues
 *  path. See `useTypedPath` below. */
const ALL_HISTORY_VALUE = "all";
const DEFAULT_DAYS = 90;
const DEFAULT_CAP = 200;
const MAX_CAP = 1000;

interface ImportTarget {
  id: string;
  name: string;
  key: string;
}

interface IssueType {
  id: string;
  name: string;
}

interface ImportIssuesDialogProps {
  integrationId: number;
  /** Required by the requirements-import routes (28-06), which bind the
   *  caller's authorized project to the addressed tracker mapping. */
  projectId: number;
  target: ImportTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after an import is successfully queued, so the caller can refetch. */
  onStarted: () => void;
  /** Preselected issue-type ids -- e.g. opened from the Requirement Sync
   *  section's own configured requirement types. Their presence also
   *  defaults the dialog to "every issue, no limit" instead of today's
   *  windowed, capped sample, so the generic entry point (no preselection)
   *  is unchanged for a user who just wants a recent sample. */
  initialIssueTypeIds?: string[];
  initialIssueTypeNames?: Record<string, string>;
}

interface PreviewState {
  matched: number;
  hasMore: boolean;
  cap: number;
}

interface TypedPreviewState {
  matched: number;
  hasMore: boolean;
}

export function ImportIssuesDialog({
  integrationId,
  projectId,
  target,
  open,
  onOpenChange,
  onStarted,
  initialIssueTypeIds,
  initialIssueTypeNames,
}: ImportIssuesDialogProps) {
  const t = useTranslations("projects.settings.integrations.integration");
  const [days, setDays] = useState<number | null>(DEFAULT_DAYS);
  const [cap, setCap] = useState<number | null>(DEFAULT_CAP);
  const [selectedTypes, setSelectedTypes] = useState<IssueType[]>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [typedPreview, setTypedPreview] = useState<TypedPreviewState | null>(
    null
  );
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens for a (possibly different)
  // target. Preselected types (opened from Requirement Sync) default the
  // scope to "every issue, no limit" -- their absence keeps today's
  // windowed, capped defaults for the generic entry point.
  useEffect(() => {
    if (open) {
      const hasPreselectedTypes = (initialIssueTypeIds?.length ?? 0) > 0;
      setDays(hasPreselectedTypes ? null : DEFAULT_DAYS);
      setCap(hasPreselectedTypes ? null : DEFAULT_CAP);
      setSelectedTypes(
        (initialIssueTypeIds ?? []).map((id) => ({
          id,
          name: initialIssueTypeNames?.[id] ?? id,
        }))
      );
      setPreview(null);
      setTypedPreview(null);
      setError(null);
      setIsPreviewing(false);
      setIsImporting(false);
    }
    // Only the identity of the target (and open/close) should reset the
    // form -- re-running this on every initialIssueTypeIds re-render would
    // fight the user's own in-dialog edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id]);

  // A changed filter invalidates a stale preview / consent count.
  useEffect(() => {
    setPreview(null);
    setTypedPreview(null);
  }, [days, cap, selectedTypes]);

  const effectiveCap = Math.min(
    Math.max(1, Math.floor((cap ?? DEFAULT_CAP) || DEFAULT_CAP)),
    MAX_CAP
  );

  // Every issue of the chosen types with no recency window and no cap
  // routes to the windowless, paged-to-completion requirements-import path
  // (28-06); a recent, bounded sample uses the generic import-issues path
  // (unchanged). Neither server route changes here -- this only decides
  // which existing endpoint to call.
  const useTypedPath = days === null || cap === null;

  const issueTypeIds = selectedTypes.map((issueType) => issueType.id);

  const handlePreview = async () => {
    if (!target) return;
    setIsPreviewing(true);
    setError(null);
    try {
      if (useTypedPath) {
        // requirements-import always scopes to the tracker project's
        // CONFIGURED requirement types (28-06) -- the server never reads a
        // type list from this body. `issueTypeIds` here drives this
        // dialog's own no-types gate and its own display; the server's
        // source of truth stays the Requirement Sync section's saved
        // config, not whatever is checked in this dialog.
        if (issueTypeIds.length === 0) {
          setError(t("requirementsConfig.importNoTypes"));
          return;
        }
        const res = await fetch(
          `/api/integrations/${integrationId}/requirements-import/preview`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              integrationProjectId: target.id,
            }),
          }
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            data?.error || t("requirementsConfig.importCountUnavailable")
          );
        }
        if (data?.enabled === false) {
          setError(t("requirementsConfig.importNoTypes"));
          return;
        }
        setTypedPreview({
          matched: data?.matched ?? 0,
          hasMore: Boolean(data?.hasMore),
        });
      } else {
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
      }
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
      if (useTypedPath) {
        const res = await fetch(
          `/api/integrations/${integrationId}/requirements-import`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId,
              integrationProjectId: target.id,
            }),
          }
        );
        if (res.status === 409) {
          toast.error(t("requirementsConfig.importAlreadyRunning"));
          onOpenChange(false);
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || t("requirementsConfig.importFailed"));
        }
        toast.success(t("requirementsConfig.importStarted"));
        onStarted();
        onOpenChange(false);
      } else {
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
      }
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
          {/* Stated, never chosen. Neither import route reads a type list
              from the request: the requirements path always scopes to the
              types saved in Requirement Sync, and the windowed path imports
              every type. An editable control here would claim a per-run
              choice the server does not offer, so this reports what the run
              will actually cover instead. */}
          {useTypedPath && selectedTypes.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-sm text-muted-foreground">
                {t("requirementsConfig.issueTypesLabel")}
              </Label>
              <p
                className="text-sm"
                data-testid="import-configured-issue-types"
              >
                {selectedTypes.map((issueType) => issueType.name).join(", ")}
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="import-recency">{t("importUpdatedWithin")}</Label>
            <Select
              value={days === null ? ALL_HISTORY_VALUE : String(days)}
              onValueChange={(v) =>
                setDays(v === ALL_HISTORY_VALUE ? null : Number(v))
              }
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
                <SelectItem value={ALL_HISTORY_VALUE}>
                  {t("importAllHistory")}
                </SelectItem>
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
              value={cap ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                setCap(raw === "" ? null : Number(raw));
              }}
            />
            <p className="text-xs text-muted-foreground">
              {t("importCapHint")}
            </p>
          </div>

          {!useTypedPath && preview && (
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

          {useTypedPath && typedPreview && (
            <div
              className="rounded-md bg-muted p-3 text-sm space-y-1"
              data-testid="import-issues-typed-preview"
            >
              <p>
                {t("requirementsConfig.importOfferBody", {
                  count: typedPreview.matched,
                })}
              </p>
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
          {useTypedPath ? (
            typedPreview ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => setTypedPreview(null)}
                  disabled={isImporting}
                >
                  {t("requirementsConfig.importOfferDecline")}
                </Button>
                {typedPreview.matched > 0 && (
                  <Button
                    onClick={handleImport}
                    disabled={isImporting}
                    data-testid="import-issues-typed-confirm"
                  >
                    {isImporting && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {t("requirementsConfig.importOfferConfirm")}
                  </Button>
                )}
              </>
            ) : (
              <Button
                onClick={handlePreview}
                disabled={isPreviewing}
                data-testid="import-issues-typed-start"
              >
                {isPreviewing && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("importStart")}
              </Button>
            )
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handlePreview}
                disabled={isPreviewing || isImporting}
              >
                {isPreviewing && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("importPreview")}
              </Button>
              <Button
                onClick={handleImport}
                disabled={isImporting || isPreviewing}
              >
                {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("importStart")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
