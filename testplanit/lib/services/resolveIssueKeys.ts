import { baseDb } from "~/lib/db";
import { ISSUE_TRACKING_PROVIDERS } from "~/lib/integrations/issueTrackerProviders";
import { syncService } from "~/lib/integrations/services/SyncService";

/**
 * Resolve tracker issue keys ("PROJ-123") to local `Issue` rows, creating the
 * row from the tracker when it isn't here yet.
 *
 * Until this existed the only code path that turned a key into an `Issue` row
 * was the web UI: the search dialog reads the ticket from the tracker, then
 * hands the resolved `externalId` + title + url to `/api/integrations/jira/
 * link-issue`. Every programmatic caller could only link a row a human had
 * already materialized that way, so an agent or a migration had to have
 * someone open each distinct ticket in the browser first.
 *
 * ## Why this resolves against the tracker instead of writing a thin shell
 *
 * The dedup key is `@@unique([externalId, integrationId])`, and `externalId`
 * is the tracker's *internal* id — for Jira the numeric one, not the key. A
 * shell row carrying only `externalKey` would therefore NOT collide with the
 * row the UI writes for the same ticket, and the first UI link would create a
 * second row for it. Learning the real `externalId` is the whole reason the
 * upstream fetch is not optional.
 *
 * ## Why `performIssueRefreshSystem`
 *
 * That fetch-and-upsert already exists for inbound webhooks, which are the
 * other caller with no user session: it resolves the adapter from the
 * integration's own credentials, upserts on `(externalId, integrationId)`,
 * and carries the freshness gate and per-issue lock that stop a batch of
 * cases citing one ticket from pulling the tracker once per case. Calling it
 * with `createIfMissing` gives a row indistinguishable from the UI's, and
 * from a later sync's — no second field-mapping to drift.
 *
 * Failures are per key. A batch of fifty cases where two cite a typo'd key
 * imports forty-eight and reports two, rather than failing whole.
 */

/** Upstream fetches one call may trigger. Local hits don't count against it. */
export const DEFAULT_MAX_ISSUE_KEY_LOOKUPS = 100;

export interface IssueKeyResolution {
  /** The key as the caller supplied it, before trimming. */
  key: string;
  issueId?: number;
  /** True when this call materialized the row rather than finding it. */
  created?: boolean;
  /** Set instead of `issueId` when this key could not be resolved. */
  error?: string;
}

export interface ResolveIssueKeysOptions {
  projectId: number;
  keys: string[];
  /**
   * Integration to resolve against. Optional: when the project has exactly one
   * active issue-tracker integration that one is used, which is the shape
   * every linking surface in the UI already assumes
   * (`projectIntegration.findMany({ isActive: true })[0]`).
   */
  integrationId?: number;
  maxLookups?: number;
}

/** Thrown for conditions that doom every key, not just one. */
export class IssueKeyResolutionError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "IssueKeyResolutionError";
    this.status = status;
  }
}

interface ResolvedIntegration {
  integrationId: number;
  provider: string;
}

/**
 * Pick the integration to resolve against, and prove it belongs to this
 * project. The project scope is the security boundary: without it a caller
 * holding a token for project A could name project B's integration and make
 * this service read B's tracker with B's credentials.
 */
export async function resolveIssueTrackerIntegration(
  projectId: number,
  integrationId?: number
): Promise<ResolvedIntegration> {
  const mappings = await baseDb.projectIntegration.findMany({
    where: {
      projectId,
      isActive: true,
      ...(integrationId != null ? { integrationId } : {}),
      integration: { provider: { in: ISSUE_TRACKING_PROVIDERS } },
    },
    select: {
      integrationId: true,
      integration: { select: { provider: true } },
    },
    orderBy: { integrationId: "asc" },
  });

  if (mappings.length === 0) {
    throw new IssueKeyResolutionError(
      integrationId != null
        ? `Integration ${integrationId} is not an active issue-tracker integration on project ${projectId}.`
        : `Project ${projectId} has no active issue-tracker integration to resolve issue keys against.`,
      400
    );
  }
  if (mappings.length > 1) {
    throw new IssueKeyResolutionError(
      `Project ${projectId} has ${mappings.length} active issue-tracker integrations ` +
        `(${mappings.map((m) => m.integrationId).join(", ")}). Pass integrationId to choose one.`,
      400
    );
  }

  return {
    integrationId: mappings[0].integrationId,
    provider: mappings[0].integration?.provider ?? "",
  };
}

