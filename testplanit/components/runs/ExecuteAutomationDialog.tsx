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
import { FilePlay, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ExecutionTargetChoice } from "~/app/actions/execution-targets";

export interface ExecuteRequest {
  targetId: number;
  ref?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: ExecutionTargetChoice[];
  /** Automated cases the request will cover (count-first summary). */
  caseCount: number;
  /** Run the results will attach to; shown in the note. Null for ad-hoc (a run is created). */
  runId: number | null;
  title?: string;
  description?: string;
  /** Performs the request; resolve with an error message to show, or null on success. */
  submit: (req: ExecuteRequest) => Promise<string | null>;
  onDispatched?: () => void;
  /** Pre-select a target (retry). */
  initialTargetId?: number | null;
  initialRef?: string | null;
}

export function ExecuteAutomationDialog({
  open,
  onOpenChange,
  targets,
  caseCount,
  runId,
  title,
  description,
  submit,
  onDispatched,
  initialTargetId,
  initialRef,
}: Props) {
  const t = useTranslations("automation.execute");
  const tCommon = useTranslations("common");

  const enabledTargets = useMemo(
    () => targets.filter((target) => target.isEnabled),
    [targets]
  );
  const [targetId, setTargetId] = useState<string>("");
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset only when the dialog opens; a targets refetch while it is open
  // must not wipe a server error the user is still reading.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setTargetId("");
    setRef("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const preferred =
      (initialTargetId &&
        enabledTargets.find((x) => x.id === initialTargetId)) ||
      (enabledTargets.length === 1 ? enabledTargets[0] : null);
    setTargetId((current) =>
      current ? current : preferred ? String(preferred.id) : ""
    );
    setRef((current) =>
      current ? current : (initialRef ?? preferred?.defaultRef ?? "")
    );
  }, [open, enabledTargets, initialTargetId, initialRef]);

  const selected = enabledTargets.find((x) => String(x.id) === targetId);

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const message = await submit({
        targetId: selected.id,
        ref: ref.trim() || undefined,
      });
      if (message) {
        setError(message);
        return;
      }
      toast.success(t("dispatched"));
      onOpenChange(false);
      onDispatched?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="execute-automation-dialog">
        <DialogHeader>
          <DialogTitle>{title ?? t("title")}</DialogTitle>
          <DialogDescription>
            {description ?? t("description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("target")}</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger data-testid="execute-automation-target-select">
                <SelectValue placeholder={t("targetPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {enabledTargets.map((target) => (
                  <SelectItem key={target.id} value={String(target.id)}>
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="execute-automation-ref">{t("ref")}</Label>
            <Input
              id="execute-automation-ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder={selected?.defaultRef ?? ""}
              className="font-mono text-sm"
              data-testid="execute-automation-ref-input"
            />
            <p className="text-xs text-muted-foreground">{t("refHelp")}</p>
          </div>
          <p
            className="text-sm font-medium"
            data-testid="execute-automation-summary"
          >
            {t("caseCountSummary", { count: caseCount })}
          </p>
          {runId != null && (
            <p className="text-xs text-muted-foreground">
              {t("resultsNote", { runId })}
            </p>
          )}
          {error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="execute-automation-error"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="execute-automation-cancel"
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!selected || submitting || caseCount === 0}
            data-testid="execute-automation-submit"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlay className="h-4 w-4" />
            )}
            <span>{submitting ? t("submitting") : t("submit")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Turn the execute routes' JSON errors into a message for the dialog. */
export async function readExecuteError(
  res: Response,
  fallback: string
): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; code?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}
