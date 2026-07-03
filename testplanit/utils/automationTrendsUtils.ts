import { baseDb } from "@/lib/db";
import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { authenticateRequest } from "~/lib/api-token-auth";
import { authOptions } from "~/server/auth";

interface PeriodData {
  periodStart: string;
  periodEnd: string;
  [key: string]: number | string; // Dynamic project columns
}

type DateGrouping = "daily" | "weekly" | "monthly" | "quarterly" | "annually";

function getPeriodDates(
  date: Date,
  grouping: DateGrouping
): { start: Date; end: Date } {
  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );

  switch (grouping) {
    case "daily": {
      const start = new Date(utcDate);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(utcDate);
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }
    case "weekly": {
      const start = new Date(utcDate);
      const day = start.getUTCDay();
      const daysSinceSunday = day === 0 ? 6 : day - 1;
      start.setUTCDate(start.getUTCDate() - daysSinceSunday);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }
    case "monthly": {
      const start = new Date(
        Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), 1, 0, 0, 0, 0)
      );
      // End is the last millisecond of the last day of the month
      const end = new Date(
        Date.UTC(
          utcDate.getUTCFullYear(),
          utcDate.getUTCMonth() + 1,
          1,
          0,
          0,
          0,
          0
        )
      );
      end.setUTCMilliseconds(-1); // Go back 1ms from start of next month
      return { start, end };
    }
    case "quarterly": {
      const quarter = Math.floor(utcDate.getUTCMonth() / 3);
      const start = new Date(
        Date.UTC(utcDate.getUTCFullYear(), quarter * 3, 1, 0, 0, 0, 0)
      );
      // End is the last millisecond of the last day of the quarter
      const end = new Date(
        Date.UTC(utcDate.getUTCFullYear(), quarter * 3 + 3, 1, 0, 0, 0, 0)
      );
      end.setUTCMilliseconds(-1); // Go back 1ms from start of next quarter
      return { start, end };
    }
    case "annually": {
      const start = new Date(
        Date.UTC(utcDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0)
      );
      // End is the last millisecond of December 31st
      const end = new Date(
        Date.UTC(utcDate.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0)
      );
      end.setUTCMilliseconds(-1); // Go back 1ms from start of next year
      return { start, end };
    }
    default:
      return getPeriodDates(date, "weekly");
  }
}

/**
 * Generate a contiguous list of periods spanning [lo, hi] at the given grouping.
 * Unlike deriving periods only from dates that have activity, this fills gaps so
 * the cumulative trend line is continuous.
 */
export function generatePeriods(
  lo: Date,
  hi: Date,
  grouping: DateGrouping
): { start: Date; end: Date }[] {
  const periods: { start: Date; end: Date }[] = [];
  if (lo > hi) return periods;

  let cursor = getPeriodDates(lo, grouping).start;
  const hiTime = hi.getTime();
  let guard = 0;
  while (cursor.getTime() <= hiTime && guard < 100000) {
    const period = getPeriodDates(cursor, grouping);
    periods.push(period);
    // Jump into the next period (1ms past the current period's end)
    cursor = new Date(period.end.getTime() + 1);
    guard++;
  }
  return periods;
}

/**
 * Resolve a case's automated state as of a point in time using its version
 * timeline. `history` must be sorted ascending by timestamp. Returns whether the
 * case existed yet (created on/before the time) and its automated value then.
 */
export function automatedStateAt(
  history: { at: number; automated: boolean }[] | undefined,
  atTime: number
): { existed: boolean; automated: boolean } {
  if (!history || history.length === 0) {
    return { existed: false, automated: false };
  }
  // Not yet created as of this time
  if (atTime < history[0].at) {
    return { existed: false, automated: false };
  }
  // Latest version whose snapshot was taken on/before atTime
  let automated = history[0].automated;
  for (const point of history) {
    if (point.at <= atTime) {
      automated = point.automated;
    } else {
      break;
    }
  }
  return { existed: true, automated };
}

