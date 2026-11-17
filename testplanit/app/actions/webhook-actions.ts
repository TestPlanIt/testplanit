"use server";

import type { JsonObject } from "@zenstackhq/orm";
import type {
  WebhookActionTrigger,
  WebhookActionType,
} from "~/zenstack/models";
import { runWithAuditContext } from "~/lib/auditContext";
import { baseDb } from "~/lib/db";
import {
  describeInputError,
  validateCustomInputs,
} from "~/lib/execution/inputs";
import {
  AVAILABLE_ACTIONS,
  parseWebhookAction,
  type AutoExecuteOptions,
  type CaseFilter,
  type DraftCasesOptions,
} from "~/lib/webhooks/actions/schemas";
import { loadProjectFilterRegistry } from "~/lib/repository/projectFilterRegistry";
import { coerceFilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import {
  getProjectReadiness,
  templateBelongsToProject,
} from "~/lib/services/jira-panel-generation";
import { readRequirementTypeConfig } from "~/lib/integrations/requirementTypeConfig";
import { canManageWebhookConfig } from "~/lib/webhooks/auth";
import { getServerAuthSession } from "~/server/auth";

type Result =
  { success: true; id?: string } | { success: false; error: string };

const SAVE_FAILED = "Failed to save webhook action";

/** Run `fn` for a signed-in user who manages the project's webhooks. */
async function asWebhookManager(
  projectId: number,
  fn: () => Promise<Result>
): Promise<Result> {
  const session = await getServerAuthSession();
  if (!session?.user) return { success: false, error: "Unauthorized" };
  return runWithAuditContext(
    {
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      userEmail: session.user.email ?? undefined,
    },
    async () => {
      let authorized: boolean;
      try {
        authorized = await canManageWebhookConfig(session, projectId);
      } catch (err) {
        console.error("[webhook-actions] auth check failed", err);
        return { success: false, error: SAVE_FAILED };
      }
      if (!authorized) return { success: false, error: "Forbidden" };
      try {
        return await fn();
      } catch (err) {
        console.error("[webhook-actions] save failed", err);
        return { success: false, error: SAVE_FAILED };
      }
    }
  );
}

async function findInboundConfig(projectId: number, webhookConfigId: string) {
  return baseDb.webhookConfig.findFirst({
    where: { id: webhookConfigId, projectId, direction: "INBOUND" },
    select: { id: true, codeRepositoryConfigId: true },
  });
}

async function checkAutoExecute(
  projectId: number,
  autoExecute: AutoExecuteOptions | undefined
): Promise<string | null> {
  if (!autoExecute) return null;
  const inputError = validateCustomInputs(autoExecute.inputs);
  if (inputError) return describeInputError(inputError);
  const target = await baseDb.executionTarget.findFirst({
    where: { id: autoExecute.targetId, projectId, isDeleted: false },
    select: { isEnabled: true },
  });
  if (!target) return "Execution target not found";
  if (!target.isEnabled) return "Execution target is disabled";
  return null;
}

/**
 * A Create test run rule's test case filters have to be ones the project's
 * repository offers today, with the values coerced the way the repository
 * stores them; the checked filters replace the raw ones in `options`.
 */
async function checkCaseFilter(
  projectId: number,
  options: Record<string, unknown>
): Promise<string | null> {
  const raw = options.caseFilter as CaseFilter | undefined;
  if (!raw) return null;
  const { registry } = await loadProjectFilterRegistry(baseDb, projectId);
  const checked: CaseFilter = [];
  for (const predicate of raw) {
    const coerced = coerceFilterPredicate(predicate, registry);
    if (!coerced) return "A test case filter doesn't apply to this project";
    checked.push(coerced);
  }
  options.caseFilter = checked;
  return null;
}

/**
 * A Draft test cases rule needs an AI model to call, and its template,
 * state, users and groups must be the project's own.
 */
async function checkDraftCases(
  projectId: number,
  action: WebhookActionType,
  options: DraftCasesOptions
): Promise<string | null> {
  if (action !== "DRAFT_CASES") return null;
  const readiness = await getProjectReadiness(projectId);
  if (!readiness.hasActiveLlm) {
    return "This project has no active AI model to draft test cases with";
  }
  if (!readiness.hasRepository || !readiness.hasDefaultWorkflow) {
    return "This project needs a repository and a default case state";
  }
  if (
    options.templateId !== undefined &&
    !(await templateBelongsToProject(options.templateId, projectId))
  ) {
    return "Template not found";
  }
  if (options.stateId !== undefined) {
    const state = await baseDb.workflows.findFirst({
      where: {
        id: options.stateId,
        scope: "CASES",
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId } },
      },
      select: { id: true },
    });
    if (!state) return "Case state not found";
  }
  if (options.notifyUserIds?.length) {
    const users = await baseDb.user.count({
      where: { id: { in: options.notifyUserIds }, isDeleted: false },
    });
    if (users !== new Set(options.notifyUserIds).size) {
      return "User not found";
    }
  }
  if (options.notifyGroupIds?.length) {
    const groups = await baseDb.groups.count({
      where: { id: { in: options.notifyGroupIds }, isDeleted: false },
    });
    if (groups !== new Set(options.notifyGroupIds).size) {
      return "Group not found";
    }
  }
  return null;
}

