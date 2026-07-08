import { rawDb as defaultDb } from "@/lib/rawDb";
import type { DbClient } from "~/lib/zenstack";
import valkeyConnection from "../../valkey";
import type { ExternalMilestone, IssueAdapter } from "../adapters/IssueAdapter";
import { integrationManager } from "../IntegrationManager";

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
}

export interface MilestoneRefreshResult {
  success: boolean;
  cached?: boolean;
  locked?: boolean;
  error?: string;
}

export interface MilestoneImportResult {
  success: boolean;
  imported: number;
  updated: number;
  errors: string[];
}

export interface ProjectMilestoneSyncResult {
  success: boolean;
  autoImported: number;
  refreshed: number;
  errors: string[];
}

/**
 * Per-entity Redis lock for milestone sync — DISTINCT namespace from the
 * issue-sync lock in SyncService.ts (lines 97-127) so an externalId that
 * happens to collide between an issue and a milestone never cross-locks.
 */
const MILESTONE_SYNC_LOCK_TTL_SECONDS = 60;

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
  return {
    name: ext.name,
    note: tiptapFromPlainText(ext.description),
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
    inner: () => Promise<{ success: boolean; error?: string }>
  ): Promise<MilestoneRefreshResult> {
    const db = serviceOptions.dbClient || defaultDb;
    const minFreshnessSeconds = serviceOptions.minFreshnessSeconds ?? 0;
    try {
      if (minFreshnessSeconds > 0) {
        const stored = await db.milestones.findFirst({
          where: { integrationId, externalId },
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
    const existing = await db.milestones.findUnique({
      where: {
        externalId_integrationId: {
          externalId: ext.id,
          integrationId,
        },
      },
      select: { id: true },
    });

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
      },
    });

    return { id: row.id, created: !existing };
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
  ): Promise<{ success: boolean; error?: string }> {
    const db = serviceOptions.dbClient || defaultDb;
    try {
      const existing = await db.milestones.findFirst({
        where: { integrationId, externalId },
        select: { id: true, projectId: true, milestoneTypesId: true },
      });
      if (!existing) {
        throw new Error(
          `Cannot refresh milestone ${externalId}: no linked Milestones row for integration ${integrationId}`
        );
      }

      const integrationProject = await db.integrationProject.findFirst({
        where: {
          projectIntegration: { integrationId, projectId: existing.projectId },
          isActive: true,
        },
        select: { externalProjectKey: true },
      });
      if (!integrationProject) {
        throw new Error(
          `Cannot refresh milestone ${externalId}: no active IntegrationProject mapping for project ${existing.projectId}`
        );
      }

      const adapter = await this._getAdapter(integrationId, db);
      const { items } = await adapter.getExternalMilestones!({
        projectKey: integrationProject.externalProjectKey,
        includeClosed: true,
      });
      const match = items.find((item) => item.id === externalId);
      if (!match) {
        throw new Error(
          `Milestone ${externalId} no longer present upstream for project ${existing.projectId}`
        );
      }

      await this._upsertMilestoneShell(
        db,
        integrationId,
        existing.projectId,
        existing.milestoneTypesId,
        userId,
        match
      );

      return { success: true };
    } catch (error: any) {
      console.error(`Failed to refresh milestone ${externalId}:`, error);
      return { success: false, error: error.message };
    }
  }
}

export const milestoneSyncService = new MilestoneSyncService();
