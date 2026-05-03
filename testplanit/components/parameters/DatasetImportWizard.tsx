"use client";

import { ConfirmStep } from "@/components/parameters/wizard/ConfirmStep";
import { MapColumnsStep } from "@/components/parameters/wizard/MapColumnsStep";
import { PreviewStep } from "@/components/parameters/wizard/PreviewStep";
import { UploadStep } from "@/components/parameters/wizard/UploadStep";
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
import { WizardStepIndicator } from "@/components/ui/WizardStepIndicator";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Papa from "papaparse";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { ParameterShape } from "~/lib/schemas/datasetRowSchema";

interface ParameterRecord {
  id: number;
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  sensitive: boolean;
  required: boolean;
  allowedValuesJson?: unknown;
  lookupAllowedValues?: string[];
}

export interface DatasetImportWizardProps {
  open: boolean;
  onClose: () => void;
  caseId: number;
  parameters: ParameterRecord[];
  existingRowCount: number;
}

/**
 * Surface E — multi-step CSV import wizard.
 *
 * 4 steps (Upload → Map columns → Preview → Confirm) consuming the
 * shared `WizardStepIndicator` extracted in Plan 02-01. Dialog width
 * matches the existing `ImportCasesWizard`. Final commit POSTs to the
 * Plan 02-02 import-csv endpoint.
 *
 * Cancel-after-upload uses a shadcn `AlertDialog` per
 * `feedback_no_native_dialogs` — never the native browser confirm.
 *
 * Mounted by `ConfigureParametersSheet` and triggered through the
 * DatasetTab's Import CSV toolbar button (see `onOpenImportWizard`).
 */
export function DatasetImportWizard({
  open,
  onClose,
  caseId,
  parameters,
  existingRowCount,
}: DatasetImportWizardProps) {
  const t = useTranslations("parameters");
  const tActions = useTranslations("common.actions");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [currentStep, setCurrentStep] = useState(1);
  const [csvText, setCsvText] = useState("");
  const [csvRows, setCsvRows] = useState<Record<string, unknown>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mapValid, setMapValid] = useState(false);
  const [errorRowCount, setErrorRowCount] = useState(0);
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const stepLabels = useMemo(
    () => [
      t("importStep1Label"),
      t("importStep2Label"),
      t("importStep3Label"),
      t("importStep4Label"),
    ],
    [t],
  );

  const validRowCount = Math.max(0, csvRows.length - errorRowCount);

  const reset = () => {
    setCurrentStep(1);
    setCsvText("");
    setCsvRows([]);
    setCsvHeaders([]);
    setMapping({});
    setMapValid(false);
    setErrorRowCount(0);
    setMode("replace");
  };

  const parameterShapes = useMemo<ParameterShape[]>(
    () =>
      parameters.map((p) => ({
        name: p.name,
        type: p.type,
        required: p.required,
        allowedValuesJson: p.allowedValuesJson,
        lookupAllowedValues: p.lookupAllowedValues,
      })),
    [parameters],
  );

  const mapStepParameters = useMemo(
    () =>
      parameters.map((p) => ({ name: p.name, required: p.required })),
    [parameters],
  );

  const handleFileSelected = (_file: File, text: string) => {
    setCsvText(text);
    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = (results.data as Record<string, unknown>[]) ?? [];
        setCsvRows(rows);
        setCsvHeaders(Object.keys(rows[0] ?? {}));
        setMapping({});
        setCurrentStep(2);
      },
    });
  };

  const handleAttemptClose = () => {
    if (csvText !== "" && currentStep > 1) {
      setShowCancelConfirm(true);
      return;
    }
    reset();
    onClose();
  };

  const handleConfirmCancel = () => {
    setShowCancelConfirm(false);
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (errorRowCount > 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/repository/cases/${caseId}/dataset/import-csv`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode, mapping, rows: csvRows }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}) as Record<string, unknown>);
        const errCount = Array.isArray((j as any).errors)
          ? (j as any).errors.length
          : 1;
        toast.error(t("datasetSaveBlocked", { count: errCount }));
        setSubmitting(false);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        created?: number;
      };
      toast.success(
        t("importSuccess", {
          count: json?.created ?? csvRows.length,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ["zenstack", "DataSetRow"] });
      void queryClient.invalidateQueries({ queryKey: ["zenstack", "DataSet"] });
      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const renderStepBody = () => {
    switch (currentStep) {
      case 1:
        return <UploadStep onFileSelected={handleFileSelected} />;
      case 2:
        return (
          <MapColumnsStep
            csvHeaders={csvHeaders}
            parameters={mapStepParameters}
            mapping={mapping}
            onMappingChange={setMapping}
            onValidityChange={setMapValid}
          />
        );
      case 3:
        return (
          <PreviewStep
            rows={csvRows}
            mapping={mapping}
            parameters={parameterShapes}
            onValidityChange={setErrorRowCount}
          />
        );
      case 4:
        return (
          <ConfirmStep
            validRowCount={validRowCount}
            errorRowCount={errorRowCount}
            existingRowCount={existingRowCount}
            mode={mode}
            onModeChange={setMode}
          />
        );
      default:
        return null;
    }
  };

  const nextDisabled =
    submitting ||
    (currentStep === 1 && csvRows.length === 0) ||
    (currentStep === 2 && !mapValid);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) handleAttemptClose();
        }}
      >
        <DialogContent
          className="sm:max-w-4xl max-h-[80vh] overflow-hidden flex flex-col p-0"
          data-testid="dataset-import-wizard"
        >
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>{t("datasetImportCsv")}</DialogTitle>
            <DialogDescription>
              {stepLabels[currentStep - 1]}
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 border-b bg-muted/30">
            <WizardStepIndicator
              currentStep={currentStep}
              totalSteps={4}
              labels={stepLabels}
            />
          </div>

          <div className="flex-1 overflow-auto">{renderStepBody()}</div>

          <DialogFooter className="px-6 py-4 border-t flex sm:justify-end gap-2">
            {currentStep > 1 && (
              <Button
                variant="ghost"
                onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
                disabled={submitting}
                data-testid="dataset-import-wizard-back"
              >
                {tActions("back")}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleAttemptClose}
              disabled={submitting}
              data-testid="dataset-import-wizard-cancel"
            >
              {tCommon("cancel")}
            </Button>
            {currentStep < 4 ? (
              <Button
                variant="default"
                onClick={() => setCurrentStep((s) => Math.min(4, s + 1))}
                disabled={nextDisabled}
                data-testid="dataset-import-wizard-next"
              >
                {tActions("next")}
              </Button>
            ) : (
              <Button
                variant="default"
                onClick={handleSubmit}
                disabled={errorRowCount > 0 || submitting}
                data-testid="dataset-import-wizard-commit"
              >
                {t("importCommit")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={showCancelConfirm}
        onOpenChange={setShowCancelConfirm}
      >
        <AlertDialogContent
          data-testid="dataset-import-wizard-cancel-confirm"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancelUploadTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cancelUploadDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tActions("back")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCancel}>
              {tCommon("cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
