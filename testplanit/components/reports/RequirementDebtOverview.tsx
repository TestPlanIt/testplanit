"use client";

import { Separator } from "@/components/ui/separator";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  summarizeRequirementDebt,
  type RequirementDebtSummary,
} from "~/utils/requirementReportSummaries";
import {
  REQUIREMENT_COVERAGE_CHART_COLORS,
  RequirementHierarchyBars,
} from "./RequirementCoverageOverview";

/**
 * The Coverage Gaps (coverage-debt) report's visualization panel — the
 * triage questions a reader asks before the table: how big is the debt
 * (tiles, including the prunable "on closed requirements" slice), WHERE
 * it concentrates (debt by top-level requirement), and how OLD it is
 * (aging buckets — fresh churn vs accumulating rot). Everything derives
 * from the same rows the table renders.
 *
 * Only the two debt states exist here (amber UNCOVERED / gray NOT_RUN) —
 * both from the validated status palette, and non-adjacent-pair-safe by
 * the same run that validated the four-state order.
 */

interface DebtRow {
  requirementId: number;
  coverageStatus?: string;
  requirementStatus?: string | null;
  requirementParentPath?: string;
  requirementKey?: string;
  requirementTitle?: string | null;
  requirementCreatedAt?: string | null;
  requirementRootId?: number;
}

const DEBT_STATE_ORDER = ["UNCOVERED", "NOT_RUN"] as const;

export function RequirementDebtOverview({
  rows,
  summary: serverSummary,
}: {
  rows: DebtRow[];
  /** The server's numbers over the whole set; when present, `rows` may
   * be one page and the panel draws from this instead. */
  summary?: RequirementDebtSummary | null;
}) {
  const t = useTranslations("requirements.coverage");
  const tReports = useTranslations("reports.ui.requirementCoverage");
  const locale = useLocale();

  // The arithmetic lives in utils/requirementReportSummaries (shared with
  // the handler); this only attaches labels and colors.
  const { counts, hierarchyGroups, foldedCount, otherTotal, ageBuckets } =
    useMemo(
      () => serverSummary ?? summarizeRequirementDebt(rows),
      [serverSummary, rows]
    );

  if (counts.total === 0) {
    return null;
  }

  const formatCount = (value: number) => value.toLocaleString(locale);

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-4 xl:flex-row"
      data-testid="requirement-debt-overview"
    >
      <div className="w-[210px] shrink-0 space-y-1">
        <DebtTile
          label={tReports("totalDebt")}
          value={formatCount(counts.total)}
          testId="debt-summary-total"
        />
        <DebtTile
          label={t("uncovered")}
          value={formatCount(counts.uncovered)}
          dotColor={REQUIREMENT_COVERAGE_CHART_COLORS.UNCOVERED}
          testId="debt-summary-uncovered"
        />
        <DebtTile
          label={t("statusNotRun")}
          value={formatCount(counts.notRun)}
          dotColor={REQUIREMENT_COVERAGE_CHART_COLORS.NOT_RUN}
          testId="debt-summary-not_run"
        />
        {/* The prunable slice: debt on requirements that are already
            closed is usually a cleanup list, not a testing backlog. */}
        <DebtTile
          label={tReports("onClosedRequirements")}
          value={formatCount(counts.onClosed)}
          testId="debt-summary-on-closed"
        />
      </div>

      <Separator orientation="vertical" className="hidden xl:block" />
      <Separator className="xl:hidden" />

      <RequirementHierarchyBars
        heading={tReports("debtByHierarchy")}
        groups={hierarchyGroups}
        states={DEBT_STATE_ORDER}
        otherLabel={
          foldedCount > 0
            ? tReports("otherRoots", { count: foldedCount })
            : null
        }
        otherTotal={foldedCount > 0 ? otherTotal : null}
        // Equal halves with the aging chart: zero basis + equal grow
        // splits the space after the fixed tiles column 50/50.
        className="min-h-0 min-w-0 flex-1 basis-0 overflow-auto"
        containerTestId="requirement-debt-hierarchies"
        barTestIdPrefix="debt-hierarchy-bar"
        segmentTestIdPrefix="debt-hierarchy-segment"
        otherTestId="requirement-debt-hierarchy-other"
      />

      <Separator orientation="vertical" className="hidden xl:block" />
      <Separator className="xl:hidden" />

      <RequirementHierarchyBars
        heading={tReports("debtAging")}
        groups={ageBuckets.map((bucket) => ({
          ...bucket,
          label: tReports(bucket.label),
        }))}
        states={DEBT_STATE_ORDER}
        className="min-h-0 min-w-0 flex-1 basis-0 overflow-auto"
        containerTestId="requirement-debt-aging"
        barTestIdPrefix="debt-aging-bar"
        segmentTestIdPrefix="debt-aging-segment"
        otherTestId="requirement-debt-aging-other"
      />
    </div>
  );
}

function DebtTile({
  label,
  value,
  dotColor,
  testId,
}: {
  label: string;
  value: string;
  dotColor?: string;
  testId: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 rounded border bg-card px-2 py-1"
      data-testid={testId}
    >
      {dotColor ? (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
        {label}
      </span>
      <span className="text-xs font-semibold tabular-nums">{value}</span>
    </div>
  );
}
