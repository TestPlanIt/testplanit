import { rawDb as defaultDb } from "@/lib/rawDb";
import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { publishMilestoneWakeUp } from "~/lib/live/publish";
import { captureAuditEvent } from "~/lib/services/auditLog";
import type { DbClient, TxClient } from "~/lib/zenstack";
import valkeyConnection from "../../valkey";
import type { ExternalMilestone, IssueAdapter } from "../adapters/IssueAdapter";
import { integrationManager } from "../IntegrationManager";
import { IMPORT_MAX_CAP, syncService } from "./SyncService";

/**
 * Sibling service to `SyncService.ts` — mirrors its idioms (freshness gate,
 * per-entity Redis lock, raw-db writes) for the new Milestones sync engine.
 * Deliberately NOT a subclass (CONTEXT.md locks "mirroring idioms" as the
 * pattern, not inheritance) since milestone sync has a materially different
 * shape (shell upsert + type provisioning + auto-track discovery) from
 * issue sync.
 *
 * Phase 17 scope: upserts milestone SHELLS only (name/note/dates/state).
 * Member-issue population (`MilestoneIssue` rows) is Phase 18 — see
 * `getMilestoneIssues` on `IssueAdapter`, interface-only this phase.
 */

export interface MilestoneSyncServiceOptions {
  dbClient?: DbClient;
  /**
   * Skip the upstream API call if `Milestones.lastSyncedAt` is fresher than
   * this many seconds. Same convention as `SyncServiceOptions`:
   *   • manual "Sync now"     → 0   (always fetch)
   *   • page-load passive refresh → 300 (5 min)
   *   • webhook (Phase 19)    → 15
   */
  minFreshnessSeconds?: number;
  /**
   * When set, scopes the refresh's milestone lookup to rows owned by this
   * project. `[externalId, integrationId]` is globally unique but a single
   * Integration can be mapped to many projects, so a caller authorized for
   * project A must not be able to refresh (or probe the existence of)
   * project B's milestone through the shared integration. The `/now` route
   * always passes the projectId it authorized against.
   */
  projectId?: number;
}

export interface MilestoneRefreshResult {
  success: boolean;
  cached?: boolean;
  locked?: boolean;
  /**
   * True when no linked Milestones row matches the requested
   * externalId/integrationId (within the caller's project scope, when
   * `projectId` was provided) — callers map this to a 404 rather than a 500.
   */
  notFound?: boolean;
  error?: string;
  /**
   * Internal/telemetry-only signal: true when this pass's membership
   * reconciliation hit `IMPORT_MAX_CAP` and stopped paging. NOT a
   * client-visible "capped" surface — that is delivered by 18-05's live
   * overflow route (`{ members, linkedCount, cap, overflowTotal }`), which
   * 18-07's panel reads directly. Do not build persistence/exposure for
   * this field beyond server-side logging.
   */
  membershipReachedCap?: boolean;
}

export interface MilestoneImportResult {
  success: boolean;
  /**
   * Shell-level counters: a milestone counts as imported/updated once its
   * shell upsert succeeds, even if its membership reconciliation then
   * partially fails — check `membershipErrors` to distinguish "shell ok,
   * members incomplete" from a failed import (WR-03).
   */
  imported: number;
  updated: number;
  /** Shell/fetch-level failures — these mean the import itself broke. */
  errors: string[];
  /** Membership reconciliation failures for successfully-imported shells. */
  membershipErrors: string[];
}

export interface ProjectMilestoneSyncResult {
  success: boolean;
  autoImported: number;
  refreshed: number;
  errors: string[];
  /** True when the project-level freshness marker short-circuited the pass. */
  cached?: boolean;
}

/**
 * Why a milestone was converted from synced to local (HOOK-02 / D-05..D-12).
 * THREE distinct values persisted into `Milestones.externalState` — a
 * "manual_unlink" must NEVER collapse into "deleted": Plan 05's badge
 * renders a permanent removed/merged badge for "deleted"/"merged" and NO
 * badge for "manual_unlink" (D-11), which is only possible if the three
 * reasons stay distinguishable downstream.
 */
export type MilestoneConversionReason = "deleted" | "merged" | "manual_unlink";

export interface ConvertMilestoneToLocalResult {
  success: boolean;
  /** True when the milestone was already detached — idempotent no-op. */
  alreadyDetached?: boolean;
}

/**
 * Per-entity Redis lock for milestone sync — DISTINCT namespace from the
 * issue-sync lock in SyncService.ts (lines 97-127) so an externalId that
 * happens to collide between an issue and a milestone never cross-locks.
 */
const MILESTONE_SYNC_LOCK_TTL_SECONDS = 60;
// Matches the ?trigger=hover freshness window (300s) used by the passive
// page-load refresh — see app/api/integrations/[id]/milestone-sync/now.
const PROJECT_PASS_FRESHNESS_TTL_SECONDS = 300;

function milestoneSyncLockKey(
  integrationId: number,
  externalId: string
): string {
  return `sync-lock:milestone:${integrationId}:${externalId}`;
}

async function acquireMilestoneSyncLock(
  integrationId: number,
  externalId: string
): Promise<boolean> {
  // Fail-open if Valkey isn't connected — better availability than blocking
  // sync entirely on cache infra (matches SyncService precedent).
  if (!valkeyConnection) return true;
  const key = milestoneSyncLockKey(integrationId, externalId);
  const result = await valkeyConnection.set(
    key,
    "1",
    "EX",
    MILESTONE_SYNC_LOCK_TTL_SECONDS,
    "NX"
  );
  return result === "OK";
}

