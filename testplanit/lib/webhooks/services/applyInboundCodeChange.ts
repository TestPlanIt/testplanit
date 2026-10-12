import type { AdapterType, WebhookActionTrigger } from "~/zenstack/models";
import { baseDb } from "~/lib/db";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import { getImpactAnalysisQueue } from "~/lib/queues";
import { loadRepoConfigForWorker } from "~/lib/services/impact/repoAccess";
import { startImpactAnalysis } from "~/lib/services/impact/startAnalysis";
import { webhookActorId } from "~/lib/webhooks/actions/actor";
import { readCreateRunOptions } from "~/lib/webhooks/actions/schemas";
import {
  codeChangeEventLinks,
  describeCodeChangeEvent,
  extractCodeChangeEvent,
  isSyntheticCodeChangeEvent,
  type CodeChangeEvent,
} from "~/lib/webhooks/codeChangeEvents";
import type { ParsedWebhookPayload } from "./types";

export interface ApplyInboundCodeChangeInput {
  webhookConfigId: string;
  projectId: number;
  codeRepositoryConfigId: number;
  /** Branch pushes compare against; null = the connection's branch. */
  baseBranch: string | null;
  adapterType: AdapterType;
  eventType: string;
  payload: ParsedWebhookPayload;
  payloadDigest: string;
  receivedAt: Date;
  latencyMs: number;
  statusCode: number;
}

export type CodeChangeDeliveryOutcome =
  | "queued" // an Impact analysis was started (or a recent one reused) and will compose a run
  | "ignored" // a pull request or push the config does not act on (event off, wrong branch, PR not opened, ...)
  | "no_handler" // not a pull request or push event at all
  | "synthetic" // the Send test pull request: verified and recorded, nothing started
  | "duplicate" // this payload was already received
  | "error";

export interface ApplyInboundCodeChangeResult {
  outcome: CodeChangeDeliveryOutcome;
  deliveryId?: string;
  analysisId?: number;
  reason?: string;
}

/** Why a pull request or push was received but not acted on. */
type IgnoreReason =
  | "event_disabled"
  | "impact_disabled"
  | "config_missing"
  | "pull_request_not_opened"
  | "pull_request_incomplete"
  | "push_other_branch"
  | "push_no_range"
  | "same_commit"
  | "ref_not_found";

/**
 * Turn a repository's pull request or push webhook into an Impact analysis
 * for the bound connection, with a test run composed when it completes for
 * each enabled Create test run rule whose trigger the event matches.
 *
 * Pull requests start an analysis when opened or reopened, comparing the
 * merge base of the target branch with the pull request head. A push to the
 * base branch (the webhook's own, else the connection's, else the repository
 * default) compares before with after; a push to any other branch compares
 * its merge base with the base branch to its head, when that event is on.
 * Branch creations and deletions are ignored.
 * Every delivery is recorded and deduplicated on the payload digest, like
 * the issue and milestone receivers.
 */
