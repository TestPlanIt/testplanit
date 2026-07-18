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
 * Multi-project fan-out: an Issue's home `projectId` is nullable, and the
 * issue can be linked across projects via its `caseIssues` / `sessions` /
 * `sessionResults` / `testRuns` / `testRunResults` / `testRunStepResults`
 * relations (each of those entities carries its own project). A single status
 * change is therefore relevant to webhook subscribers in EVERY project the
 * issue touches, not just its home project. Each emitter resolves the union of
 * {home project} ∪ {linked-entity projects} and writes ONE outbox row per
 * unique project id — the outbox row's `projectId` is the delivery scope that
 * `fanoutToConfigs` uses to select that project's OUTBOUND configs. The
 * payload's `projectId` field stays the issue's home project (backward compat;
 * may be null for integration-only issues) — the routing is what fans out.
 *
 * Payload contracts:
 *   - issue.created carries `linkedRefs` with the IDs of the related
 *     repositoryCases / testRuns / testRunResults / testRunStepResults /
 *     sessions / sessionResults. IDs only — keeps
 *     the payload compact; consumers refetch full details via authenticated
 *     channels if they need them.
 *   - issue.updated carries a generic top-level diff via computeObjectDiff.
 *  No-op updates (changedFields.length === 0) are skipped.
 *   - issue.deleted carries the pre-delete snapshot (id + title). Delete is
 *     routed to the home project only: this hook runs AFTER the row (and its
 *     cascade-deleted join rows) are gone, so the linked projects are no
 *     longer derivable. Soft-delete (isDeleted=true) flows through
 *     emitIssueUpdated and DOES fan out cross-project.
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

interface LinkedRefs {
  repositoryCaseIds: number[];
  testRunIds: number[];
  testRunResultIds: number[];
  testRunStepResultIds: number[];
  sessionIds: number[];
  sessionResultIds: number[];
}

interface IssueLinkage {
  /** IDs of every related entity — shipped in the issue.created payload. */
  linkedRefs: LinkedRefs;
  /** Distinct project ids the linked entities belong to (home NOT included). */
  linkedProjectIds: number[];
}

/**
 * Single source of truth for an issue's linkage. Fetches the six related
 * collections in one `findUnique`, selecting both each row's id (for
 * `linkedRefs`) and the project it resolves to (for cross-project fan-out).
 * Returns empty structures when the issue no longer exists (e.g. queried after
 * a hard delete) so callers can safely fall back to the home project.
 */
async function loadIssueLinkage(
  issueId: number,
  tx: TxClient
): Promise<IssueLinkage> {
  const linked = await tx.issue.findUnique({
    where: { id: issueId },
    select: {
      caseIssues: {
        select: { case: { select: { id: true, projectId: true } } },
      },
      testRuns: { select: { id: true, projectId: true } },
      testRunResults: {
        select: { id: true, testRun: { select: { projectId: true } } },
      },
      testRunStepResults: {
        select: {
          id: true,
          testRunResult: {
            select: { testRun: { select: { projectId: true } } },
          },
        },
      },
      sessions: { select: { id: true, projectId: true } },
      sessionResults: {
        select: { id: true, session: { select: { projectId: true } } },
      },
    },
  });

  const caseIssues = linked?.caseIssues ?? [];
  const testRuns = linked?.testRuns ?? [];
  const testRunResults = linked?.testRunResults ?? [];
  const testRunStepResults = linked?.testRunStepResults ?? [];
  const sessions = linked?.sessions ?? [];
  const sessionResults = linked?.sessionResults ?? [];

  const linkedRefs: LinkedRefs = {
    repositoryCaseIds: caseIssues.map((ci) => ci.case.id),
    testRunIds: testRuns.map((r) => r.id),
    testRunResultIds: testRunResults.map((r) => r.id),
    testRunStepResultIds: testRunStepResults.map((r) => r.id),
    sessionIds: sessions.map((r) => r.id),
    sessionResultIds: sessionResults.map((r) => r.id),
  };

  const projectIds = new Set<number>();
  const add = (id: number | null | undefined) => {
    if (id != null) projectIds.add(id);
  };
  for (const ci of caseIssues) add(ci.case?.projectId);
  for (const r of testRuns) add(r.projectId);
  for (const r of testRunResults) add(r.testRun?.projectId);
  for (const r of testRunStepResults) add(r.testRunResult?.testRun?.projectId);
  for (const r of sessions) add(r.projectId);
  for (const r of sessionResults) add(r.session?.projectId);

  return { linkedRefs, linkedProjectIds: [...projectIds] };
}

/** Union of the issue's home project (if any) with its linked-entity projects. */
function collectTargetProjectIds(
  homeProjectId: number | null,
  linkedProjectIds: number[]
): number[] {
  const ids = new Set<number>();
  if (homeProjectId != null) ids.add(homeProjectId);
  for (const id of linkedProjectIds) ids.add(id);
  return [...ids];
}

/** Write one outbox row per target project, all inside the caller's tx. */
async function emitToProjects(
  eventName: string,
  payload: unknown,
  projectIds: number[],
  tx: TxClient,
  actorUserId?: string | null
): Promise<void> {
  for (const projectId of projectIds) {
    await webhookEvents.emit(eventName, payload, {
      projectId,
      tx,
      actorUserId,
    });
  }
}

export async function emitIssueCreated(
  row: IssueRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  // Fetch linkable refs (just IDs to keep payload small) and the projects the
  // linked entities belong to. The Issue model has six related collections at
  // trust boundaries; we ship the ids so consumers (Slack/Jira) see the full
  // impact set without an extra round-trip, and we route to every project they
  // touch (cross-project fan-out).
  const { linkedRefs, linkedProjectIds } = await loadIssueLinkage(row.id, tx);
  const targetProjectIds = collectTargetProjectIds(
    opts.projectId ?? row.projectId,
    linkedProjectIds
  );
  // Integration-only issues without a project context AND without any linked
  // entity have no destination to fan out to.
  if (targetProjectIds.length === 0) return;

  await emitToProjects(
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
    targetProjectIds,
    tx,
    opts.actorUserId
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

  const diff = computeObjectDiff(
    oldRow as unknown as Record<string, unknown>,
    newRow as unknown as Record<string, unknown>
  );
  // Skip no-op updates (e.g. ZenStack policy-pass with no field change).
  if (diff.changedFields.length === 0) return;

  const { linkedProjectIds } = await loadIssueLinkage(newRow.id, tx);
  const targetProjectIds = collectTargetProjectIds(
    opts.projectId ?? newRow.projectId,
    linkedProjectIds
  );
  if (targetProjectIds.length === 0) return;

  await emitToProjects(
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
    targetProjectIds,
    tx,
    opts.actorUserId
  );
}

export async function emitIssueDeleted(
  oldRow: IssueRow,
  tx: TxClient,
  opts: EmitOptions = {}
): Promise<void> {
  // Home project only: this after-delete hook runs once the issue row and its
  // cascade-deleted join rows are already gone, so linked-entity projects are
  // no longer derivable here. (Soft-delete flows through emitIssueUpdated,
  // which still fans out cross-project.)
  const homeProjectId = opts.projectId ?? oldRow.projectId;
  if (homeProjectId == null) return;
  await webhookEvents.emit(
    "issue.deleted",
    {
      id: oldRow.id,
      name: oldRow.name,
      title: oldRow.title,
      projectId: oldRow.projectId,
    },
    {
      projectId: homeProjectId,
      tx,
      actorUserId: opts.actorUserId,
    }
  );
}
