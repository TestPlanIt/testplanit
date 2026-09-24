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
import { Textarea } from "@/components/ui/textarea";
import { BookmarkPlus, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useCreateFrozenReportLink } from "~/hooks/useCreateFrozenReportLink";
import type { FrozenTruncation } from "~/hooks/useCreateFrozenReportLink";
import {
  buildSavedReportConfig,
  SAVED_REPORT_DESCRIPTION_MAX_LENGTH,
  SAVED_REPORT_NAME_MAX_LENGTH,
  useSavedReports,
} from "~/hooks/useSavedReports";
import {
  FrozenTruncationWarning,
  ReportDataModeField,
  type ReportDataMode,
} from "./ReportDataModeField";

interface SaveReportButtonProps {
  /** The report's project; omitted for cross-project reports. */
  projectId?: number;
  reportConfig: Record<string, unknown>;
  reportTitle?: string;
}

/** Saves the report on screen to the user's private Saved Reports. */
export function SaveReportButton({
  projectId,
  reportConfig,
  reportTitle,
}: SaveReportButtonProps) {
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        data-testid="save-report-button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-0 group overflow-hidden transition-all hover:gap-2"
      >
        <BookmarkPlus className="h-4 w-4 shrink-0" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all group-hover:max-w-xs">
          {tCommon("actions.save")}
        </span>
      </Button>
      {open && (
        <SaveReportDialog
          onOpenChange={setOpen}
          projectId={projectId ?? null}
          reportConfig={reportConfig}
          reportTitle={reportTitle}
        />
      )}
    </>
  );
}

interface SaveReportDialogProps {
  onOpenChange: (open: boolean) => void;
  projectId: number | null;
  reportConfig: Record<string, unknown>;
  reportTitle?: string;
}

function SaveReportDialog({
  onOpenChange,
  projectId,
  reportConfig,
  reportTitle,
}: SaveReportDialogProps) {
  const t = useTranslations("reports.savedReports");
  const tCommon = useTranslations("common");
  const [name, setName] = useState(reportTitle ?? "");
  const [description, setDescription] = useState("");
  const [dataMode, setDataMode] = useState<ReportDataMode>("live");
  const [truncation, setTruncation] = useState<FrozenTruncation | null>(null);

  const { saveLiveReport, isSaving } = useSavedReports({
    projectId,
    enabled: false,
  });
  const { createFrozenLink, isCreatingFrozen } = useCreateFrozenReportLink();
  const isBusy = isSaving || isCreatingFrozen;
  const trimmedName = name.trim();

  const handleSave = async (allowTruncate = false) => {
    if (!trimmedName) return;
    try {
      if (dataMode === "frozen") {
        const result = await createFrozenLink({
          entityType: "SAVED_REPORT",
          reportConfig: buildSavedReportConfig(reportConfig, projectId),
          projectId,
          title: trimmedName,
          description: description.trim() || null,
          allowTruncate,
        });
        if (result.status === "truncation-required") {
          setTruncation(result.truncation);
          return;
        }
      } else {
        await saveLiveReport({
          name: trimmedName,
          description,
          reportConfig,
        });
      }
      setTruncation(null);
      toast.success(t("saved"), {
        description: t("savedDescription", { name: trimmedName }),
      });
      onOpenChange(false);
    } catch (error) {
      setTruncation(null);
      console.error("Error saving report:", error);
      toast.error(t("saveFailed"));
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="save-report-dialog">
        <DialogHeader>
          <DialogTitle>{t("saveTitle")}</DialogTitle>
          <DialogDescription>{t("saveDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="save-report-name">{tCommon("name")}</Label>
            <Input
              id="save-report-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={SAVED_REPORT_NAME_MAX_LENGTH}
              autoFocus
              data-testid="save-report-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="save-report-description">
              {tCommon("fields.description")}
            </Label>
            <Textarea
              id="save-report-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={SAVED_REPORT_DESCRIPTION_MAX_LENGTH}
              rows={2}
              data-testid="save-report-description-input"
            />
          </div>
          <ReportDataModeField
            value={dataMode}
            onChange={(value) => {
              setDataMode(value);
              setTruncation(null);
            }}
          />
          <FrozenTruncationWarning
            truncation={truncation}
            disabled={isBusy}
            onCancel={() => setTruncation(null)}
            onConfirm={() => void handleSave(true)}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={isBusy || !trimmedName}
            data-testid="save-report-submit"
          >
            {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {tCommon("actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