/** A row already here for this key, under either external column. */
async function findLocalIssue(
  integrationId: number,
  projectId: number,
  key: string
): Promise<number | null> {
  const row = await baseDb.issue.findFirst({
    where: {
      integrationId,
      projectId,
      isDeleted: false,
      OR: [{ externalKey: key }, { externalId: key }],
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Resolve every key to an `Issue.id`, keyed by the caller's original string.
 *
 * Keys are deduplicated before any upstream call, so N cases citing one ticket
 * cost one lookup. Blank entries resolve to an error rather than being dropped
 * — silently dropping them is the behaviour this replaces.
 */
export async function resolveIssueKeys({
  projectId,
  keys,
  integrationId,
  maxLookups = DEFAULT_MAX_ISSUE_KEY_LOOKUPS,
}: ResolveIssueKeysOptions): Promise<Map<string, IssueKeyResolution>> {
  const results = new Map<string, IssueKeyResolution>();
  if (keys.length === 0) return results;

  // Trimmed form → the original strings that produced it, so one lookup can
  // answer every spelling the caller used.
  const byTrimmed = new Map<string, string[]>();
  for (const key of keys) {
    const trimmed = typeof key === "string" ? key.trim() : "";
    if (!trimmed) {
      results.set(key, { key, error: "Issue key is empty." });
      continue;
    }
    const aliases = byTrimmed.get(trimmed) ?? [];
    aliases.push(key);
    byTrimmed.set(trimmed, aliases);
  }
  if (byTrimmed.size === 0) return results;

  const resolved = await resolveIssueTrackerIntegration(
    projectId,
    integrationId
  );

  let lookups = 0;
  for (const [trimmed, aliases] of byTrimmed) {
    const record = (resolution: Omit<IssueKeyResolution, "key">) => {
      for (const alias of aliases) {
        results.set(alias, { key: alias, ...resolution });
      }
    };

    const local = await findLocalIssue(
      resolved.integrationId,
      projectId,
      trimmed
    );
    if (local != null) {
      record({ issueId: local });
      continue;
    }

    if (lookups >= maxLookups) {
      record({
        error: `Not resolved: this request already made ${maxLookups} tracker lookups. Split the batch or link this issue separately.`,
      });
      continue;
    }
    lookups++;

    // `createIfMissing` is what turns a refresh into a resolve: without it
    // the sync path throws "must be created through the UI first", which is
    // the exact limitation this service exists to remove.
    const refresh = await syncService.performIssueRefreshSystem(
      resolved.integrationId,
      trimmed,
      { createIfMissing: { projectId } }
    );

    if (!refresh.success) {
      record({
        error:
          refresh.error ??
          `Could not resolve '${trimmed}' from the ${resolved.provider} integration.`,
      });
      continue;
    }

    // Re-read rather than trusting the refresh's own bookkeeping: the upsert
    // stores the tracker's canonical key, which may differ in case from what
    // the caller typed, and a `locked` result means another request wrote the
    // row instead of this one.
    const created = await findLocalIssue(
      resolved.integrationId,
      projectId,
      trimmed
    );
    if (created != null) {
      record({ issueId: created, created: true });
      continue;
    }

    if (refresh.locked) {
      record({
        error: `'${trimmed}' is being synced by another request; retry shortly.`,
      });
      continue;
    }

    // The sync path matches an existing row on `(integrationId, key)` alone,
    // so a row this integration already holds for another project takes the
    // update branch and `createIfMissing` never fires. Name that, rather than
    // reporting a write that didn't happen.
    const elsewhere = await baseDb.issue.findFirst({
      where: {
        integrationId: resolved.integrationId,
        isDeleted: false,
        OR: [{ externalKey: trimmed }, { externalId: trimmed }],
      },
      select: { projectId: true },
    });
    record({
      error:
        elsewhere && elsewhere.projectId !== projectId
          ? `'${trimmed}' is already tracked by project ${elsewhere.projectId} on this integration and cannot be linked from project ${projectId}.`
          : `'${trimmed}' resolved upstream but no local issue was written for project ${projectId}.`,
    });
  }

  return results;
}