async function releaseMilestoneSyncLock(
  integrationId: number,
  externalId: string
): Promise<void> {
  if (!valkeyConnection) return;
  await valkeyConnection.del(milestoneSyncLockKey(integrationId, externalId));
}

/**
 * Project-pass freshness marker. The per-milestone gate above only protects
 * the refresh loop — the auto-track diff at the top of
 * `performProjectMilestoneSync` fetches every configured kind from the
 * upstream API before that loop is reached, so an ungated pass still costs
 * kind x mapping upstream calls on EVERY page load. The marker makes a
 * passive (minFreshnessSeconds > 0) pass a true no-op inside the window;
 * manual "Sync now" passes 0 and bypasses it. Fail-open without Valkey.
 */
function projectPassFreshnessKey(
  integrationId: number,
  projectId: number
): string {
  return `sync-fresh:milestone-project:${integrationId}:${projectId}`;
}

async function isProjectPassFresh(
  integrationId: number,
  projectId: number
): Promise<boolean> {
  if (!valkeyConnection) return false;
  return (
    (await valkeyConnection.exists(
      projectPassFreshnessKey(integrationId, projectId)
    )) === 1
  );
}

async function markProjectPassFresh(
  integrationId: number,
  projectId: number,
  ttlSeconds: number
): Promise<void> {
  if (!valkeyConnection || ttlSeconds <= 0) return;
  await valkeyConnection.set(
    projectPassFreshnessKey(integrationId, projectId),
    "1",
    "EX",
    ttlSeconds
  );
}

/**
 * Minimal plain-text -> Tiptap doc converter for mapping a tracker's plain
 * description/goal string into the `Milestones.note` Json column (which the
 * app's rich-text editor expects in Tiptap doc shape). No existing helper
 * does this in the codebase (grepped for `tiptapFromPlainText` and
 * `type: "doc"` construction — none found), so this is new, minimal logic:
 * one paragraph node per non-empty line. Returns null for empty/undefined
 * input so `note` stays null rather than an empty-but-present doc.
 */
function tiptapFromPlainText(text: string | null | undefined): any | null {
  if (!text || !text.trim()) return null;
  const lines = text.split(/\r?\n/);
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: line.length > 0 ? [{ type: "text", text: line }] : [],
    })),
  };
}

/**
 * Maps an `ExternalMilestone` (RELEASE or ITERATION) into the Milestones
 * create/update field set per MAP-01 (RELEASE) / MAP-02 (ITERATION).
 *   RELEASE:   name -> name, description -> note, startDate -> startedAt,
 *              endDate (releaseDate) -> completedAt,
 *              state CLOSED -> isCompleted, state ACTIVE -> isStarted
 *   ITERATION: name -> name, goal (description) -> note, startDate ->
 *              startedAt, endDate -> completedAt,
 *              state ACTIVE -> isStarted, state CLOSED -> isCompleted
 * Both kinds share the same field shape on `ExternalMilestone` — the
 * kind-specific semantics (releaseDate vs sprint end, goal vs description)
 * are already normalized by the adapter (17-03), so the mapping here is
 * kind-agnostic aside from `externalKind`.
 */
function mapExternalMilestoneToFields(ext: ExternalMilestone) {
  const note = tiptapFromPlainText(ext.description);
  return {
    name: ext.name,
    // ZenStack v3's Kysely CRUD layer rejects a literal `null` for an
    // optional Json field (it expects the key omitted, not JS `null`) —
    // spread `note` in only when present so an empty description doesn't
    // produce a payload the Zod schema rejects.
    ...(note !== null ? { note } : {}),
    startedAt: ext.startDate ?? null,
    completedAt: ext.endDate ?? null,
    isStarted: ext.state === "ACTIVE",
    isCompleted: ext.state === "CLOSED",
    externalKind: ext.kind,
    externalState: ext.rawState ?? ext.state,
    externalUrl: ext.url ?? null,
  };
}

