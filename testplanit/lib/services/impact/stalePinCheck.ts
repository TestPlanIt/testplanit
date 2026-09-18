import type { GitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import {
  classifyPinAtTip,
  PinAnchorError,
  readFileForAnchor,
  type CodePinKind,
  type PinStaleReason,
} from "./codePins";
import { resolveRefToSha } from "./compareService";
import { loadRepoConfigForWorker, type LoadedRepoConfig } from "./repoAccess";
import { MANAGED_PIN_SOURCES } from "./stalePinRules";

export { MANAGED_PIN_SOURCES, removableStalePinsWhere } from "./stalePinRules";

export const STALE_PIN_REASONS: readonly PinStaleReason[] = [
  "FILE_DELETED",
  "SNIPPET_NOT_FOUND",
  "SYMBOL_NOT_FOUND",
];

/** Pin ids per updateMany; keeps each statement's IN list bounded. */
const UPDATE_BATCH = 500;
/** Files read between two progress writes on the config. */
const PROGRESS_EVERY_FILES = 25;
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_MS = 60_000;

export interface StalePinCheckReport {
  checkedAt: string;
  checkedSha: string;
  /** Live pins on the connection when the check ran. */
  pins: number;
  /** Pins evaluated; the rest sit in files the provider would not serve. */
  checked: number;
  /** Flagged pins the cleanup removes: not dismissed, not repository-managed. */
  stale: number;
  /** Flagged pins whose badge the user dismissed on the case page. */
  dismissed: number;
  /** Flagged pins that repository markers own; the marker scan maintains those. */
  managed: number;
  unreadableFiles: number;
  byReason: Record<PinStaleReason, number>;
}

export interface StalePinCheckProgress {
  running: true;
  startedAt: string;
  progressAt: string;
  checkedFiles: number;
  totalFiles: number;
  pins: number;
}

export type StalePinCheckOutcome =
  StalePinCheckReport | { error: string; checkedAt: string };

export interface StalePinCheckOptions {
  /** Wait between rate-limit retries; tests shorten it. */
  retryDelayMs?: number;
  now?: () => Date;
}

interface PinRow {
  id: number;
  kind: CodePinKind;
  filePath: string;
  startLine: number | null;
  symbol: string | null;
  anchorSha: string | null;
  anchorSnippet: string | null;
  source: string;
  staleDismissedAt: Date | string | null;
}

type StalePinDb = {
  projectCodeRepositoryConfig: {
    findFirst: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
  };
  repositoryCaseCodePin: {
    findMany: (args: any) => Promise<any[]>;
    updateMany: (args: any) => Promise<any>;
  };
};

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("rate limit") || msg.includes("429");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function storeReport(
  db: StalePinDb,
  configId: number,
  report: unknown
): Promise<void> {
  try {
    await db.projectCodeRepositoryConfig.update({
      where: { id: configId },
      data: { stalePinReport: report },
    });
  } catch (err) {
    console.warn(
      `[stalePinCheck] Failed to store stale pin report for config ${configId}:`,
      err
    );
  }
}

/**
 * One file at the tip: its lines, `null` when the provider says it is gone,
 * or `undefined` when it could not be read (too large, provider error, or a
 * rate limit that outlasted the retries).
 */
async function readTipFile(
  config: LoadedRepoConfig,
  adapter: GitRepoAdapter,
  path: string,
  tipSha: string,
  retryDelayMs: number
): Promise<string[] | null | undefined> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readFileForAnchor(config, adapter, path, tipSha);
    } catch (error) {
      if (error instanceof PinAnchorError) return null;
      if (isRateLimitError(error) && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(retryDelayMs);
        continue;
      }
      return undefined;
    }
  }
}

/**
 * Evaluate every live pin of one Impact connection against the branch tip
 * and record the verdict on each pin (`staleCheckedAt`, `staleReason`).
 * Pins already anchored at the tip, and GLOB pins, are fresh without a
 * read; each other file is read once, from the file cache when the
 * connection has one. Progress and the final summary go to the config's
 * `stalePinReport`, which the settings page polls.
 */
