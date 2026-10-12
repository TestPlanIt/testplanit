import { z } from "zod/v4";
import type {
  WebhookActionTrigger,
  WebhookActionType,
} from "~/zenstack/models";

/** Which webhooks a trigger belongs to. */
export type WebhookActionSource = "tracker" | "repository";

export const TRACKER_TRIGGERS = [
  "ISSUE_EVENT",
  "ISSUE_CREATED",
  "ISSUE_STATUS_ENTERED",
] as const satisfies readonly WebhookActionTrigger[];

export const REPOSITORY_TRIGGERS = [
  "CODE_PULL_REQUEST",
  "CODE_PUSH",
  "CODE_BRANCH_PUSH",
] as const satisfies readonly WebhookActionTrigger[];

/** The events a new repository webhook composes runs for. */
export const DEFAULT_REPOSITORY_TRIGGERS: readonly WebhookActionTrigger[] = [
  "CODE_PULL_REQUEST",
  "CODE_PUSH",
];

export const WEBHOOK_ACTION_TYPES = [
  "IMPORT_ISSUE",
  "CREATE_RUN",
  "DRAFT_CASES",
] as const satisfies readonly WebhookActionType[];

export function triggersFor(
  source: WebhookActionSource
): readonly WebhookActionTrigger[] {
  return source === "repository" ? REPOSITORY_TRIGGERS : TRACKER_TRIGGERS;
}

/** The actions each trigger can perform. */
export const ACTIONS_BY_TRIGGER: Record<
  WebhookActionTrigger,
  readonly WebhookActionType[]
> = {
  ISSUE_EVENT: ["IMPORT_ISSUE"],
  ISSUE_CREATED: ["IMPORT_ISSUE", "CREATE_RUN", "DRAFT_CASES"],
  ISSUE_STATUS_ENTERED: ["IMPORT_ISSUE", "CREATE_RUN", "DRAFT_CASES"],
  CODE_PULL_REQUEST: ["CREATE_RUN"],
  CODE_PUSH: ["CREATE_RUN"],
  CODE_BRANCH_PUSH: ["CREATE_RUN"],
};

export function isRepositoryTrigger(trigger: WebhookActionTrigger): boolean {
  return (REPOSITORY_TRIGGERS as readonly string[]).includes(trigger);
}

const MAX_FILTER_VALUES = 50;
const filterValues = z
  .array(z.string().trim().min(1).max(255))
  .max(MAX_FILTER_VALUES);

/** Narrows which tracker issues a rule acts on. Empty lists match everything. */
export const webhookActionFilterSchema = z.object({
  statuses: filterValues.optional(),
  issueTypeIds: filterValues.optional(),
  labels: filterValues.optional(),
  requirementsOnly: z.boolean().optional(),
});
export type WebhookActionFilter = z.infer<typeof webhookActionFilterSchema>;

export const autoExecuteOptionsSchema = z.object({
  targetId: z.number().int().positive(),
  ref: z.string().trim().max(255).optional(),
  inputs: z.record(z.string(), z.string()).optional(),
});
export type AutoExecuteOptions = z.infer<typeof autoExecuteOptionsSchema>;

export const createRunOptionsSchema = z.object({
  /** Repository rules: take every suggested case scoring at least this. */
  minScore: z.number().int().min(0).max(100).optional(),
  /** Tracker rules: also take the cases linked to the issue's child issues. */
  includeChildIssues: z.boolean().optional(),
  autoExecute: autoExecuteOptionsSchema.optional(),
});
export type CreateRunOptions = z.infer<typeof createRunOptionsSchema>;

export const draftCasesOptionsSchema = z.object({
  templateId: z.number().int().positive().optional(),
  folderName: z.string().trim().min(1).max(255).optional(),
  quantity: z.number().int().min(1).max(20).optional(),
  autoGenerateTags: z.boolean().optional(),
  notifyUserIds: z.array(z.string().min(1)).max(100).optional(),
  notifyGroupIds: z.array(z.number().int().positive()).max(100).optional(),
});
export type DraftCasesOptions = z.infer<typeof draftCasesOptionsSchema>;

export const importIssueOptionsSchema = z.object({});

export const OPTIONS_SCHEMAS = {
  IMPORT_ISSUE: importIssueOptionsSchema,
  CREATE_RUN: createRunOptionsSchema,
  DRAFT_CASES: draftCasesOptionsSchema,
} as const satisfies Record<WebhookActionType, z.ZodType>;

export interface WebhookActionInput {
  trigger: WebhookActionTrigger;
  action: WebhookActionType;
  filter?: unknown;
  options?: unknown;
}

export type WebhookActionValidationError =
  | "trigger_not_allowed"
  | "action_not_allowed"
  | "invalid_filter"
  | "invalid_options";

/**
 * Check a rule against the webhook it belongs to and return its filter and
 * options in stored form. Repository rules carry no filter; tracker rules
 * carry no minimum score.
 */
export function parseWebhookAction(
  source: WebhookActionSource,
  input: WebhookActionInput
):
  | {
      ok: true;
      filter: WebhookActionFilter;
      options: Record<string, unknown>;
    }
  | { ok: false; error: WebhookActionValidationError } {
  if (!triggersFor(source).includes(input.trigger)) {
    return { ok: false, error: "trigger_not_allowed" };
  }
  if (!ACTIONS_BY_TRIGGER[input.trigger].includes(input.action)) {
    return { ok: false, error: "action_not_allowed" };
  }
  let filter: WebhookActionFilter = {};
  if (source === "tracker") {
    const parsed = webhookActionFilterSchema.safeParse(input.filter ?? {});
    if (!parsed.success) return { ok: false, error: "invalid_filter" };
    filter = compactFilter(parsed.data);
  }
  const parsed = OPTIONS_SCHEMAS[input.action].safeParse(input.options ?? {});
  if (!parsed.success) return { ok: false, error: "invalid_options" };
  const options: Record<string, unknown> = { ...parsed.data };
  if (input.action === "CREATE_RUN") {
    if (source === "repository") delete options.includeChildIssues;
    else delete options.minScore;
    const autoExecute = options.autoExecute as AutoExecuteOptions | undefined;
    if (autoExecute && !autoExecute.ref) delete autoExecute.ref;
  }
  return { ok: true, filter, options };
}

function compactFilter(filter: WebhookActionFilter): WebhookActionFilter {
  const out: WebhookActionFilter = {};
  for (const key of ["statuses", "issueTypeIds", "labels"] as const) {
    const values = [...new Set(filter[key] ?? [])];
    if (values.length > 0) out[key] = values;
  }
  if (filter.requirementsOnly) out.requirementsOnly = true;
  return out;
}

/** Stored options read back leniently: an unparseable row acts with none. */
export function readCreateRunOptions(raw: unknown): CreateRunOptions {
  const parsed = createRunOptionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function readDraftCasesOptions(raw: unknown): DraftCasesOptions {
  const parsed = draftCasesOptionsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function readWebhookActionFilter(raw: unknown): WebhookActionFilter {
  const parsed = webhookActionFilterSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}
