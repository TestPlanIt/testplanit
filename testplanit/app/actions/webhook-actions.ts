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
  parseWebhookAction,
  type AutoExecuteOptions,
} from "~/lib/webhooks/actions/schemas";
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
 * target has to be a live, enabled target of the project.
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
    const parsed = parseWebhookAction(
      config.codeRepositoryConfigId != null ? "repository" : "tracker",
      input
    );
    if (!parsed.ok) {
      return { success: false, error: VALIDATION_MESSAGES[parsed.error] };
    }
    const targetError = await checkAutoExecute(
      projectId,
      parsed.options.autoExecute as AutoExecuteOptions | undefined
    );
    if (targetError) return { success: false, error: targetError };

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
