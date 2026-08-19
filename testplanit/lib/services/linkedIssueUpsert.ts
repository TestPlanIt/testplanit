/**
 * upsertLinkedIssueShell — the ONE reviewed raw write to `Issue` outside the
 * blessed sync path (`SyncService.upsertIssueFromExternal`).
 *
 * WHY THIS EXISTS: `baseDb` and any `auditedTransaction` client carry
 * side-effect hooks (Elasticsearch, webhook/live emit) but NO policy plugin
 * — the field-level `@deny` predicate on Issue.title/description/status/
 * priority/parentId (schema.zmodel, requirement-lock clause) never fires on
 * their writes. Every non-sync call site that upserts `Issue` on this tier
 * (PROV-06) routes through this function instead, so the lock holds at
 * every tier, not only the policy-client tier.
 *
 * SECURITY CONTRACT FOR REVIEWERS: `LOCKED_ISSUE_FIELDS` and
 * `isRequirementLocked` mirror the schema.zmodel `@deny('update',
 * isRequirement == true && integrationId != null && requirementDetachedAt
 * == null)` clause exactly — change both together. Adding a new raw
 * `issue.upsert`/`issue.update` anywhere else in this codebase is a
 * regression: the structural containment test
 * (`linkedIssueUpsert.containment.test.ts`) fails the build when it finds
 * one outside the reviewed allowlist.
 */

// Mirrors the field-level @deny predicate in schema.zmodel (Issue model,
// requirement-lock clause) — change both together. `name` is deliberately
// NOT locked: it carries the external key and stays writable. `note` is
// deliberately NOT locked: it is a local annotation (Phase 20 decision P1c).
export const LOCKED_ISSUE_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "parentId",
] as const;

type LockableRow = {
  isRequirement?: boolean | null;
  integrationId?: number | null;
  requirementDetachedAt?: Date | string | null;
} | null;

/**
 * The lock predicate, identical to the schema.zmodel field-level `@deny`: a
 * synced (integrationId set), classified-as-requirement, non-detached row
 * has its tracker-owned fields locked against non-sync writers.
 */
export function isRequirementLocked(row: LockableRow): boolean {
  if (!row) return false;
  return (
    row.isRequirement === true &&
    row.integrationId != null &&
    row.requirementDetachedAt == null
  );
}

interface UpsertLinkedIssueShellArgs {
  externalId: string;
  integrationId: number;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
  select?: Record<string, unknown>;
}

export async function upsertLinkedIssueShell(
  db: any,
  args: UpsertLinkedIssueShellArgs
): Promise<any> {
  const { externalId, integrationId, create, update, select } = args;
  const where = { externalId_integrationId: { externalId, integrationId } };

  // Guarded existence pre-check — same idiom as
  // `SyncService.upsertIssueFromExternal` and
  // `MilestoneSyncService._upsertMilestoneShell`: some db clients/mocks
  // (and any injected transaction client) expose `issue.upsert` but omit
  // `findUnique` — absence reads as "not found" rather than throwing.
  const existing =
    typeof db.issue?.findUnique === "function"
      ? await db.issue.findUnique({
          where,
          select: {
            id: true,
            isRequirement: true,
            integrationId: true,
            requirementDetachedAt: true,
          },
        })
      : null;

  // Only the update branch is ever stripped — a fresh create has no prior
  // locked state to protect, and the caller's create payload is the row's
  // own initial values, not an overwrite of tracker-owned data.
  let effectiveUpdate = update;
  if (isRequirementLocked(existing)) {
    effectiveUpdate = { ...update };
    for (const field of LOCKED_ISSUE_FIELDS) {
      delete effectiveUpdate[field];
    }
  }

  return db.issue.upsert({
    where,
    create,
    update: effectiveUpdate,
    ...(select ? { select } : {}),
  });
}
