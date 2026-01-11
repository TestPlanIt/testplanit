import { z } from "zod/v4";

/**
 * Pre-built report types that don't require dimension/metric selection.
 * Add new pre-built reports here - no need to update validation rules elsewhere.
 */
const PRE_BUILT_REPORT_TYPES = [
  "automation-trends",
  "cross-project-automation-trends",
  "flaky-tests",
  "cross-project-flaky-tests",
  "test-case-health",
  "cross-project-test-case-health",
  "issue-test-coverage",
  "cross-project-issue-test-coverage",
] as const;

/**
 * Check if a report type is pre-built (doesn't require dimensions/metrics)
 */
function isPreBuiltReport(reportType: string): boolean {
  return PRE_BUILT_REPORT_TYPES.includes(reportType as any);
}

export const reportRequestSchema = z
  .object({
    reportType: z.string(),
    dimensions: z.array(z.string()),
    metrics: z.array(z.string()),
    projectId: z.number().optional(),
    startDate: z.iso.datetime().optional(),
    endDate: z.iso.datetime().optional(),
    page: z.number().int().positive().optional().default(1),
    pageSize: z.union([z.number().int().positive(), z.literal("All")]).optional(),
    sortColumn: z.string().optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
    dateGrouping: z.enum(["daily", "weekly", "monthly", "quarterly", "annually"]).optional().default("weekly"),
  })
  .superRefine((data, ctx) => {
    // Rule: If endDate is provided, startDate must also be provided
    if (data.endDate && !data.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["startDate"],
        message: "Start date is required when end date is specified.",
        params: { i18nKey: "reports.errors.startDateRequiredWithEndDate" },
      });
    }

    // Rule: Start date must be before or equal to end date
    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      if (start > end) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "End date must be after or equal to start date.",
          params: { i18nKey: "reports.errors.endDateMustBeAfterStartDate" },
        });
      }
    }
    // Rule: At least one dimension is required for most reports, unless only one metric is requested (for totals)
    // Pre-built reports are exempt from this rule
    if (
      data.reportType !== "issue-tracking" &&
      !isPreBuiltReport(data.reportType) &&
      data.dimensions.length === 0 &&
      data.metrics.length > 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["dimensions"],
        message: "At least one dimension is required.",
        params: { i18nKey: "reports.errors.atLeastOneDimensionRequired" },
      });
    }

    // Rule: At least one metric is always required (except for pre-built reports)
    if (data.metrics.length === 0 && !isPreBuiltReport(data.reportType)) {
      ctx.addIssue({
        code: "custom",
        path: ["metrics"],
        message: "At least one metric must be specified.",
        params: { i18nKey: "reports.errors.atLeastOneMetricRequired" },
      });
    }

    // Rule: Cross-project user engagement cannot combine 'date' and 'lastActiveDate'
    if (
      data.reportType === "cross-project-user-engagement" &&
      data.dimensions.includes("date") &&
      data.metrics.includes("lastActiveDate")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["dimensions", "metrics"],
        message:
          "The 'Last Active Date' metric cannot be combined with the 'Activity Date' dimension.",
        params: {
          i18nKey: "reports.errors.invalidCombinationDateLastActive",
        },
      });
    }

    // Rule: Project-specific user engagement has the same restriction
    if (
      data.reportType === "user-engagement" &&
      data.dimensions.includes("date") &&
      data.metrics.includes("lastActiveDate")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["dimensions", "metrics"],
        message:
          "The 'Last Active Date' metric cannot be combined with the 'Activity Date' dimension.",
        params: {
          i18nKey: "reports.errors.invalidCombinationDateLastActive",
        },
      });
    }

    // Rule: Last Active Date metric can only be used with the User dimension
    if (
      data.metrics.includes("lastActiveDate") &&
      (data.dimensions.length !== 1 || !data.dimensions.includes("user"))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["dimensions", "metrics"],
        message:
          "The 'Last Active Date' metric can only be used with the 'User' dimension.",
        params: {
          i18nKey: "reports.errors.lastActiveDateOnlyWithUser",
        },
      });
    }

    // Rule: Invalid dimension combinations for Test Execution reports
    // TEMPORARILY DISABLED TO TEST IF THESE COMBINATIONS ACTUALLY WORK
    /*
    if (
      data.reportType === "test-execution" ||
      data.reportType === "cross-project-test-execution"
    ) {
      const invalidCombinations = [
        // Redundant parent-child groupings
        ["testRun", "testCase"],

        // Status with structural entities
        ["status", "testCase"],
        ["status", "testRun"],
        ["status", "milestone"],

        // User (executor) with structural entities
        ["user", "testRun"],
        ["user", "milestone"],
        ["user", "testCase"],

        // Configuration with case-level entities
        ["configuration", "testRun"],
        ["configuration", "testCase"],
        ["configuration", "milestone"],

        // Date with structural entities
        ["date", "testRun"],
        ["date", "testCase"],
        ["date", "milestone"],

        // Cross-level structural combinations
        ["testRun", "milestone"],
        ["testCase", "milestone"],
      ];

      // Check if the selected dimensions contain any invalid combination
      for (const invalidCombo of invalidCombinations) {
        if (invalidCombo.every(dim => data.dimensions.includes(dim))) {
          const [dim1, dim2] = invalidCombo;
          ctx.issues.push({
                        code: z.ZodIssueCode.custom,
                        path: ["dimensions"],
                        message: `The '${dim1}' and '${dim2}' dimensions cannot be used together in Test Execution reports.`,
                        params: {
                          i18nKey: "reports.errors.invalidDimensionCombination",
                          substitutions: { dim1, dim2 },
                        },
                          input: ''
                    });
        }
      }
    }
    */
  });
