import type { TxClient } from "~/lib/zenstack";

import { computeObjectDiff } from "~/lib/webhooks/diff";
import { webhookEvents } from "~/lib/webhooks/events";

/**
 * Emit per-mutation outbound webhook events for the Issue model.
 *
 * Catalog: issue.created / issue.updated / issue.deleted ONLY. There is
 * intentionally NO dedicated resolution event — consumers detect resolution
 * by filtering `issue.updated` payloads where
 * `diff.changedFields.includes("status")`.
 *
 * Payload contracts:
 *   - issue.created carries `linkedRefs` with the IDs of the related
 *     repositoryCases / testRuns / testRunResults / testRunStepResults /
 *     sessions / sessionResults. IDs only — keeps
 *     the payload compact; consumers refetch full details via authenticated
 *     channels if they need them.
 *   - issue.updated carries a generic top-level diff via computeObjectDiff.
 *  No-op updates (changedFields.length === 0) are skipped.
 *   - issue.deleted carries the pre-delete snapshot (id + title).
 */

/** Minimal shape we read from an Issue row to assemble payloads. */
export interface IssueRow {
  id: number;
  name: string;
  title: string;
  status: string | null;
  priority?: string | null;
  externalId?: string | null;
  externalKey?: string | null;
  externalUrl?: string | null;
  externalStatus?: string | null;
  issueTypeName?: string | null;
  projectId: number | null;
  integrationId?: number | null;
  data?: unknown;
  description?: string | null;
}

interface EmitOptions {
  projectId?: number;
  actorUserId?: string | null;
}

export async function emitIssueCreated(
  row: IssueRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  // Issue.projectId is nullable in the schema; integration-only issues
  // without a project context have no destination to fan out to.
  if (row.projectId == null) return;

  // Fetch linkable refs (just IDs to keep payload small). The Issue model
  // has six related collections at trust boundaries; we ship them here so
  // consumers (Slack/Jira) see the full impact set without an extra
  // round-trip.
  const linked = await tx.issue.findUnique({
    where: { id: row.id },
    select: {
      repositoryCases: { select: { id: true } },
      testRuns: { select: { id: true } },
      testRunResults: { select: { id: true } },
      testRunStepResults: { select: { id: true } },
      sessions: { select: { id: true } },
      sessionResults: { select: { id: true } },
    },
  });

  const linkedRefs = {
    repositoryCaseIds: (linked?.repositoryCases ?? []).map((r) => r.id),
    testRunIds: (linked?.testRuns ?? []).map((r) => r.id),
    testRunResultIds: (linked?.testRunResults ?? []).map((r) => r.id),
    testRunStepResultIds: (linked?.testRunStepResults ?? []).map((r) => r.id),
    sessionIds: (linked?.sessions ?? []).map((r) => r.id),
    sessionResultIds: (linked?.sessionResults ?? []).map((r) => r.id),
  };

  await webhookEvents.emit(
    "issue.created",
    {
      id: row.id,
      name: row.name,
      title: row.title,
      status: row.status,
      priority: row.priority ?? null,
      externalId: row.externalId ?? null,
      externalKey: row.externalKey ?? null,
      externalUrl: row.externalUrl ?? null,
      externalStatus: row.externalStatus ?? null,
      issueTypeName: row.issueTypeName ?? null,
      projectId: row.projectId,
      integrationId: row.integrationId ?? null,
      linkedRefs,
    },
    {
      projectId: opts.projectId ?? row.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

export async function emitIssueUpdated(
  oldRow: IssueRow | null,
  newRow: IssueRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  // Defensive — middleware can pass null when args.where is malformed.
  if (!oldRow) return;
  if (newRow.projectId == null) return;

  const diff = computeObjectDiff(
    oldRow as unknown as Record<string, unknown>,
    newRow as unknown as Record<string, unknown>
  );
  // Skip no-op updates (e.g. ZenStack policy-pass with no field change).
  if (diff.changedFields.length === 0) return;

  await webhookEvents.emit(
    "issue.updated",
    {
      id: newRow.id,
      name: newRow.name,
      title: newRow.title,
      status: newRow.status,
      priority: newRow.priority ?? null,
      externalKey: newRow.externalKey ?? null,
      externalUrl: newRow.externalUrl ?? null,
      projectId: newRow.projectId,
      integrationId: newRow.integrationId ?? null,
      after: newRow,
      diff,
    },
    {
      projectId: opts.projectId ?? newRow.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}

export async function emitIssueDeleted(
  oldRow: IssueRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  if (oldRow.projectId == null) return;
  await webhookEvents.emit(
    "issue.deleted",
    {
      id: oldRow.id,
      name: oldRow.name,
      title: oldRow.title,
      projectId: oldRow.projectId,
    },
    {
      projectId: opts.projectId ?? oldRow.projectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