export async function applyInboundCodeChange(
  input: ApplyInboundCodeChangeInput
): Promise<ApplyInboundCodeChangeResult> {
  const {
    webhookConfigId,
    projectId,
    codeRepositoryConfigId,
    baseBranch,
    adapterType,
    eventType,
    payload,
    payloadDigest,
    receivedAt,
    latencyMs,
    statusCode,
  } = input;

  const event = extractCodeChangeEvent(adapterType, eventType, payload.data);
  const subjectRef = event
    ? event.kind === "pull_request"
      ? `pull_request:${event.number}`
      : `push:${event.branch ?? "?"}`
    : null;

  type TxOutcome =
    | { outcome: "proceed"; deliveryId: string }
    | { outcome: "no_handler"; deliveryId: string }
    | { outcome: "duplicate"; deliveryId: string };
  let tx: TxOutcome;
  try {
    tx = await baseDb.$transaction(async (db): Promise<TxOutcome> => {
      const delivery = await db.webhookDelivery.create({
        data: {
          webhookConfigId,
          direction: "INBOUND",
          adapterType,
          eventType,
          subjectRef,
          statusCode: null,
          latencyMs: null,
          payloadDigest,
          error: null,
          attempt: 1,
          receivedAt,
        },
      });
      await db.webhookConfig.update({
        where: { id: webhookConfigId },
        data: { lastReceivedAt: receivedAt },
      });
      if (!event) {
        await db.webhookDelivery.update({
          where: { id: delivery.id },
          data: { statusCode, latencyMs, error: "no_handler" },
        });
        return { outcome: "no_handler", deliveryId: delivery.id };
      }
      const prior = await db.webhookEventDedup.findFirst({
        where: { webhookConfigId, payloadDigest },
        select: { id: true },
      });
      if (prior) {
        await db.webhookDelivery.update({
          where: { id: delivery.id },
          data: { statusCode, latencyMs, error: "duplicate" },
        });
        return { outcome: "duplicate", deliveryId: delivery.id };
      }
      await db.webhookEventDedup.create({
        data: { webhookConfigId, payloadDigest },
      });
      return { outcome: "proceed", deliveryId: delivery.id };
    });
  } catch (error) {
    console.error("[webhooks] code-change delivery write failed", error);
    return {
      outcome: "error",
      reason: error instanceof Error ? error.message : "delivery write failed",
    };
  }
  if (tx.outcome !== "proceed") {
    return { outcome: tx.outcome, deliveryId: tx.deliveryId };
  }
  const deliveryId = tx.deliveryId;
  const finish = async (error: string | null) => {
    await baseDb.webhookDelivery
      .update({
        where: { id: deliveryId },
        data: { statusCode, latencyMs, error },
      })
      .catch(() => {});
  };
  const ignore = async (reason: IgnoreReason) => {
    await finish(`ignored:${reason}`);
    return { outcome: "ignored" as const, deliveryId, reason };
  };

  if (isSyntheticCodeChangeEvent(event!)) {
    await finish("synthetic");
    return { outcome: "synthetic", deliveryId };
  }

  try {
    const candidates: WebhookActionTrigger[] =
      event!.kind === "pull_request"
        ? ["CODE_PULL_REQUEST"]
        : ["CODE_PUSH", "CODE_BRANCH_PUSH"];
    const rules: {
      id: string;
      trigger: WebhookActionTrigger;
      options: unknown;
    }[] = await baseDb.webhookAction.findMany({
      where: {
        webhookConfigId,
        isEnabled: true,
        action: "CREATE_RUN",
        trigger: { in: candidates },
      },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, trigger: true, options: true },
    });
    if (rules.length === 0) return ignore("event_disabled");

    const project = await baseDb.projects.findUnique({
      where: { id: projectId },
      select: { impactEnabled: true, createdBy: true, isDeleted: true },
    });
    if (!project || project.isDeleted || !project.impactEnabled) {
      return ignore("impact_disabled");
    }
    const loaded = await loadRepoConfigForWorker(
      baseDb,
      codeRepositoryConfigId,
      {
        purpose: "IMPACT",
      }
    );
    if (!loaded) return ignore("config_missing");

    const range = await resolveRange(event!, loaded, {
      triggers: new Set(rules.map((rule) => rule.trigger)),
      baseBranch,
    });
    if ("ignore" in range) return ignore(range.ignore);
    const actions = rules
      .filter((rule) => rule.trigger === range.trigger)
      .map((rule) => {
        const options = readCreateRunOptions(rule.options);
        return {
          actionId: rule.id,
          trigger: rule.trigger,
          branch: event!.kind === "push" ? event!.branch : null,
          minScore: options.minScore ?? null,
          autoExecute: options.autoExecute ?? null,
        };
      });

    const label = describeCodeChangeEvent(event!);
    const links = codeChangeEventLinks(event!);
    const url =
      (event!.kind === "push" ? event!.pullRequest?.url : null) ?? event!.url;
    const started = await startImpactAnalysis(
      baseDb,
      loaded,
      getImpactAnalysisQueue(),
      {
        projectId,
        base: range.base,
        head: range.head,
        createdById: await webhookActorId(baseDb, project.createdBy),
        notes: links
          .map((link) => (link.url ? `${link.label}\n${link.url}` : link.label))
          .join("\n"),
        tenantId: getCurrentTenantId(),
        trigger: event!.kind,
        triggerLabel: label,
        triggerUrl: url,
        autoRun: {
          trigger: event!.kind,
          label,
          url,
          links,
          deliveryId,
          webhookConfigId,
          actions,
        },
      }
    );
    if (!started.ok) {
      // A change with nothing to compare will never succeed; answer 200 so
      // the provider doesn't retry it. Queue failures stay errors to retry.
      if (started.code === "same_commit" || started.code === "ref_not_found") {
        await finish(`ignored:${started.code}`);
        return {
          outcome: "ignored" as const,
          deliveryId,
          reason: started.code,
        };
      }
      await finish(`analysis:${started.code}`);
      return {
        outcome: "error",
        deliveryId,
        analysisId: started.analysisId,
        reason: started.message,
      };
    }
    await baseDb.webhookDelivery
      .update({
        where: { id: deliveryId },
        data: {
          statusCode,
          latencyMs,
          subjectRef: `analysis:${started.analysisId}`,
          error: started.reused ? "reused" : null,
        },
      })
      .catch(() => {});
    return { outcome: "queued", deliveryId, analysisId: started.analysisId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "failed";
    await finish(`error:${reason.slice(0, 200)}`);
    console.error("[webhooks] code-change handling failed", error);
    return { outcome: "error", deliveryId, reason };
  }
}