export async function handleAutomationTrendsPOST(
  req: NextRequest,
  isCrossProject: boolean
) {
  try {
    // Check admin access for cross-project
    if (isCrossProject) {
      const session = await getServerSession(authOptions);
      const auth = await authenticateRequest(req, session);
      if (!auth.authenticated) {
        return Response.json({ error: auth.error }, { status: auth.status });
      }
      if (auth.user.access !== "ADMIN") {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const {
      projectId,
      dimensions: _dimensions = [],
      startDate,
      endDate,
      page = 1,
      pageSize: pageSizeParam = 10,
      sortColumn,
      sortDirection = "desc",
      dateGrouping = "weekly",
    } = body;

    // Handle pageSize "All" - since we return all data anyway, just normalize it
    const pageSize =
      pageSizeParam === "All" ? undefined : Number(pageSizeParam);

    // Extract all filter values
    const projectIds = body.projectIds || [];
    const dynamicFieldFilters = body.dynamicFieldFilters || {};
    const templateIds = body.templateIds || [];
    const stateIds = body.stateIds || [];
    const automatedFilter = body.automated || [];

    // For project-specific, require projectId
    if (!isCrossProject && !projectId) {
      return Response.json(
        { error: "Project ID is required" },
        { status: 400 }
      );
    }

    // Build base where clause with standard filters.
    // NOTE: The date range (startDate/endDate) intentionally does NOT filter the
    // case population here — it governs the period axis below. Excluding cases by
    // createdAt would drop cases created before the window that still exist during
    // it, understating the cumulative counts. All field filters read the CURRENT
    // RepositoryCases record; only the automation timing comes from versions.
    const baseWhere: any = {
      ...(isCrossProject
        ? projectIds.length > 0
          ? { projectId: { in: projectIds.map(Number) } } // Filtered projects for cross-project
          : {} // All projects for cross-project
        : { projectId: Number(projectId) }), // Single project
      isDeleted: false,
    };

    // Add templateIds filter if provided
    if (templateIds.length > 0) {
      baseWhere.templateId = { in: templateIds.map(Number) };
    }

    // Add stateIds filter if provided
    if (stateIds.length > 0) {
      baseWhere.stateId = { in: stateIds.map(Number) };
    }

    // Add automated filter if provided
    if (automatedFilter.length > 0) {
      // Convert to boolean values (1 = automated, 0 = manual)
      const automatedBools = automatedFilter.map((v: number) => v === 1);
      if (automatedBools.length === 1) {
        baseWhere.automated = automatedBools[0];
      }
      // If both are selected, don't add a filter (show all)
    }

    // Get all test cases with project information
    // Note: We fetch caseFieldValues to filter by dynamic fields in JavaScript
    // because JSON fields don't support the 'in' operator in Prisma
    let allCases;

    const hasDynamicFieldFilters = Object.keys(dynamicFieldFilters).length > 0;

    if (hasDynamicFieldFilters) {
      // Fetch with caseFieldValues for dynamic field filtering
      const fieldIds = Object.keys(dynamicFieldFilters).map(Number);

      const allCasesRaw = await baseDb.repositoryCases.findMany({
        where: baseWhere,
        select: {
          id: true,
          createdAt: true,
          isDeleted: true,
          automated: true,
          projectId: true,
          project: {
            select: {
              id: true,
              name: true,
            },
          },
          caseFieldValues: {
            where: { fieldId: { in: fieldIds } },
            select: {
              fieldId: true,
              value: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      // Filter by dynamic field values in JavaScript
      // Case must match ALL dynamic field filters
      allCases = allCasesRaw.filter((testCase) => {
        // Check each dynamic field filter
        return Object.entries(dynamicFieldFilters).every(
          ([fieldIdStr, filterValues]) => {
            const fieldId = parseInt(fieldIdStr);
            const values = filterValues as (string | number)[];
            const fieldValue = testCase.caseFieldValues.find(
              (cfv) => cfv.fieldId === fieldId
            );

            if (
              !fieldValue ||
              fieldValue.value === null ||
              fieldValue.value === undefined
            ) {
              return false;
            }

            const value = fieldValue.value;

            // Handle both single values and arrays (for multi-select)
            if (Array.isArray(value)) {
              // Multi-select: check if any selected value is in the array
              return values.some((v: string | number) => value.includes(v));
            } else {
              // Single value: check if it matches any selected value
              return values.includes(value as string | number);
            }
          }
        );
      });
    } else {
      // Fetch without caseFieldValues
      allCases = await baseDb.repositoryCases.findMany({
        where: baseWhere,
        select: {
          id: true,
          createdAt: true,
          isDeleted: true,
          automated: true,
          projectId: true,
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      });
    }

    if (allCases.length === 0) {
      return Response.json({
        data: [],
        total: 0,
        page,
        pageSize,
      });
    }

    // Fetch the version history for the matched cases so we can determine each
    // case's automated state AS OF each period. Manual→automated flips are
    // captured as version snapshots with a truthful createdAt, which the current
    // RepositoryCases.automated flag alone cannot tell us.
    const caseIds = allCases.map((c) => c.id);
    const versions = await baseDb.repositoryCaseVersions.findMany({
      where: { repositoryCaseId: { in: caseIds } },
      select: {
        repositoryCaseId: true,
        createdAt: true,
        automated: true,
        version: true,
      },
      orderBy: [{ repositoryCaseId: "asc" }, { version: "asc" }],
    });

    // Build a chronological automated-state timeline per case.
    const historyByCase = new Map<
      number,
      { at: number; automated: boolean }[]
    >();
    for (const v of versions) {
      const timeline = historyByCase.get(v.repositoryCaseId) ?? [];
      timeline.push({
        at: new Date(v.createdAt).getTime(),
        automated: v.automated,
      });
      historyByCase.set(v.repositoryCaseId, timeline);
    }
    // Sort defensively by timestamp (imports may set explicit createdAt out of
    // version order), and guarantee every case has at least a creation baseline
    // in case a version row is somehow missing.
    for (const timeline of historyByCase.values()) {
      timeline.sort((a, b) => a.at - b.at);
    }
    for (const testCase of allCases) {
      if (!historyByCase.has(testCase.id)) {
        historyByCase.set(testCase.id, [
          {
            at: new Date(testCase.createdAt).getTime(),
            automated: testCase.automated,
          },
        ]);
      }
    }

    // Build the period axis. The date range (if provided) governs the axis;
    // otherwise span from the earliest case creation to the latest activity.
    const creationTimes = allCases.map((c) => new Date(c.createdAt).getTime());
    const versionTimes = versions.map((v) => new Date(v.createdAt).getTime());
    const lo = startDate
      ? new Date(startDate)
      : new Date(Math.min(...creationTimes));
    const hi = endDate
      ? new Date(endDate)
      : new Date(Math.max(...creationTimes, ...versionTimes));

    const sortedPeriods = generatePeriods(lo, hi, dateGrouping as DateGrouping);

    // Get unique projects
    const projectsMap = new Map<number, string>();
    allCases.forEach((testCase) => {
      if (!projectsMap.has(testCase.projectId)) {
        projectsMap.set(testCase.projectId, testCase.project.name);
      }
    });

    const projects = Array.from(projectsMap.entries()).map(([id, name]) => ({
      id,
      name,
    }));

    // Build data structure: one row per period with pivoted columns per project
    const periodData: PeriodData[] = sortedPeriods.map((period) => {
      const row: PeriodData = {
        periodStart: period.start.toISOString(),
        periodEnd: period.end.toISOString(),
      };

      // For each project, calculate automated, manual, and total counts
      projects.forEach((project) => {
        let automatedCount = 0;
        let manualCount = 0;

        // Count cases by their automated state AS OF this period end, using the
        // version timeline rather than the current flag. A case created manual
        // and later flipped counts as manual until the period of its flip.
        allCases.forEach((testCase) => {
          if (testCase.projectId !== project.id) return;

          const { existed, automated } = automatedStateAt(
            historyByCase.get(testCase.id),
            period.end.getTime()
          );

          if (existed) {
            if (automated) {
              automatedCount++;
            } else {
              manualCount++;
            }
          }
        });

        const totalCount = automatedCount + manualCount;
        const percentAutomated =
          totalCount > 0 ? (automatedCount / totalCount) * 100 : 0;

        // Add columns for this project
        const projectPrefix = project.name.replace(/\s+/g, "");
        row[`${projectPrefix}_automated`] = automatedCount;
        row[`${projectPrefix}_manual`] = manualCount;
        row[`${projectPrefix}_total`] = totalCount;
        row[`${projectPrefix}_percentAutomated`] =
          Math.round(percentAutomated * 100) / 100;
      });

      return row;
    });

    // Calculate period-over-period changes
    for (let i = 1; i < periodData.length; i++) {
      const currentPeriod = periodData[i];
      const previousPeriod = periodData[i - 1];

      projects.forEach((project) => {
        const projectPrefix = project.name.replace(/\s+/g, "");
        const currentAuto = currentPeriod[
          `${projectPrefix}_automated`
        ] as number;
        const previousAuto = previousPeriod[
          `${projectPrefix}_automated`
        ] as number;
        const currentManual = currentPeriod[
          `${projectPrefix}_manual`
        ] as number;
        const previousManual = previousPeriod[
          `${projectPrefix}_manual`
        ] as number;

        currentPeriod[`${projectPrefix}_automatedChange`] =
          currentAuto - previousAuto;
        currentPeriod[`${projectPrefix}_manualChange`] =
          currentManual - previousManual;
      });
    }

    // Sort the data (default: oldest period first for trend visualization)
    if (sortColumn) {
      periodData.sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];

        if (typeof aVal === "string" && typeof bVal === "string") {
          return sortDirection === "asc"
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }

        const aNum = typeof aVal === "number" ? aVal : 0;
        const bNum = typeof bVal === "number" ? bVal : 0;

        return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
      });
    } else {
      // Default sort by period start (oldest first for chronological trend)
      periodData.sort((a, b) => {
        const aDate = new Date(a.periodStart);
        const bDate = new Date(b.periodStart);
        return aDate.getTime() - bDate.getTime(); // Ascending order
      });
    }

    // Return all data (no server-side pagination - let frontend handle it)
    return Response.json({
      data: periodData,
      total: periodData.length,
      page: 1,
      pageSize: periodData.length,
      projects, // Include project list for dynamic column generation
      dateGrouping, // Include date grouping for frontend rendering
    });
  } catch (e: unknown) {
    console.error("Automation trends error:", e);
    const errorMessage = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
