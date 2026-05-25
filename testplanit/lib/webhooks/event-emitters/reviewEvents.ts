import type { Prisma } from "@prisma/client";

import { prisma } from "~/lib/prisma";
import { webhookEvents } from "~/lib/webhooks/events";

type ReviewableEntityType = "CASE" | "RUN" | "SESSION";

type ReviewDecisionOutcome =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "CANCELLED";

interface EmitReviewRequestedInput {
  reviewRequestId: string;
  projectId: number;
  entityType: ReviewableEntityType;
  entityId: number;
  entityName: string;
  fromStateId: number;
  fromStateName: string;
  toStateId: number;
  toStateName: string;
  toStateColor: string | null;
  requestedByUserId: string;
  requesterName: string;
  assigneeUserId: string | null;
  assigneeUserName: string | null;
  assigneeRoleId: number | null;
  assigneeRoleName: string | null;
  commentText: string | null;
}

interface EmitReviewCompletedInput {
  reviewRequestId: string;
  projectId: number;
  entityType: ReviewableEntityType;
  entityId: number;
  entityName: string;
  fromStateId: number;
  toStateId: number;
  toStateName: string;
  toStateColor: string | null;
  decision: ReviewDecisionOutcome;
  decidedByUserId: string | null;
  deciderName: string | null;
  decisionComment: string | null;
  requestedByUserId: string;
  requesterName: string;
}

interface EmitReviewReminderInput {
  reviewRequestId: string;
  projectId: number;
  entityType: ReviewableEntityType;
  entityId: number;
  entityName: string;
  fromStateId: number;
  fromStateName: string;
  toStateId: number;
  toStateName: string;
  toStateColor: string | null;
  requestedByUserId: string;
  requesterName: string;
  assigneeUserId: string | null;
  assigneeUserName: string | null;
  assigneeRoleId: number | null;
  assigneeRoleName: string | null;
  hoursPending: number;
}

interface EmitOptions {
  tx?: Prisma.TransactionClient;
  actorUserId?: string | null;
}

const WEBHOOK_VALUE_MAX_BYTES = 4 * 1024;

function capTextBytes(value: string | null): string | null {
  if (value === null) return null;
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= WEBHOOK_VALUE_MAX_BYTES) return value;
  return `<value truncated: ${bytes} bytes>`;
}

function eventNameFor(
  entityType: ReviewableEntityType,
  verb: "review_requested" | "review_completed" | "review_reminder"
): string {
  if (entityType === "CASE") return `case.${verb}`;
  if (entityType === "RUN") return `test_run.${verb}`;
  return `session.${verb}`;
}

function entityUrlFor(
  entityType: ReviewableEntityType,
  projectId: number,
  entityId: number
): string {
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  if (entityType === "CASE") {
    return `${base}/projects/repository/${projectId}/${entityId}`;
  }
  if (entityType === "RUN") {
    return `${base}/projects/runs/${projectId}/${entityId}`;
  }
  return `${base}/projects/sessions/${projectId}/${entityId}`;
}

async function emitWithOptionalTx(
  eventName: string,
  payload: Record<string, unknown>,
  projectId: number,
  opts: EmitOptions
): Promise<void> {
  if (opts.tx) {
    await webhookEvents.emit(eventName, payload, {
      projectId,
      tx: opts.tx,
      actorUserId: opts.actorUserId,
    });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await webhookEvents.emit(eventName, payload, {
      projectId,
      tx,
      actorUserId: opts.actorUserId,
    });
  });
}

export async function emitReviewRequestedEvent(
  input: EmitReviewRequestedInput,
  opts: EmitOptions = {}
): Promise<void> {
  const eventName = eventNameFor(input.entityType, "review_requested");
  const entityUrl = entityUrlFor(
    input.entityType,
    input.projectId,
    input.entityId
  );
  const payload: Record<string, unknown> = {
    reviewRequestId: input.reviewRequestId,
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    entityUrl,
    fromStateId: input.fromStateId,
    fromStateName: input.fromStateName,
    toStateId: input.toStateId,
    toStateName: input.toStateName,
    toStateColor: input.toStateColor,
    requestedByUserId: input.requestedByUserId,
    requesterName: input.requesterName,
    assigneeUserId: input.assigneeUserId,
    assigneeUserName: input.assigneeUserName,
    assigneeRoleId: input.assigneeRoleId,
    assigneeRoleName: input.assigneeRoleName,
    commentText: capTextBytes(input.commentText),
  };
  await emitWithOptionalTx(eventName, payload, input.projectId, opts);
}

export async function emitReviewCompletedEvent(
  input: EmitReviewCompletedInput,
  opts: EmitOptions = {}
): Promise<void> {
  const eventName = eventNameFor(input.entityType, "review_completed");
  const entityUrl = entityUrlFor(
    input.entityType,
    input.projectId,
    input.entityId
  );
  const payload: Record<string, unknown> = {
    reviewRequestId: input.reviewRequestId,
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    entityUrl,
    fromStateId: input.fromStateId,
    toStateId: input.toStateId,
    toStateName: input.toStateName,
    toStateColor: input.toStateColor,
    decision: input.decision,
    decidedByUserId: input.decidedByUserId,
    deciderName: input.deciderName,
    decisionComment: capTextBytes(input.decisionComment),
    requestedByUserId: input.requestedByUserId,
    requesterName: input.requesterName,
  };
  await emitWithOptionalTx(eventName, payload, input.projectId, opts);
}

/**
 * Emit an outbound webhook event for a recurring review reminder. Fires once
 * per dispatched reminder cycle (bounded by the per-row `lastRemindedAt`
 * stamp and the configured threshold), independent of the in-app + email
 * fan-out. Carries `hoursPending` so subscribers can render the elapsed wait.
 *
 * Routes via `eventNameFor(entityType, "review_reminder")` to:
 *   - `case.review_reminder`
 *   - `test_run.review_reminder`
 *   - `session.review_reminder`
 *
 * Reminders intentionally carry no new comment text — the comment payload
 * lives on the original `*.review_requested` event.
 */
export async function emitReviewReminderEvent(
  input: EmitReviewReminderInput,
  opts: EmitOptions = {}
): Promise<void> {
  const eventName = eventNameFor(input.entityType, "review_reminder");
  const entityUrl = entityUrlFor(
    input.entityType,
    input.projectId,
    input.entityId
  );
  const payload: Record<string, unknown> = {
    reviewRequestId: input.reviewRequestId,
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    entityName: input.entityName,
    entityUrl,
    fromStateId: input.fromStateId,
    fromStateName: input.fromStateName,
    toStateId: input.toStateId,
    toStateName: input.toStateName,
    toStateColor: input.toStateColor,
    requestedByUserId: input.requestedByUserId,
    requesterName: input.requesterName,
    assigneeUserId: input.assigneeUserId,
    assigneeUserName: input.assigneeUserName,
    assigneeRoleId: input.assigneeRoleId,
    assigneeRoleName: input.assigneeRoleName,
    hoursPending: input.hoursPending,
  };
  await emitWithOptionalTx(eventName, payload, input.projectId, opts);
}