/**
 * What two commits the event asks to compare. A pull request compares the
 * merge base of its target branch (falling back to the target's sha, then
 * the branch name) with its head. A push to the base branch compares before
 * with after; a push elsewhere compares the merge base with the base branch
 * (falling back to the branch name) to the pushed head.
 */
async function resolveRange(
  event: CodeChangeEvent,
  loaded: Awaited<ReturnType<typeof loadRepoConfigForWorker>> & object,
  webhook: { triggers: Set<WebhookActionTrigger>; baseBranch: string | null }
): Promise<
  | { base: string; head: string; trigger: WebhookActionTrigger }
  | { ignore: IgnoreReason }
> {
  if (event.kind === "pull_request") {
    if (event.action !== "opened" && event.action !== "reopened") {
      return { ignore: "pull_request_not_opened" };
    }
    if (!event.headSha) return { ignore: "pull_request_incomplete" };
    let base: string | null = null;
    if (event.targetBranch) {
      base = await loaded.adapter
        .getMergeBase(event.targetBranch, event.headSha)
        .catch(() => null);
    }
    base = base ?? event.baseSha ?? event.targetBranch;
    if (!base) return { ignore: "pull_request_incomplete" };
    return { base, head: event.headSha, trigger: "CODE_PULL_REQUEST" };
  }
  if (event.created || event.deleted || !event.before || !event.after) {
    return { ignore: "push_no_range" };
  }
  if (!event.branch) return { ignore: "push_other_branch" };
  const baseBranch =
    webhook.baseBranch ??
    loaded.config.branch ??
    (await loaded.adapter.getDefaultBranch().catch(() => null));
  if (!baseBranch || event.branch === baseBranch) {
    if (!webhook.triggers.has("CODE_PUSH")) {
      return { ignore: "event_disabled" };
    }
    return { base: event.before, head: event.after, trigger: "CODE_PUSH" };
  }
  if (!webhook.triggers.has("CODE_BRANCH_PUSH")) {
    return { ignore: "push_other_branch" };
  }
  const mergeBase = await loaded.adapter
    .getMergeBase(baseBranch, event.after)
    .catch(() => null);
  return {
    base: mergeBase ?? baseBranch,
    head: event.after,
    trigger: "CODE_BRANCH_PUSH",
  };
}
