"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Papa from "papaparse";
import { useState } from "react";
import { toast } from "sonner";
import {
  buildRowSchemaFromParameters,
  type ParameterShape,
} from "~/lib/schemas/datasetRowSchema";

interface ParameterRecord {
  id: number;
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  sensitive: boolean;
  required: boolean;
  allowedValuesJson?: unknown;
  lookupAllowedValues?: string[];
}

export interface PasteCsvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  parameters: ParameterRecord[];
}

interface ParsedState {
  rows: Record<string, unknown>[];
  errors: { rowIndex: number; message: string }[];
}

/**
 * Surface D.5 — inline "Paste CSV" dialog. Opens from the dataset toolbar
 * and accepts pasted CSV rows. Uses papaparse with the canonical Phase 2
 * config (RESEARCH HOW Q10 lock); UTF-8 BOM is stripped automatically by
 * papaparse (Pitfall 4).
 *
 * Submits to the same import-csv endpoint as the multi-step wizard
 * (Plan 02-05) — atomicity is enforced server-side per the Plan 02-02
 * endpoint contract.
 */
export function PasteCsvDialog({
  open,
  onOpenChange,
  caseId,
  parameters,
}: PasteCsvDialogProps) {
  const tCommon = useTranslations("common");
  const t = useTranslations("parameters");
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState("");
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const [parsed, setParsed] = useState<ParsedState>({ rows: [], errors: [] });
  const [submitting, setSubmitting] = useState(false);

  const handleParse = () => {
    Papa.parse<Record<string, unknown>>(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const paramShapes: ParameterShape[] = parameters.map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
          allowedValuesJson: p.allowedValuesJson,
          lookupAllowedValues: p.lookupAllowedValues,
        }));
        const rowSchema = buildRowSchemaFromParameters(paramShapes);
        const rowErrors: { rowIndex: number; message: string }[] = [];
        (results.data as Record<string, unknown>[]).forEach((row, idx) => {
          const result = (rowSchema as any).safeParse(row);
          if (!result.success) {
            rowErrors.push({
              rowIndex: idx,
              message: result.error?.issues?.[0]?.message ?? "Invalid value",
            });
          }
        });
        setParsed({
          rows: results.data as Record<string, unknown>[],
          errors: rowErrors,
        });
      },
    });
  };

  const reset = () => {
    setCsvText("");
    setParsed({ rows: [], errors: [] });
    setMode("replace");
  };

  const handleSubmit = async () => {
    if (parsed.rows.length === 0) return;
    setSubmitting(true);
    try {
      // Auto-map CSV header → parameter name. Headers that match a parameter
      // name 1:1 are mapped through; everything else is skipped.
      const headers = Object.keys(parsed.rows[0] ?? {});
      const mapping: Record<string, string> = {};
      const paramNames = new Set(parameters.map((p) => p.name));
      headers.forEach((h) => {
        mapping[h] = paramNames.has(h) ? h : "__skip__";
      });

      const res = await fetch(
        `/api/repository/cases/${caseId}/dataset/import-csv`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode,
            mapping,
            rows: parsed.rows,
          }),
        }
      );
      if (!res.ok) {
        toast.error(t("datasetSaveError"));
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        created?: number;
      };
      toast.success(
        t("importSuccess", {
          count: json?.created ?? parsed.rows.length,
        })
      );
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "DataSetRow"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "DataSet"],
      });
      reset();
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const summaryText =
    parsed.errors.length === 0
      ? t("importStep3SummaryOk", { totalRows: parsed.rows.length })
      : t("importStep3SummaryErrors", {
          totalRows: parsed.rows.length,
          errorCount: parsed.errors.length,
        });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="paste-csv-dialog">
        <DialogHeader>
          <DialogTitle>{t("datasetPasteCsv")}</DialogTitle>
          <DialogDescription>{t("pasteCsvPlaceholder")}</DialogDescription>
        </DialogHeader>

        <Textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={t("pasteCsvPlaceholder")}
          rows={6}
          data-testid="paste-csv-textarea"
        />

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleParse}
            disabled={csvText.trim().length === 0}
            data-testid="paste-csv-parse-button"
          >
            {t("pasteCsvParseButton")}
          </Button>
        </div>

        {parsed.rows.length > 0 ? (
          <>
            <Alert
              variant={parsed.errors.length > 0 ? "destructive" : "default"}
              data-testid="paste-csv-summary"
            >
              {summaryText}
            </Alert>

            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "replace" | "append")}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="replace"
                  id="paste-csv-mode-replace"
                  data-testid="paste-csv-mode-replace"
                />
                <label htmlFor="paste-csv-mode-replace" className="text-sm">
                  {t("importStep4Replace")}
                </label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="append"
                  id="paste-csv-mode-append"
                  data-testid="paste-csv-mode-append"
                />
                <label htmlFor="paste-csv-mode-append" className="text-sm">
                  {t("importStep4Append")}
                </label>
              </div>
            </RadioGroup>
          </>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={handleSubmit}
            disabled={
              submitting || parsed.rows.length === 0 || parsed.errors.length > 0
            }
            data-testid="paste-csv-submit"
          >
            {t("importCommit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
