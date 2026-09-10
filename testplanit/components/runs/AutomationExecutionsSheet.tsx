"use client";

import { DateFormatter } from "@/components/DateFormatter";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import type { TestRunExecutionRow } from "~/hooks/useTestRunExecutions";
import { executionBadgeVariant } from "./AutomationExecutionChip";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  executions: TestRunExecutionRow[];
}

export function AutomationExecutionsSheet({
  open,
  onOpenChange,
  executions,
}: Props) {
  const t = useTranslations("automation.execute");
  const tGlobal = useTranslations();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto"
        data-testid="automation-executions-sheet"
      >
        <SheetHeader>
          <SheetTitle>{t("historyTitle")}</SheetTitle>
          <SheetDescription>{t("historyDescription")}</SheetDescription>
        </SheetHeader>
        {executions.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {t("historyEmpty")}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table data-testid="automation-executions-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columnStatus")}</TableHead>
                  <TableHead>{t("columnTarget")}</TableHead>
                  <TableHead>{t("columnRef")}</TableHead>
                  <TableHead>{t("columnCases")}</TableHead>
                  <TableHead>{t("columnRequested")}</TableHead>
                  <TableHead>{t("columnCompleted")}</TableHead>
                  <TableHead>{t("columnLink")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {executions.map((execution) => (
                  <TableRow
                    key={execution.id}
                    data-testid={`automation-execution-row-${execution.id}`}
                  >
                    <TableCell>
                      <div className="space-y-1">
                        <Badge
                          variant={executionBadgeVariant(execution.status)}
                        >
                          {tGlobal(
                            `enums.TestRunExecutionStatus.${execution.status as "PENDING"}`
                          )}
                        </Badge>
                        {execution.error && (
                          <p className="max-w-xs text-xs text-destructive">
                            {execution.error}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {execution.target?.name ??
                        tGlobal(
                          `enums.ExecutionProvider.${execution.provider as "GITHUB_ACTIONS"}`
                        )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {execution.ref ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {execution.selectionCount}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>
                        {execution.requestedBy?.name ??
                          execution.requestedBy?.email ??
                          ""}
                      </div>
                      <DateFormatter date={execution.createdAt} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {execution.completedAt ? (
                        <DateFormatter date={execution.completedAt} />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {execution.externalUrl && (
                        <a
                          href={execution.externalUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-xs underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>
                            {execution.externalRunId ?? t("columnLink")}
                          </span>
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
