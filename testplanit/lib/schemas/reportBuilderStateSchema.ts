import { z } from "zod/v4";
import { dimensionFiltersSchema } from "./reportRequestSchema";

/**
 * The Report Builder selection that used to be spread across the page URL
 * (dimensions, metrics, startDate, endDate, dimensionFilters). It is now
 * stored in a ReportBuilderState row and the URL carries only `state=<id>`,
 * so a "Select all" over thousands of filter values no longer produces a
 * URL that ingress rejects with 414.
 */
export const reportBuilderStateConfigSchema = z
  .object({
    dimensions: z.array(z.string()).default([]),
    metrics: z.array(z.string()).default([]),
    startDate: z.iso.datetime().optional(),
    endDate: z.iso.datetime().optional(),
    dimensionFilters: dimensionFiltersSchema.optional(),
    // Report-specific extras. Not written by the builder today; accepted so
    // a report that starts persisting them needs no schema change.
    dateGrouping: z
      .enum(["daily", "weekly", "monthly", "quarterly", "annually"])
      .optional(),
    consecutiveRuns: z.number().int().positive().optional(),
  })
  .strict();

export type ReportBuilderStateConfig = z.infer<
  typeof reportBuilderStateConfigSchema
>;

export const reportBuilderStateCreateSchema = z
  .object({
    projectId: z.number().int().positive().optional(),
    reportType: z.string().min(1),
    config: reportBuilderStateConfigSchema,
  })
  .strict();

export type ReportBuilderStateCreateInput = z.infer<
  typeof reportBuilderStateCreateSchema
>;
