"use client";

import { Separator } from "@/components/ui/separator";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { formatRequirementCellText } from "~/utils/issueDisplayText";
import {
  REQUIREMENT_COVERAGE_CHART_COLORS,
  RequirementHierarchyBars,
  type HierarchyGroup,
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

const TOP_HIERARCHY_LIMIT = 10;

/**
 * Display heuristic ONLY (a stat tile, never a gate): statuses are
 * free-text per project/tracker, so "closed" has no canonical flag in the
 * data model. This set covers the standard closed-ish vocabulary of the
 * supported trackers; a project with its own vocabulary simply counts 0
 * here and loses nothing but the tile's insight.
 */
const CLOSED_STATUS_HEURISTIC = new Set([
  "closed",
  "done",
  "resolved",
  "completed",
  "complete",
  "rejected",
  "cancelled",
  "canceled",
  "won't do",
  "wont do",
  "wontfix",
]);

const DAY_MS = 24 * 60 * 60 * 1000;

export function RequirementDebtOverview({ rows }: { rows: DebtRow[] }) {
  const t = useTranslations("requirements.coverage");
  const tReports = useTranslations("reports.ui.requirementCoverage");
  const locale = useLocale();

  const { counts, hierarchyGroups, foldedCount, otherTotal, ageBuckets } =
    useMemo(() => {
      const counts = {
        total: rows.length,
        uncovered: 0,
        notRun: 0,
        onClosed: 0,
      };
      const groupsByRoot = new Map<string, HierarchyGroup>();
      const now = Date.now();
      // Half-open ranges checked in order: [0,30) [30,90) [90,180)
      // [180,365) [365,∞) — an item exactly on a boundary lands in the
      // HIGHER bucket.
      const bucketDefs = [
        { key: "ageUnder30", max: 30 },
        { key: "age30to90", max: 90 },
        { key: "age90to180", max: 180 },
        { key: "age180to365", max: 365 },
        { key: "ageOver365", max: Infinity },
      ];
      const ageCounts = bucketDefs.map(() => ({
        UNCOVERED: 0,
        NOT_RUN: 0,
      })) as Array<Record<string, number>>;

      for (const row of rows) {
        const status =
          row.coverageStatus === "NOT_RUN" ? "NOT_RUN" : "UNCOVERED";
        if (status === "NOT_RUN") counts.notRun += 1;
        else counts.uncovered += 1;

        if (
          CLOSED_STATUS_HEURISTIC.has(
            (row.requirementStatus ?? "").trim().toLowerCase()
          )
        ) {
          counts.onClosed += 1;
        }

        const root = row.requirementParentPath
          ? row.requirementParentPath.split(" > ")[0]
          : formatRequirementCellText(row);
        let group = groupsByRoot.get(root);
        if (!group) {
          group = { label: root, counts: {}, total: 0 };
          groupsByRoot.set(root, group);
        }
        const rootId =
          row.requirementRootId ??
          (!row.requirementParentPath ? row.requirementId : undefined);
        if (group.requirementId == null && rootId != null) {
          group.requirementId = rootId;
        }
        group.counts[status] = (group.counts[status] ?? 0) + 1;
        group.total += 1;

        const createdMs = row.requirementCreatedAt
          ? Date.parse(row.requirementCreatedAt)
          : NaN;
        if (Number.isFinite(createdMs)) {
          const ageDays = Math.max(0, (now - createdMs) / DAY_MS);
          const bucket = bucketDefs.findIndex((def) => ageDays < def.max);
          const target =
            ageCounts[bucket === -1 ? bucketDefs.length - 1 : bucket];
          target[status] = (target[status] ?? 0) + 1;
        }
      }

      const ranked = [...groupsByRoot.values()].sort(
        (a, b) => b.total - a.total || a.label.localeCompare(b.label)
      );
      const top = ranked.slice(0, TOP_HIERARCHY_LIMIT);
      const folded = ranked.slice(TOP_HIERARCHY_LIMIT);
      const otherTotal = folded.reduce((sum, group) => sum + group.total, 0);

      const ageBuckets: HierarchyGroup[] = bucketDefs.map((def, index) => ({
        label: def.key,
        counts: ageCounts[index],
        total:
          (ageCounts[index].UNCOVERED ?? 0) + (ageCounts[index].NOT_RUN ?? 0),
      }));

      return {
        counts,
        hierarchyGroups: top,
        foldedCount: folded.length,
        otherTotal,
        ageBuckets,
      };
    }, [rows]);

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