export class MilestoneSyncService {
  /**
   * Shared gate + lock around any inner milestone sync, mirroring
   * `SyncService._withGateAndLock` (lines 1130-1181). Milestones has no
   * `externalKey` fallback (unlike Issue), so the freshness lookup is a
   * plain `{ integrationId, externalId }` match.
   */
  private async _withGateAndLock(
    integrationId: number,
    externalId: string,
    serviceOptions: MilestoneSyncServiceOptions,
    inner: () => Promise<MilestoneRefreshResult>
  ): Promise<MilestoneRefreshResult> {
    const db = serviceOptions.dbClient || defaultDb;
    const minFreshnessSeconds = serviceOptions.minFreshnessSeconds ?? 0;
    try {
      if (minFreshnessSeconds > 0) {
        const stored = await db.milestones.findFirst({
          where: {
            integrationId,
            externalId,
            ...(serviceOptions.projectId != null
              ? { projectId: serviceOptions.projectId }
              : {}),
          },
          select: { lastSyncedAt: true },
        });
        if (stored?.lastSyncedAt) {
          const ageMs = Date.now() - stored.lastSyncedAt.getTime();
          if (ageMs < minFreshnessSeconds * 1000) {
            return { success: true, cached: true };
          }
        }
      }

      const acquired = await acquireMilestoneSyncLock(
        integrationId,
        externalId
      );
      if (!acquired) {
        return { success: true, locked: true };
      }

      try {
        return await inner();
      } finally {
        await releaseMilestoneSyncLock(integrationId, externalId);
      }
    } catch (error: any) {
      console.error(`Failed to refresh milestone ${externalId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Resolves the adapter for an integration. Thin wrapper over
   * `integrationManager.getAdapter` so callers don't need to know the
   * `String(integrationId)` coercion detail.
   */
  private async _getAdapter(
    integrationId: number,
    db: DbClient
  ): Promise<IssueAdapter> {
    const adapter = await integrationManager.getAdapter(
      String(integrationId),
      db
    );
    if (!adapter) {
      throw new Error("Invalid adapter for milestone synchronization");
    }
    if (!adapter.getExternalMilestones) {
      throw new Error(
        "Adapter does not support milestone sync (getExternalMilestones missing)"
      );
    }
    return adapter;
  }

  /**
   * Idempotent shell upsert on `[externalId, integrationId]` — the ONLY
   * write path through the new `@deny('update', integrationId != null)`
   * locks (raw db, per Shared Patterns "Raw-db write path bypassing
   * @deny"). `milestoneTypeId`/`projectId`/`createdById` are only set on
   * CREATE — an update never touches ownership/type assignment fields
   * mirroring `_createIssueFromExternal`'s create/update split.
   */
  private async _upsertMilestoneShell(
    db: DbClient,
    integrationId: number,
    projectId: number,
    milestoneTypeId: number,
    createdById: string,
    ext: ExternalMilestone
  ): Promise<{ id: number; created: boolean }> {
    const fields = mapExternalMilestoneToFields(ext);
    // Guarded existence pre-check (same idiom as
    // `SyncService.upsertIssueFromExternal`'s `db.issue?.findUnique` guard):
    // some db clients/mocks expose `milestones.findFirst`/`upsert` but omit
    // `findUnique` — absence reads as "not found" rather than throwing.
    const existing =
      typeof db.milestones?.findUnique === "function"
        ? await db.milestones.findUnique({
            where: {
              externalId_integrationId: {
                externalId: ext.id,
                integrationId,
              },
            },
            select: { id: true },
          })
        : null;

    const row = await db.milestones.upsert({
      where: {
        externalId_integrationId: {
          externalId: ext.id,
          integrationId,
        },
      },
      create: {
        ...fields,
        externalId: ext.id,
        integrationId,
        projectId,
        milestoneTypesId: milestoneTypeId,
        createdBy: createdById,
        lastSyncedAt: new Date(),
      },
      update: {
        ...fields,
        lastSyncedAt: new Date(),
        // Explicit re-import (picker) is the ONLY resurrect path for a
        // tombstoned (soft-deleted) synced milestone — TPI-side delete of a
        // synced milestone means "stop tracking", and the auto-track diff
        // deliberately does not re-surface tombstones (see the comment at
        // that diff below). But a user explicitly re-selecting a
        // previously-deleted row in the picker (which excludes already-
        // linked, non-deleted rows from its candidate list, so a deleted
        // row IS re-selectable) must bring it back.
        isDeleted: false,
        // Re-link on re-import (D-07/D-12): a previously-converted
        // (detached) milestone found again via the same [externalId,
        // integrationId] pairing re-attaches instead of creating a
        // duplicate — clearing detachedAt resumes tracker-owned field
        // locks and re-establishes sync eligibility for the SAME row,
        // preserving its runs/sessions/links.
        detachedAt: null,
      },
    });

    const result = { id: row.id, created: !existing };
    // D-13: one publish call site per write path — the creating branch of
    // the shell upsert. Update-branch refreshes publish from their own
    // caller (_performMilestoneRefreshInner) to avoid double-firing on
    // every field sync.
    if (result.created) {
      publishMilestoneWakeUp({
        event: "milestone.created",
        milestoneId: result.id,
        projectId,
      });
    }

    return result;
  }

  /**
   * Converts a synced milestone to a fully local one (HOOK-02 / D-05..D-12).
   * Called from the webhook apply service (upstream delete/merge, Plan 04)
   * or the manual unlink route (Plan 05) — never from client-trusted input.
   *
   * ONE `db.$transaction` wraps both writes so the milestone can never be
   * observed half-detached with stale SYNCED links (T-19-03-02):
   *   1. `Milestones.detachedAt = now()` — the lock-lift signal.
   *      `integrationId` is DELIBERATELY left untouched (Pitfall 3): nulling
   *      it would destroy the `[externalId, integrationId]` re-link identity
   *      and make the permanent badge guard disappear.
   *   2. `Milestones.externalState` gets a THREE-WAY value — "merged" /
   *      "manual_unlink" / "deleted" — so Plan 05's badge can render the
   *      permanent removed/merged badge ONLY for deleted/merged and NO
   *      badge for manual_unlink (D-11). manual_unlink must NEVER collapse
   *      into "deleted".
   *   3. `MilestoneIssue` rows for this milestone with `source: "SYNCED"`
   *      flip to `source: "MANUAL"` (D-05) — MANUAL-is-sticky semantics
   *      (Phase 18 D-11) now govern every link.
   *
   * Idempotent: calling this on an already-detached milestone is a clean
   * no-op success, mirroring the existing `isDeleted` tombstone
   * short-circuit at `_performMilestoneRefreshInner`.
   *
   * Raw-db write path bypassing `@deny('update', integrationId != null &&
   * detachedAt == null)` — the ONLY writer permitted through those field
   * locks, same contract `_upsertMilestoneShell` documents.
   *
   * Post-commit (after the transaction settles, never inside it):
   *   - A reason-tagged audit event (`captureAuditEvent`, action UPDATE,
   *     entityType "Milestones") records `metadata.reason` so every
   *     conversion — especially a manual unlink — is traceable
   *     (T-19-05-04 depends on this).
   *   - `publishMilestoneWakeUp({ event: "milestone.converted" })` AND a
   *     membership-aware `milestone.membership_changed` wake-up, since the
   *     bulk SYNCED->MANUAL flip changes what the member table should show
   *     (RESEARCH.md Pitfall 5).
   */
  async convertMilestoneToLocal(
    db: DbClient,
    milestoneId: number,
    reason: MilestoneConversionReason,
    mergedToExternalId?: string
  ): Promise<ConvertMilestoneToLocalResult> {
    const existing = await db.milestones.findUnique({
      where: { id: milestoneId },
      select: { id: true, projectId: true, detachedAt: true },
    });
    if (!existing) {
      return { success: false };
    }

    // Idempotent early-return, mirroring the `isDeleted` tombstone
    // short-circuit — a second conversion call (e.g. a redelivered webhook,
    // or an unlink click racing a webhook-driven conversion) must not
    // double-flip already-MANUAL links or overwrite an earlier reason.
    if (existing.detachedAt) {
      return { success: true, alreadyDetached: true };
    }

    const externalState: "deleted" | "merged" | "manual_unlink" =
      reason === "merged"
        ? "merged"
        : reason === "manual_unlink"
          ? "manual_unlink"
          : "deleted";

    await db.$transaction(async (tx: TxClient) => {
      await tx.milestones.update({
        where: { id: milestoneId },
        data: {
          detachedAt: new Date(),
          // integrationId is DELIBERATELY left non-null — see Pitfall 3.
          externalState,
          // Spread-in-only-when-present idiom (mapExternalMilestoneToFields
          // precedent) — mergedToExternalId is only meaningful on a merge.
          ...(mergedToExternalId ? { mergedToExternalId } : {}),
        },
      });
      await tx.milestoneIssue.updateMany({
        where: { milestoneId, source: "SYNCED" },
        data: { source: "MANUAL" },
      });
    });

    await captureAuditEvent({
      action: "UPDATE",
      entityType: "Milestones",
      entityId: String(milestoneId),
      projectId: existing.projectId,
      userId: SYSTEM_ACTOR_ID,
      metadata: {
        reason,
        ...(mergedToExternalId ? { mergedToExternalId } : {}),
      },
    });

    publishMilestoneWakeUp({
      event: "milestone.converted",
      milestoneId,
      projectId: existing.projectId,
    });
    // Pitfall 5: the bulk SYNCED->MANUAL flip changes what the member table
    // should render — fire a membership-aware wake-up too so it re-renders
    // without a hard refresh.
    publishMilestoneWakeUp({
      event: "milestone.membership_changed",
      milestoneId,
      projectId: existing.projectId,
    });

    return { success: true };
  }

  /**
   * Reconciles the member `Issue`s of a synced milestone against the
   * tracker's current membership (D-01: runs on every pass). Pages through
   * `adapter.getMilestoneIssues`, delegating every fetched member to the
   * canonical `SyncService.upsertIssueFromExternal` (D-12 — no
   * milestone-private issue writer) and SYNCED-linking it via the raw db
   * client (D-10 — the enhanced client's `@deny('create,delete', source ==
   * SYNCED)` would block this write, which is the point). Departed SYNCED
   * members lose their link (Issue row kept); MANUAL links are never
   * created, deleted, or downgraded (D-11 — the upsert's `update: {}` and
   * the deleteMany's `source: "SYNCED"` scope both enforce this).
   *
   * Callers guard on `adapter.getMilestoneIssues` before calling this — a
   * missing method (non-membership / DC no-op) is a clean skip, not an
   * error, so this method assumes the adapter supports it.
   */
  private async _reconcileMembership(
    db: DbClient,
    integrationId: number,
    projectId: number,
    milestoneId: number,
    ext: ExternalMilestone,
    adapter: IssueAdapter
  ): Promise<{ reachedCap: boolean }> {
    // `IMPORT_MAX_CAP` is a live named-export binding from `./SyncService` —
    // some test doubles (e.g. the 18-01 membership-delegation RED scaffold)
    // mock that module without re-exporting it, since those tests only
    // exercise the delegation/link-creation contract, not cap enforcement.
    // A vi.mock proxy THROWS on accessing an undeclared export (rather than
    // returning undefined), so reading it needs a try/catch, not `??`. The
    // fallback is deliberately NOT a redefined cap literal — it's
    // "effectively uncapped" for that narrow test-double scenario (which
    // never fetches anywhere near a cap-worthy page size). Every other
    // caller (including the reconciliation cap-enforcement tests and
    // production) gets the real imported `IMPORT_MAX_CAP`.
    let cap: number;
    try {
      cap = IMPORT_MAX_CAP;
    } catch {
      cap = Number.MAX_SAFE_INTEGER;
    }
    const currentExternalIds = new Set<string>();
    let reachedCap = false;
    let pageToken: string | undefined;

    // 1. Page through the tracker's current membership, importing each
    //    member (delegated) and SYNCED-linking it, stopping at the cap.
    do {
      const remaining = cap - currentExternalIds.size;
      if (remaining <= 0) {
        reachedCap = true;
        break;
      }

      const page = await adapter.getMilestoneIssues!(
        { id: ext.id, kind: ext.kind },
        { pageToken, limit: Math.min(100, remaining) }
      );

      for (const issueData of page.issues) {
        if (currentExternalIds.size >= cap) {
          reachedCap = true;
          break;
        }
        currentExternalIds.add(issueData.id);

        const { id: issueId } = await syncService.upsertIssueFromExternal(
          db,
          integrationId,
          projectId,
          issueData
        );

        await db.milestoneIssue.upsert({
          where: {
            milestoneId_issueId: { milestoneId, issueId },
          },
          create: { milestoneId, issueId, source: "SYNCED" },
          // Never touches an existing row's source — a pre-existing MANUAL
          // link stays MANUAL (D-11).
          update: {},
        });
      }

      pageToken = page.hasMore ? page.nextPageToken : undefined;
      if (pageToken && currentExternalIds.size >= cap) {
        reachedCap = true;
      }
    } while (pageToken);

    // 2. Reconcile departures: any currently-SYNCED link whose issue is no
    //    longer among the tracker's current members gets its link removed
    //    (the Issue row itself is untouched). MANUAL links are structurally
    //    excluded by the `source: "SYNCED"` filter below (D-11). Guarded
    //    the same way as the `findUnique` pre-checks above — some test
    //    doubles omit `findMany` on this model when a test only exercises
    //    the import/link-creation half of the contract, not departures.
    const syncedLinks =
      typeof db.milestoneIssue?.findMany === "function"
        ? await db.milestoneIssue.findMany({
            where: { milestoneId, source: "SYNCED" },
            select: { issueId: true, issue: { select: { externalId: true } } },
          })
        : [];
    const departedIds = syncedLinks
      // Defensive re-filter on `source === "SYNCED"` in application code,
      // not just the query's `where` clause — belt-and-suspenders for
      // D-11 (MANUAL links must never enter the deleted set even if a
      // caller-supplied db client's findMany doesn't honor `where`).
      .filter(
        (link: any) =>
          link.source === "SYNCED" &&
          !currentExternalIds.has(link.issue?.externalId)
      )
      .map((link: any) => link.issueId);

    if (departedIds.length > 0) {
      await db.milestoneIssue.deleteMany({
        where: {
          milestoneId,
          issueId: { in: departedIds },
          source: "SYNCED",
        },
      });
    }

    return { reachedCap };
  }

  /**
   * Refresh a single milestone shell from the external system.
   *
   * Caller passes `minFreshnessSeconds` via `serviceOptions`:
   *   • 0 / unset → always fetch (manual "Sync now")
   *   • 300       → skip if synced < 5 min ago (page-load passive refresh)
   * A per-entity Valkey lock additionally serializes concurrent fetches —
   * the second caller resolves with `locked: true`.
   */
  async performMilestoneRefresh(
    userId: string,
    integrationId: number,
    externalId: string,
    serviceOptions: MilestoneSyncServiceOptions = {}
  ): Promise<MilestoneRefreshResult> {
    return this._withGateAndLock(
      integrationId,
      externalId,
      serviceOptions,
      () =>
        this._performMilestoneRefreshInner(
          userId,
          integrationId,
          externalId,
          serviceOptions
        )
    );
  }

  private async _performMilestoneRefreshInner(
    userId: string,
    integrationId: number,
    externalId: string,
    serviceOptions: MilestoneSyncServiceOptions
  ): Promise<MilestoneRefreshResult> {
    const db = serviceOptions.dbClient || defaultDb;
    try {
      const existing = await db.milestones.findFirst({
        where: {
          integrationId,
          externalId,
          ...(serviceOptions.projectId != null
            ? { projectId: serviceOptions.projectId }
            : {}),
        },
        select: {
          id: true,
          projectId: true,
          milestoneTypesId: true,
          externalKind: true,
          isDeleted: true,
          detachedAt: true,
        },
      });
      if (!existing) {
        return {
          success: false,
          notFound: true,
          error: `Cannot refresh milestone ${externalId}: no linked Milestones row for integration ${integrationId}`,
        };
      }

      // A soft-deleted (tombstoned) synced milestone means "stop tracking"
      // (user-approved decision) — refresh is a clean no-op success with NO
      // adapter fetch and no write. The only way to bring it back is an
      // explicit re-import through the picker (`_upsertMilestoneShell`'s
      // `update.isDeleted: false`), never an automatic refresh pass.
      //
      // A converted (detached) milestone is likewise no longer sync-eligible
      // — HOOK-02/Pitfall 3/4: `integrationId` stays non-null after
      // conversion (identity + badge), so a naive `isDeleted`-only check
      // would keep pulling upstream state into a row the user (or upstream)
      // deliberately detached. Only an explicit re-import through the
      // picker (`_upsertMilestoneShell`'s `update.detachedAt: null`)
      // re-attaches it, never an automatic refresh pass.
      if (existing.isDeleted || existing.detachedAt) {
        return { success: true };
      }

      const projectKeys = await this._resolveProjectKeys(
        db,
        integrationId,
        existing.projectId
      );

      const adapter = await this._getAdapter(integrationId, db);
      // Try each mapped project key in turn — with 2+ mappings on the same
      // integration/project, the artifact may only be visible under one of
      // them (e.g. an ABT-only sprint when the project is also mapped to
      // ADM). A key whose fetch throws must NOT be treated as "the artifact
      // isn't there" — only surface "no longer present upstream" once every
      // key has been tried and none produced a match; if every key's fetch
      // errored, propagate the fetch error instead (mirrors the
      // all-boards-failed rule in JiraAdapter.fetchJiraSprints).
      let match: ExternalMilestone | undefined;
      let firstFetchError: unknown = null;
      let allKeysErrored = true;
      for (const projectKey of projectKeys) {
        try {
          const { items } = await adapter.getExternalMilestones!({
            projectKey,
            // Scope the fetch to the milestone's known kind when available —
            // avoids an unnecessary second-kind fan-out on every refresh.
            ...(existing.externalKind
              ? { kind: existing.externalKind as "RELEASE" | "ITERATION" }
              : {}),
            includeClosed: true,
          });
          allKeysErrored = false;
          match = items.find((item) => item.id === externalId);
          if (match) break;
        } catch (error) {
          if (firstFetchError === null) firstFetchError = error;
          console.warn(
            `[MilestoneSyncService] getExternalMilestones failed for project key ${projectKey} (integration ${integrationId}):`,
            error
          );
        }
      }
      if (!match) {
        if (allKeysErrored && firstFetchError !== null) {
          throw firstFetchError;
        }
        throw new Error(
          `Milestone ${externalId} no longer present upstream for project ${existing.projectId}`
        );
      }

      const { id: milestoneId, created } = await this._upsertMilestoneShell(
        db,
        integrationId,
        existing.projectId,
        existing.milestoneTypesId,
        userId,
        match
      );
      // _upsertMilestoneShell already publishes `milestone.created` on the
      // creating branch — a refresh pass that updates an existing row gets
      // its own `milestone.updated` wake-up here (D-13: one call site per
      // write path).
      if (!created) {
        publishMilestoneWakeUp({
          event: "milestone.updated",
          milestoneId,
          projectId: existing.projectId,
        });
      }

      let membershipReachedCap = false;
      if (adapter.getMilestoneIssues) {
        const membership = await this._reconcileMembership(
          db,
          integrationId,
          existing.projectId,
          milestoneId,
          match,
          adapter
        );
        membershipReachedCap = membership.reachedCap;
        publishMilestoneWakeUp({
          event: "milestone.membership_changed",
          milestoneId,
          projectId: existing.projectId,
        });
      }

      return {
        success: true,
        ...(membershipReachedCap ? { membershipReachedCap: true } : {}),
      };
    } catch (error: any) {
      console.error(`Failed to refresh milestone ${externalId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Auto-provisions the "Release" and "Sprint" `MilestoneTypes` (MAP-03)
   * and assigns both to the project via `MilestoneTypesAssignment`,
   * returning a `kind -> milestoneTypeId` map. Idempotent — re-provisioning
   * an already-provisioned project is a no-op (name-keyed upsert + upsert
   * on the composite `projectId_milestoneTypeId` key).
   *
   * `MilestoneTypes`/`MilestoneTypesAssignment` are `@@allow('all',
   * auth().access == 'ADMIN')`-gated (admin-only), so this MUST run through
   * the raw db client — the policy-enforced client would reject the write
   * for any non-admin acting user. Mirrors `testCaseImport.ts`'s
   * name-keyed tag-upsert idiom (lines 298-306), adapted to rawDb since
   * there is no user-initiated transaction context here.
   */
  private async _provisionMilestoneTypes(
    db: DbClient,
    projectId: number
  ): Promise<Record<"RELEASE" | "ITERATION", number>> {
    const releaseType = await db.milestoneTypes.upsert({
      where: { name: "Release" },
      create: { name: "Release", isDefault: false, isDeleted: false },
      update: {},
      select: { id: true },
    });
    const sprintType = await db.milestoneTypes.upsert({
      where: { name: "Sprint" },
      create: { name: "Sprint", isDefault: false, isDeleted: false },
      update: {},
      select: { id: true },
    });

    await db.milestoneTypesAssignment.upsert({
      where: {
        projectId_milestoneTypeId: {
          projectId,
          milestoneTypeId: releaseType.id,
        },
      },
      create: { projectId, milestoneTypeId: releaseType.id },
      update: {},
    });
    await db.milestoneTypesAssignment.upsert({
      where: {
        projectId_milestoneTypeId: {
          projectId,
          milestoneTypeId: sprintType.id,
        },
      },
      create: { projectId, milestoneTypeId: sprintType.id },
      update: {},
    });

    return { RELEASE: releaseType.id, ITERATION: sprintType.id };
  }

  /**
   * Resolves ALL active `IntegrationProject.externalProjectKey`s for a given
   * (integrationId, projectId) pair — a project can be mapped to more than
   * one external project key on the same integration (e.g. TPI mapped to
   * both ABT and ADM in Jira), and every one of them must be consulted so
   * an artifact that only exists under a non-first mapping isn't silently
   * dropped. `orderBy: createdAt asc` keeps the fetch order deterministic
   * across calls (helps test/debug reproducibility, not a correctness
   * requirement since callers union across all keys).
   */
  private async _resolveProjectKeys(
    db: DbClient,
    integrationId: number,
    projectId: number
  ): Promise<string[]> {
    const integrationProjects = await db.integrationProject.findMany({
      where: {
        projectIntegration: { integrationId, projectId },
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
      select: { externalProjectKey: true },
    });
    if (integrationProjects.length === 0) {
      throw new Error(
        `No active IntegrationProject mapping for integration ${integrationId} / project ${projectId}`
      );
    }
    return integrationProjects.map(
      (ip: { externalProjectKey: string }) => ip.externalProjectKey
    );
  }

  /**
   * Fetches one `kind` of external milestone across ALL of a project's
   * mapped project keys and dedupes by item id (first wins) — sprints on a
   * shared Jira board WILL appear under multiple project keys, so a naive
   * concat would double-import/double-count them. Per-key fetch failures
   * are collected rather than aborting the whole union: a single bad
   * mapping (revoked scope, deleted external project) shouldn't block
   * artifacts visible under the project's other mappings. Only when EVERY
   * key failed is the failure surfaced — a credential/permission problem
   * must not be swallowed as "no milestones" (mirrors the all-boards-failed
   * rule in `JiraAdapter.fetchJiraSprints`).
   */
  private async _fetchKindAcrossKeys(
    adapter: IssueAdapter,
    keys: string[],
    kind: "RELEASE" | "ITERATION",
    includeClosed: boolean
  ): Promise<ExternalMilestone[]> {
    const byId = new Map<string, ExternalMilestone>();
    let failedKeys = 0;
    let firstError: unknown = null;

    for (const projectKey of keys) {
      try {
        const { items } = await adapter.getExternalMilestones!({
          projectKey,
          kind,
          includeClosed,
        });
        for (const item of items) {
          if (!byId.has(item.id)) {
            byId.set(item.id, item);
          }
        }
      } catch (error) {
        failedKeys += 1;
        if (firstError === null) firstError = error;
        console.warn(
          `[MilestoneSyncService] getExternalMilestones(${kind}) failed for project key ${projectKey}:`,
          error
        );
      }
    }

    if (keys.length > 0 && failedKeys === keys.length) {
      throw firstError;
    }

    return Array.from(byId.values());
  }

  /**
   * Imports selected (or auto-tracked) external milestones as local shells.
   * Provisions the Release/Sprint types once, then upserts each match.
   *
   * Attribution (CONTEXT.md): `createdById` is threaded from the caller —
   * a route acting on behalf of a signed-in admin passes `session.user.id`
   * (explicit import ⇒ acting admin); `performProjectMilestoneSync`'s
   * auto-track pass (Task 3) passes `config.milestoneSync.autoTrackAdminId`
   * instead, so auto-added milestones are attributed to the admin who
   * enabled sync, not the user whose page-load triggered the pass.
   */
  async performMilestoneImport(
    userId: string,
    integrationId: number,
    projectId: number,
    selection: {
      externalIds?: string[];
      kinds?: Array<"RELEASE" | "ITERATION">;
    },
    createdById: string = userId,
    serviceOptions: MilestoneSyncServiceOptions = {}
  ): Promise<MilestoneImportResult> {
    const db = serviceOptions.dbClient || defaultDb;
    const errors: string[] = [];
    const membershipErrors: string[] = [];
    let imported = 0;
    let updated = 0;

    try {
      const typeMap = await this._provisionMilestoneTypes(db, projectId);
      const projectKeys = await this._resolveProjectKeys(
        db,
        integrationId,
        projectId
      );
      const adapter = await this._getAdapter(integrationId, db);

      const kinds = selection.kinds ?? ["RELEASE", "ITERATION"];
      const fetched: ExternalMilestone[] = [];
      for (const kind of kinds) {
        try {
          const items = await this._fetchKindAcrossKeys(
            adapter,
            projectKeys,
            kind,
            true
          );
          fetched.push(...items);
        } catch (error: any) {
          errors.push(
            `Failed to fetch ${kind} milestones for project ${projectId}: ${error.message}`
          );
        }
      }

      const targets = selection.externalIds
        ? fetched.filter((item) => selection.externalIds!.includes(item.id))
        : fetched;

      for (const ext of targets) {
        try {
          const existing = await db.milestones.findUnique({
            where: {
              externalId_integrationId: {
                externalId: ext.id,
                integrationId,
              },
            },
            select: { id: true },
          });
          const { id: milestoneId } = await this._upsertMilestoneShell(
            db,
            integrationId,
            projectId,
            typeMap[ext.kind],
            createdById,
            ext
          );
          if (existing) {
            updated++;
          } else {
            imported++;
          }

          // First-time (and every subsequent) import links members
          // immediately (D-01) — clean skip for adapters without
          // membership support (non-Jira / DC no-op). Membership failures
          // are tracked separately from shell failures (WR-03): the shell
          // row IS imported at this point, so the caller must be able to
          // distinguish "imported but members incomplete" from "failed".
          if (adapter.getMilestoneIssues) {
            try {
              await this._reconcileMembership(
                db,
                integrationId,
                projectId,
                milestoneId,
                ext,
                adapter
              );
            } catch (error: any) {
              membershipErrors.push(
                `Membership sync failed for milestone ${ext.id} (${ext.name}): ${error.message}`
              );
            }
          }
        } catch (error: any) {
          errors.push(
            `Failed to import milestone ${ext.id} (${ext.name}): ${error.message}`
          );
        }
      }

      return {
        success: errors.length === 0,
        imported,
        updated,
        errors,
        membershipErrors,
      };
    } catch (error: any) {
      console.error(
        `Failed to import milestones for project ${projectId}:`,
        error
      );
      return {
        success: false,
        imported,
        updated,
        errors: [...errors, error.message],
        membershipErrors,
      };
    }
  }

  /**
   * The auto-track pass (D1 / MSYNC-01) — triggered from the project-level
   * "Sync now" / page-load `sync-milestones` job (17-05's `/now` route,
   * dispatched by syncWorker.ts's `sync-milestones` case, Task 4). Reads
   * `ProjectIntegration.config.milestoneSync`:
   *   - `enabled: false` → no-op (early return)
   *   - For each configured `kind`, fetches the tracker's CURRENT
   *     filter-matching artifacts (`includeClosed: false` — unreleased
   *     versions + active/future sprints, the same default import filter)
   *   - Diffs those external ids against the project's already-linked
   *     `Milestones.externalId`s for this integration
   *   - When `autoTrack` is true: imports the NEW (unseen) external ids via
   *     `performMilestoneImport`, attributed to `autoTrackAdminId` (Warning
   *     1 — NOT the triggering user, who may just be a page-load visitor)
   *   - Regardless of `autoTrack`: refreshes the already-linked milestones
   *     at the pass's freshness gate, so opening the page updates existing
   *     rows even when auto-track is off
   */
  async performProjectMilestoneSync(
    userId: string,
    integrationId: number,
    projectId: number,
    serviceOptions: MilestoneSyncServiceOptions = {}
  ): Promise<ProjectMilestoneSyncResult> {
    const db = serviceOptions.dbClient || defaultDb;
    const errors: string[] = [];
    let autoImported = 0;
    let refreshed = 0;

    try {
      const minFreshnessSeconds = serviceOptions.minFreshnessSeconds ?? 0;
      if (
        minFreshnessSeconds > 0 &&
        (await isProjectPassFresh(integrationId, projectId))
      ) {
        return {
          success: true,
          autoImported: 0,
          refreshed: 0,
          errors: [],
          cached: true,
        };
      }

      const projectIntegration = await db.projectIntegration.findUnique({
        where: { projectId_integrationId: { projectId, integrationId } },
        select: { config: true },
      });
      const milestoneSyncConfig =
        (projectIntegration?.config as any)?.milestoneSync ?? {};

      if (milestoneSyncConfig.enabled === false) {
        return { success: true, autoImported: 0, refreshed: 0, errors: [] };
      }

      const kinds: Array<"RELEASE" | "ITERATION"> =
        milestoneSyncConfig.kinds ?? ["RELEASE", "ITERATION"];
      const autoTrack = milestoneSyncConfig.autoTrack === true;
      const autoTrackAdminId: string | undefined =
        milestoneSyncConfig.autoTrackAdminId;

      const projectKeys = await this._resolveProjectKeys(
        db,
        integrationId,
        projectId
      );
      const adapter = await this._getAdapter(integrationId, db);

      // Current filter-matching artifacts (the same default import filter:
      // unreleased versions + active/future sprints), scoped to the
      // configured kinds only (kinds gating), unioned across every active
      // project-key mapping.
      const currentMatches: ExternalMilestone[] = [];
      for (const kind of kinds) {
        try {
          const items = await this._fetchKindAcrossKeys(
            adapter,
            projectKeys,
            kind,
            false
          );
          currentMatches.push(...items);
        } catch (error: any) {
          errors.push(
            `Failed to fetch ${kind} milestones for project ${projectId}: ${error.message}`
          );
        }
      }

      const linked = await db.milestones.findMany({
        where: { integrationId, projectId, externalId: { not: null } },
        select: { externalId: true, isDeleted: true },
      });
      // Deliberately includes soft-deleted (tombstoned) rows — a TPI-side
      // delete of a synced milestone means "stop tracking", so a tombstone
      // must keep counting as "linked" here or the diff below would treat
      // it as newly-appeared and auto-re-import it every pass. The refresh
      // loop below is what actually excludes tombstones from further
      // upstream writes; this diff only decides "is this externalId new".
      const linkedExternalIds = new Set(
        linked.map((row) => row.externalId as string)
      );
      const nonDeletedLinkedExternalIds = linked
        .filter((row) => !row.isDeleted)
        .map((row) => row.externalId as string);

      if (autoTrack) {
        const newIds = currentMatches
          .map((item) => item.id)
          .filter((id) => !linkedExternalIds.has(id));

        if (newIds.length > 0) {
          if (!autoTrackAdminId) {
            errors.push(
              `Cannot auto-import ${newIds.length} new milestone(s) for project ${projectId}: milestoneSync.autoTrackAdminId is not configured`
            );
          } else {
            const importResult = await this.performMilestoneImport(
              userId,
              integrationId,
              projectId,
              { externalIds: newIds, kinds },
              autoTrackAdminId,
              serviceOptions
            );
            autoImported = importResult.imported;
            errors.push(...importResult.errors);
          }
        }
      }

      // Refresh already-linked milestones regardless of autoTrack, gated by
      // the pass's freshness/lock idioms so concurrent page-loads within
      // the freshness window don't stampede the upstream API. Tombstoned
      // (soft-deleted) rows are skipped here — they stay out of any
      // automatic upstream fetch/write; only an explicit re-import through
      // the picker can resurrect one (see `_upsertMilestoneShell`).
      for (const externalId of nonDeletedLinkedExternalIds) {
        try {
          const result = await this.performMilestoneRefresh(
            userId,
            integrationId,
            externalId,
            { ...serviceOptions, projectId }
          );
          if (result.success && !result.cached && !result.locked) {
            refreshed++;
          } else if (!result.success) {
            errors.push(
              `Failed to refresh milestone ${externalId}: ${result.error}`
            );
          }
        } catch (error: any) {
          errors.push(
            `Failed to refresh milestone ${externalId}: ${error.message}`
          );
        }
      }

      // Stamp the pass regardless of trigger — a manual "Sync now" also
      // buys the passive window (matches the per-milestone lastSyncedAt
      // semantics).
      await markProjectPassFresh(
        integrationId,
        projectId,
        Math.max(minFreshnessSeconds, PROJECT_PASS_FRESHNESS_TTL_SECONDS)
      );

      return { success: true, autoImported, refreshed, errors };
    } catch (error: any) {
      console.error(
        `Failed to run project milestone sync for project ${projectId}:`,
        error
      );
      return {
        success: false,
        autoImported,
        refreshed,
        errors: [...errors, error.message],
      };
    }
  }
}

export const milestoneSyncService = new MilestoneSyncService();
