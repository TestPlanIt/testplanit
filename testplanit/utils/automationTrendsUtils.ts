import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";

interface PeriodData {
  periodStart: string;
  periodEnd: string;
  [key: string]: number | string; // Dynamic project columns
}

type DateGrouping = "daily" | "weekly" | "monthly" | "quarterly" | "annually";

function getPeriodDates(date: Date, grouping: DateGrouping): { start: Date; end: Date } {
  const utcDate = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));

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
      const start = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), 1, 0, 0, 0, 0));
      // End is the last millisecond of the last day of the month
      const end = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth() + 1, 1, 0, 0, 0, 0));
      end.setUTCMilliseconds(-1); // Go back 1ms from start of next month
      return { start, end };
    }
    case "quarterly": {
      const quarter = Math.floor(utcDate.getUTCMonth() / 3);
      const start = new Date(Date.UTC(utcDate.getUTCFullYear(), quarter * 3, 1, 0, 0, 0, 0));
      // End is the last millisecond of the last day of the quarter
      const end = new Date(Date.UTC(utcDate.getUTCFullYear(), quarter * 3 + 3, 1, 0, 0, 0, 0));
      end.setUTCMilliseconds(-1); // Go back 1ms from start of next quarter
      return { start, end };
    }
    case "annually": {
      const start = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
      // End is the last millisecond of December 31st
      const end = new Date(Date.UTC(utcDate.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0));
      end.setUTCMilliseconds(-1); // Go back 1ms from start of next year
      return { start, end };
    }
    default:
      return getPeriodDates(date, "weekly");
  }
}

export async function handleAutomationTrendsPOST(
  req: NextRequest,
  isCrossProject: boolean
) {
  try {
    // Check admin access for cross-project
    if (isCrossProject) {
      const session = await getServerSession(authOptions);
      if (!session || session.user.access !== "ADMIN") {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await req.json();
    const {
      projectId,
      dimensions = [],
      startDate,
      endDate,
      page = 1,
      pageSize: pageSizeParam = 10,
      sortColumn,
      sortDirection = "desc",
      dateGrouping = "weekly",
    } = body;

    // Handle pageSize "All" - since we return all data anyway, just normalize it
    const pageSize = pageSizeParam === "All" ? undefined : Number(pageSizeParam);

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

    // Build date filter
    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate);
    }

    // Build base where clause with standard filters
    const baseWhere: any = {
      ...(isCrossProject
        ? (projectIds.length > 0
            ? { projectId: { in: projectIds.map(Number) } } // Filtered projects for cross-project
            : {}) // All projects for cross-project
        : { projectId: Number(projectId) }), // Single project
      isDeleted: false,
      ...(Object.keys(dateFilter).length > 0
        ? { createdAt: dateFilter }
        : {}),
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

      const allCasesRaw = await prisma.repositoryCases.findMany({
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
              value: true
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      // Filter by dynamic field values in JavaScript
      // Case must match ALL dynamic field filters
      allCases = allCasesRaw.filter(testCase => {
        // Check each dynamic field filter
        return Object.entries(dynamicFieldFilters).every(([fieldIdStr, filterValues]) => {
          const fieldId = parseInt(fieldIdStr);
          const values = filterValues as (string | number)[];
          const fieldValue = testCase.caseFieldValues.find(cfv => cfv.fieldId === fieldId);

          if (!fieldValue || fieldValue.value === null || fieldValue.value === undefined) {
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
        });
      });
    } else {
      // Fetch without caseFieldValues
      allCases = await prisma.repositoryCases.findMany({
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

    // Get all unique periods based on date grouping
    const periodKeys = new Set<string>();
    const periodMap = new Map<string, { start: Date; end: Date }>();

    allCases.forEach((testCase) => {
      const period = getPeriodDates(new Date(testCase.createdAt), dateGrouping as DateGrouping);
      const key = `${period.start.toISOString()}_${period.end.toISOString()}`;
      periodKeys.add(key);
      if (!periodMap.has(key)) {
        periodMap.set(key, period);
      }
    });

    const sortedPeriods = Array.from(periodKeys).sort().map(key => periodMap.get(key)!);

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

        // Count cases that existed as of this period end
        allCases.forEach((testCase) => {
          if (testCase.projectId !== project.id) return;

          const createdDate = new Date(testCase.createdAt);
          const existedInPeriod = createdDate <= period.end && !testCase.isDeleted;

          if (existedInPeriod) {
            if (testCase.automated) {
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
        row[`${projectPrefix}_percentAutomated`] = Math.round(percentAutomated * 100) / 100;
      });

      return row;
    });

    // Calculate period-over-period changes
    for (let i = 1; i < periodData.length; i++) {
      const currentPeriod = periodData[i];
      const previousPeriod = periodData[i - 1];

      projects.forEach((project) => {
        const projectPrefix = project.name.replace(/\s+/g, "");
        const currentAuto = currentPeriod[`${projectPrefix}_automated`] as number;
        const previousAuto = previousPeriod[`${projectPrefix}_automated`] as number;
        const currentManual = currentPeriod[`${projectPrefix}_manual`] as number;
        const previousManual = previousPeriod[`${projectPrefix}_manual`] as number;

        currentPeriod[`${projectPrefix}_automatedChange`] = currentAuto - previousAuto;
        currentPeriod[`${projectPrefix}_manualChange`] = currentManual - previousManual;
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
