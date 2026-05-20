"use client";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTranslations } from "next-intl";

export interface ConfirmStepProps {
  validRowCount: number;
  errorRowCount: number;
  existingRowCount: number;
  mode: "replace" | "append";
  onModeChange: (mode: "replace" | "append") => void;
}

/**
 * Surface E.5 — Step 4 (Confirm).
 *
 * Shows the validation summary and the Replace/Append radio. When
 * `errorRowCount > 0` an Alert banner explains that the user must
 * return to Step 3 to resolve errors before the wizard shell will
 * enable the Import button.
 */
export function ConfirmStep({
  validRowCount,
  errorRowCount,
  existingRowCount,
  mode,
  onModeChange,
}: ConfirmStepProps) {
  const t = useTranslations("parameters");

  return (
    <div
      className="p-6 space-y-4"
      data-testid="dataset-import-wizard-step-confirm"
    >
      <h3 className="text-base font-semibold">{t("importStep4Heading")}</h3>

      {errorRowCount > 0 && (
        <Alert
          variant="destructive"
          data-testid="dataset-import-wizard-confirm-error"
        >
          {t("importStep4ErrorBlock", { errorCount: String(errorRowCount) })}
        </Alert>
      )}

      <Card className="p-4 shadow-none">
        <div className="text-sm space-y-1">
          <div data-testid="dataset-import-wizard-confirm-valid-count">
            {t("confirmSummaryValid", { count: String(validRowCount) })}
          </div>
          <div data-testid="dataset-import-wizard-confirm-error-count">
            {t("confirmSummaryErrors", { count: String(errorRowCount) })}
          </div>
          <div data-testid="dataset-import-wizard-confirm-mode">
            {t("confirmSummaryMode", { mode })}
          </div>
        </div>
      </Card>

      <RadioGroup
        value={mode}
        onValueChange={(v) => onModeChange(v as "replace" | "append")}
      >
        <div className="flex items-start gap-2">
          <RadioGroupItem
            value="replace"
            id="dataset-import-wizard-mode-replace"
            data-testid="dataset-import-wizard-mode-replace"
          />
          <div>
            <label
              htmlFor="dataset-import-wizard-mode-replace"
              className="font-medium text-sm"
            >
              {t("importStep4Replace")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("importStep4ReplaceDescription", {
                existingCount: String(existingRowCount),
              })}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <RadioGroupItem
            value="append"
            id="dataset-import-wizard-mode-append"
            data-testid="dataset-import-wizard-mode-append"
          />
          <div>
            <label
              htmlFor="dataset-import-wizard-mode-append"
              className="font-medium text-sm"
            >
              {t("importStep4Append")}
            </label>
            <p className="text-xs text-muted-foreground">
              {t("importStep4AppendDescription", {
                existingCount: String(existingRowCount),
              })}
            </p>
          </div>
        </div>
      </RadioGroup>
    </div>
  );
}
