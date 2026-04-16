/**
 * audit-coverage.ts — Regenerates `.planning/audit-coverage.json`.
 *
 * Static-analysis inventory of every mutation surface in the codebase that
 * can emit an audit event:
 *
 *   1. Prisma extension hooks in `testplanit/lib/prisma.ts`
 *   2. API routes under `testplanit/app/api/**` (mutation HTTP verbs + the
 *      auth/logout GET exception)
 *   3. Server actions under `testplanit/app/actions/*.ts`
 *   4. BullMQ worker processors under `testplanit/workers/**`
 *
 * Each row carries MECHANICAL EVIDENCE flags only:
 *   - hasExtensionHook          (Prisma-hook rows: body contains an audit call)
 *   - hasExplicitAuditCall      (file contains an audit-helper or captureAuditEvent call)
 *   - hasRawWrite               (file contains $executeRaw* or direct auditLog.create)
 *   - hasIntentionalSkipMarker  (file contains the lastActiveAt-style skip block)
 *
 * The script DOES NOT assign the final Coverage verdict — it emits a
 * `defaultStatus` derived from the evidence so Plan 02 can layer human
 * judgment on top. See docs in `.planning/phases/61-audit-coverage-inventory/`.
 *
 * Determinism: `generatedAt` comes from `git log -1 --format=%cI HEAD`, items
 * are sorted by (surface, file, symbol), and the JSON is pretty-printed with
 * two-space indent plus a trailing newline — so back-to-back runs produce
 * bit-identical output.
 *
 * Usage: `pnpm audit:coverage` (from the testplanit/ directory).
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { glob } from "glob";

// ---------------------------------------------------------------------------
// Types (COPIED VERBATIM from the plan's <interfaces> block — do not drift.)
// ---------------------------------------------------------------------------

type CoverageStatus =
  | "audited (hook)"
  | "audited (explicit)"
  | "raw-write"
  | "missing"
  | "intentionally-skipped";

type Surface = "prisma-hook" | "api-route" | "server-action" | "worker";

type InventoryItem = {
  surface: Surface;
  file: string; // repo-root-relative, e.g. "testplanit/app/api/.../route.ts"
  symbol: string; // model.operation | HTTP verb | function name | "processor"
  evidence: {
    hasExtensionHook: boolean;
    hasExplicitAuditCall: boolean;
    hasRawWrite: boolean;
    hasIntentionalSkipMarker: boolean;
  };
  defaultStatus: CoverageStatus;
  rationale: string;
  lineHint?: number;
};

type InventoryOutput = {
  generatedAt: string; // ISO timestamp from HEAD commit
  generatedAgainst: "HEAD" | "working-tree";
  totals: {
    total: number;
    audited_hook: number;
    audited_explicit: number;
    raw_write: number;
    missing: number;
    intentionally_skipped: number;
  };
  items: InventoryItem[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// The script lives at testplanit/scripts/audit-coverage.ts.
// `..` goes up to testplanit/, a second `..` goes up to the repo root.
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const TESTPLANIT_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

const AUDIT_HELPER_REGEX =
  /\baudit(?:Create|Update|Delete|BulkCreate|BulkUpdate|BulkDelete|RoleChange|PermissionGrant|PermissionRevoke|AuthEvent|PasswordChange|SystemConfigChange|SsoConfigChange|DataExport)\s*\(|\bcaptureAuditEvent\s*\(/;

const RAW_WRITE_REGEX =
  /\.\$(?:executeRaw|executeRawUnsafe)\b|(?:prisma|db|tx)\.auditLog\.create\b/;

const INTENTIONAL_SKIP_REGEX =
  /Skip audit for|isLastActiveOnly|lastActiveAt[\s\S]{0,200}return query\(args\)/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getHeadTimestamp(): Promise<string> {
  try {
    const raw = execSync("git log -1 --format=%cI HEAD", {
      cwd: TESTPLANIT_DIR,
      encoding: "utf8",
    });
    return raw.trim() || "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

async function discoverFiles(): Promise<{
  routes: string[];
  actions: string[];
  workers: string[];
  prismaFile: string;
}> {
  const cwd = TESTPLANIT_DIR;

  const routes = await glob("app/api/**/route.ts", {
    cwd,
    ignore: ["app/api/auth/[...nextauth]/route.ts", "**/*.test.ts"],
  });

  const actions = await glob("app/actions/*.ts", {
    cwd,
    ignore: ["**/*.test.ts"],
  });

  const workers = await glob("workers/**/*.ts", {
    cwd,
    ignore: ["**/*.test.ts", "workers/testmoImport/**"],
  });

  return {
    routes: routes.map((p) => `testplanit/${p}`).sort(),
    actions: actions.map((p) => `testplanit/${p}`).sort(),
    workers: workers.map((p) => `testplanit/${p}`).sort(),
    prismaFile: "testplanit/lib/prisma.ts",
  };
}

