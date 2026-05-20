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
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslations } from "next-intl";

import type { PreflightResult } from "~/lib/types/iterationCardinality";

export interface RunCardinalityHardRefuseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: PreflightResult | null;
  /** Number of configurations the modal would have multiplied by. */
  configCount: number;
}

/**
 * Surface E.2 — Hard-refusal cardinality breakdown dialog.
 *
 * Informational only — opened from `RunPreflightChip` when the
 * classification is `hardRefuse`. Lists each parameterized case sorted by
 * iteration contribution descending so the user can identify the cases
 * driving the cardinality blow-up. No Confirm action.
 */
export function RunCardinalityHardRefuseDialog({
  open,
  onOpenChange,
  result,
  configCount,
}: RunCardinalityHardRefuseDialogProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");

  if (!result) return null;
  const cap = result.thresholds.hardCap;
  const fanOut = Math.max(1, configCount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        data-testid="run-cardinality-hard-refuse-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("hardRefuseTitle")}</DialogTitle>
          <DialogDescription>
            {t("hardRefuseDescription", { cap: String(cap) })}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("hardRefuseColumnCase")}</TableHead>
                <TableHead className="text-right">
                  {t("hardRefuseColumnRows")}
                </TableHead>
                <TableHead className="text-right">
                  {t("hardRefuseColumnConfigs")}
                </TableHead>
                <TableHead className="text-right">
                  {t("hardRefuseColumnIterations")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.perCase.map((row) => (
                <TableRow
                  key={row.caseId}
                  data-testid={`hard-refuse-row-${row.caseId}`}
                >
                  <TableCell className="font-medium">{row.caseTitle}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.rowCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fanOut}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.iterations}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-semibold">
                  {t("hardRefuseTotalRow")}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {result.total}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("hardRefuseSuggestionsHeading")}
          </p>
          <ul className="list-disc pl-6 text-sm space-y-1">
            <li>{t("hardRefuseSuggestion1")}</li>
            <li>{t("hardRefuseSuggestion2")}</li>
            <li>{t("hardRefuseSuggestion3")}</li>
          </ul>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="hard-refuse-close-button"
          >
            {tCommon("actions.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