/**
 * Whether the project's tracker issues can be requirements: requirements
 * are on for the project and its integration names the requirement types.
 */
async function classifiesRequirements(projectId: number): Promise<boolean> {
  const project = await baseDb.projects.findUnique({
    where: { id: projectId },
    select: { requirementsEnabled: true },
  });
  if (!project?.requirementsEnabled) return false;
  const integrations = await baseDb.projectIntegration.findMany({
    where: { projectId, isActive: true },
    select: { config: true },
  });
  return integrations.some(
    (integration) => readRequirementTypeConfig(integration.config).enabled
  );
}

const VALIDATION_MESSAGES = {
  trigger_not_allowed: "This webhook can't use that trigger",
  action_not_allowed: "That action isn't available for this trigger",
  invalid_filter: "The filter is not valid",
  invalid_options: "The action's options are not valid",
} as const;

/**
 * Create a rule on an inbound webhook, or change one. The trigger has to
 * suit the webhook (repository events for a repository webhook, issue
 * events for a tracker webhook) and the action the trigger; an auto-execute
 * target has to be a live, enabled target of the project, and test case
 * filters ones the project's repository offers.
 */
export async function saveWebhookAction(input: {
  projectId: number;
  webhookConfigId: string;
  id?: string;
  trigger: WebhookActionTrigger;
  action: WebhookActionType;
  filter?: unknown;
  options?: unknown;
  isEnabled?: boolean;
}): Promise<Result> {
  const { projectId, webhookConfigId } = input;
  return asWebhookManager(projectId, async () => {
    const config = await findInboundConfig(projectId, webhookConfigId);
    if (!config) return { success: false, error: "Webhook not found" };
    if (!AVAILABLE_ACTIONS.includes(input.action)) {
      return { success: false, error: VALIDATION_MESSAGES.action_not_allowed };
    }
    const parsed = parseWebhookAction(
      config.codeRepositoryConfigId != null ? "repository" : "tracker",
      input
    );
    if (!parsed.ok) {
      return { success: false, error: VALIDATION_MESSAGES[parsed.error] };
    }
    if (
      parsed.filter.requirementsOnly &&
      !(await classifiesRequirements(projectId))
    ) {
      return {
        success: false,
        error: "This project doesn't classify issues as requirements",
      };
    }
    const targetError = await checkAutoExecute(
      projectId,
      parsed.options.autoExecute as AutoExecuteOptions | undefined
    );
    if (targetError) return { success: false, error: targetError };
    const filterError = await checkCaseFilter(projectId, parsed.options);
    if (filterError) return { success: false, error: filterError };
    const draftError = await checkDraftCases(
      projectId,
      input.action,
      parsed.options as DraftCasesOptions
    );
    if (draftError) return { success: false, error: draftError };

    const data = {
      trigger: input.trigger,
      action: input.action,
      filter: parsed.filter as JsonObject,
      options: parsed.options as JsonObject,
      ...(typeof input.isEnabled === "boolean"
        ? { isEnabled: input.isEnabled }
        : {}),
    };
    if (input.id) {
      const updated = await baseDb.webhookAction.updateMany({
        where: { id: input.id, webhookConfigId, projectId },
        data,
      });
      if (updated.count === 0) {
        return { success: false, error: "Webhook action not found" };
      }
      return { success: true, id: input.id };
    }
    const last = await baseDb.webhookAction.findFirst({
      where: { webhookConfigId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const created = await baseDb.webhookAction.create({
      data: {
        ...data,
        webhookConfigId,
        projectId,
        order: (last?.order ?? -1) + 1,
      },
      select: { id: true },
    });
    return { success: true, id: created.id };
  });
}

/** Turn a rule on or off without changing it. */
export async function setWebhookActionEnabled(input: {
  projectId: number;
  id: string;
  isEnabled: boolean;
}): Promise<Result> {
  return asWebhookManager(input.projectId, async () => {
    const updated = await baseDb.webhookAction.updateMany({
      where: { id: input.id, projectId: input.projectId },
      data: { isEnabled: input.isEnabled },
    });
    if (updated.count === 0) {
      return { success: false, error: "Webhook action not found" };
    }
    return { success: true, id: input.id };
  });
}

/** Remove a rule; its log rows stay, detached from it. */
export async function deleteWebhookAction(input: {
  projectId: number;
  id: string;
}): Promise<Result> {
  return asWebhookManager(input.projectId, async () => {
    const deleted = await baseDb.webhookAction.deleteMany({
      where: { id: input.id, projectId: input.projectId },
    });
    if (deleted.count === 0) {
      return { success: false, error: "Webhook action not found" };
    }
    return { success: true };
  });
}

/** Put a webhook's rules in the given order; ids it doesn't own are ignored. */
export async function reorderWebhookActions(input: {
  projectId: number;
  webhookConfigId: string;
  orderedIds: string[];
}): Promise<Result> {
  return asWebhookManager(input.projectId, async () => {
    const config = await findInboundConfig(
      input.projectId,
      input.webhookConfigId
    );
    if (!config) return { success: false, error: "Webhook not found" };
    await baseDb.$transaction(async (tx) => {
      for (const [index, id] of input.orderedIds.entries()) {
        await tx.webhookAction.updateMany({
          where: { id, webhookConfigId: input.webhookConfigId },
          data: { order: index },
        });
      }
    });
    return { success: true };
  });
}