// Per-surface enumeration — STUBS for Task 1. Task 2 fills these in.

async function enumeratePrismaHooks(
  _prismaFile: string
): Promise<InventoryItem[]> {
  return [];
}

async function enumerateApiRoutes(
  _routes: string[]
): Promise<InventoryItem[]> {
  return [];
}

async function enumerateServerActions(
  _actions: string[]
): Promise<InventoryItem[]> {
  return [];
}

async function enumerateWorkers(_workers: string[]): Promise<InventoryItem[]> {
  return [];
}

// ---------------------------------------------------------------------------
// Aggregation + output
// ---------------------------------------------------------------------------

function sortItems(items: InventoryItem[]): InventoryItem[] {
  return [...items].sort((a, b) => {
    if (a.surface !== b.surface) return a.surface < b.surface ? -1 : 1;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
    return 0;
  });
}

function computeTotals(items: InventoryItem[]): InventoryOutput["totals"] {
  const totals = {
    total: items.length,
    audited_hook: 0,
    audited_explicit: 0,
    raw_write: 0,
    missing: 0,
    intentionally_skipped: 0,
  };
  for (const item of items) {
    switch (item.defaultStatus) {
      case "audited (hook)":
        totals.audited_hook += 1;
        break;
      case "audited (explicit)":
        totals.audited_explicit += 1;
        break;
      case "raw-write":
        totals.raw_write += 1;
        break;
      case "missing":
        totals.missing += 1;
        break;
      case "intentionally-skipped":
        totals.intentionally_skipped += 1;
        break;
    }
  }
  return totals;
}

async function main(): Promise<void> {
  const generatedAt = await getHeadTimestamp();
  const { routes, actions, workers, prismaFile } = await discoverFiles();

  const [hookItems, routeItems, actionItems, workerItems] = await Promise.all([
    enumeratePrismaHooks(prismaFile),
    enumerateApiRoutes(routes),
    enumerateServerActions(actions),
    enumerateWorkers(workers),
  ]);

  const items = sortItems([
    ...hookItems,
    ...routeItems,
    ...actionItems,
    ...workerItems,
  ]);

  const totals = computeTotals(items);

  const expectedTotal =
    totals.audited_hook +
    totals.audited_explicit +
    totals.raw_write +
    totals.missing +
    totals.intentionally_skipped;
  if (totals.total !== expectedTotal) {
    throw new Error(
      `Invariant violation: totals.total (${totals.total}) !== sum of status counts (${expectedTotal})`
    );
  }

  const output: InventoryOutput = {
    generatedAt,
    generatedAgainst: "HEAD",
    totals,
    items,
  };

  const outputPath = path.join(REPO_ROOT, ".planning/audit-coverage.json");
  await fs.writeFile(
    outputPath,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `audit-coverage: wrote ${items.length} items to ${path.relative(
      REPO_ROOT,
      outputPath
    )}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