export async function checkStalePins(
  configId: number,
  db: StalePinDb,
  opts: StalePinCheckOptions = {}
): Promise<StalePinCheckOutcome> {
  const now = opts.now ?? (() => new Date());
  const retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_MS;
  const startedAt = now().toISOString();
  try {
    const loaded = await loadRepoConfigForWorker(db, configId, {
      purpose: "IMPACT",
    });
    if (!loaded) {
      throw new Error(`Impact connection ${configId} not found`);
    }
    const { config, adapter } = loaded;

    const pins = (await db.repositoryCaseCodePin.findMany({
      where: { configId, isDeleted: false },
      select: {
        id: true,
        kind: true,
        filePath: true,
        startLine: true,
        symbol: true,
        anchorSha: true,
        anchorSnippet: true,
        source: true,
        staleDismissedAt: true,
      },
    })) as PinRow[];

    const ref = config.branch ?? (await adapter.getDefaultBranch());
    const tipSha = await resolveRefToSha(adapter, ref);

    const byPath = new Map<string, PinRow[]>();
    const freshIds: number[] = [];
    for (const pin of pins) {
      if (pin.kind === "GLOB" || pin.anchorSha === tipSha) {
        freshIds.push(pin.id);
        continue;
      }
      const list = byPath.get(pin.filePath);
      if (list) list.push(pin);
      else byPath.set(pin.filePath, [pin]);
    }

    const progress: StalePinCheckProgress = {
      running: true,
      startedAt,
      progressAt: startedAt,
      checkedFiles: 0,
      totalFiles: byPath.size,
      pins: pins.length,
    };
    await storeReport(db, configId, { ...progress });

    const staleIds: Record<PinStaleReason, number[]> = {
      FILE_DELETED: [],
      SNIPPET_NOT_FOUND: [],
      SYMBOL_NOT_FOUND: [],
    };
    const flagged: PinRow[] = [];
    let unreadableFiles = 0;
    let unchecked = 0;

    for (const [path, pathPins] of byPath) {
      const lines = await readTipFile(
        config,
        adapter,
        path,
        tipSha,
        retryDelayMs
      );
      if (lines === undefined) {
        unreadableFiles++;
        unchecked += pathPins.length;
      } else {
        for (const pin of pathPins) {
          const verdict = classifyPinAtTip(pin, lines);
          if (verdict.stale) {
            staleIds[verdict.staleReason].push(pin.id);
            flagged.push(pin);
          } else {
            freshIds.push(pin.id);
          }
        }
      }
      progress.checkedFiles++;
      if (progress.checkedFiles % PROGRESS_EVERY_FILES === 0) {
        progress.progressAt = now().toISOString();
        await storeReport(db, configId, { ...progress });
      }
    }

    const checkedAt = now();
    for (const batch of chunk(freshIds, UPDATE_BATCH)) {
      await db.repositoryCaseCodePin.updateMany({
        where: { id: { in: batch } },
        data: { staleCheckedAt: checkedAt, staleReason: null },
      });
    }
    for (const reason of STALE_PIN_REASONS) {
      for (const batch of chunk(staleIds[reason], UPDATE_BATCH)) {
        await db.repositoryCaseCodePin.updateMany({
          where: { id: { in: batch } },
          data: { staleCheckedAt: checkedAt, staleReason: reason },
        });
      }
    }

    const managedSources: ReadonlySet<string> = new Set(MANAGED_PIN_SOURCES);
    let stale = 0;
    let dismissed = 0;
    let managed = 0;
    for (const pin of flagged) {
      if (pin.staleDismissedAt != null) dismissed++;
      else if (managedSources.has(pin.source)) managed++;
      else stale++;
    }

    const report: StalePinCheckReport = {
      checkedAt: checkedAt.toISOString(),
      checkedSha: tipSha,
      pins: pins.length,
      checked: pins.length - unchecked,
      stale,
      dismissed,
      managed,
      unreadableFiles,
      byReason: {
        FILE_DELETED: staleIds.FILE_DELETED.length,
        SNIPPET_NOT_FOUND: staleIds.SNIPPET_NOT_FOUND.length,
        SYMBOL_NOT_FOUND: staleIds.SYMBOL_NOT_FOUND.length,
      },
    };
    await storeReport(db, configId, report);
    return report;
  } catch (err) {
    const report = {
      error:
        err instanceof Error ? err.message : "Unknown error during stale check",
      checkedAt: now().toISOString(),
    };
    await storeReport(db, configId, report);
    return report;
  }
}
