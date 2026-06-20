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

type HookParityEntry = {
  model: string;
  hasCreate: boolean;
  hasUpdate: boolean;
  hasDelete: boolean;
  missingOperations: string[]; // e.g. ["update"] for attachment
  isExempt: boolean; // true if `Audit parity exempt` comment found inside the model block
  exemptRationale: string | null; // extracted from the comment, or null
};

type HookParityReport = {
  totalModels: number;
  fullParity: number;
  exempt: number;
  undocumentedAsymmetries: HookParityEntry[];
  entries: HookParityEntry[];
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
  hookParity: HookParityReport;
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
    }).trim();
    if (!raw) {
      throw new Error("git log returned empty output");
    }
    return raw;
  } catch (err) {
    throw new Error(
      `audit-coverage: failed to resolve HEAD commit timestamp: ${
        (err as Error).message
      }`
    );
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

// ---------------------------------------------------------------------------
// Per-surface enumeration
// ---------------------------------------------------------------------------

/**
 * Parse `testplanit/lib/prisma.ts` and emit one row per
 * `{model, operation}` pair declared inside the `$extends({ query: ... })`
 * block.
 *
 * Model-block headers are at exactly 6 leading spaces (the single
 * `query: { ... }` object nesting level). Operation method signatures are at
 * exactly 8 leading spaces. The matching closing brace at 8 spaces
 * terminates the method body.
 */
async function enumeratePrismaHooks(
  prismaFile: string
): Promise<InventoryItem[]> {
  const absPath = path.join(REPO_ROOT, prismaFile);
  const content = await fs.readFile(absPath, "utf8");
  const lines = content.split("\n");

  const items: InventoryItem[] = [];

  const modelHeaderRegex = /^ {6}(\w+):\s*\{\s*$/;
  const opHeaderRegex =
    /^ {8}async (create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/;
  const methodEndRegex = /^ {8}\},?\s*$/;
  const modelEndRegex = /^ {6}\},?\s*$/;

  let i = 0;
  while (i < lines.length) {
    const modelMatch = lines[i].match(modelHeaderRegex);
    if (!modelMatch) {
      i += 1;
      continue;
    }

    const modelName = modelMatch[1];
    // Scan through this model's body until we hit a 6-space `}` or EOF.
    let j = i + 1;
    while (j < lines.length) {
      if (modelEndRegex.test(lines[j])) {
        break;
      }

      const opMatch = lines[j].match(opHeaderRegex);
      if (!opMatch) {
        j += 1;
        continue;
      }

      const operation = opMatch[1];
      const opStartLine = j;
      // Find the matching end brace at exactly 8 spaces (same indent).
      let k = j + 1;
      while (k < lines.length) {
        if (methodEndRegex.test(lines[k])) {
          break;
        }
        k += 1;
      }

      // Method body is [opStartLine+1, k-1] inclusive; include header line
      // too so signature/argument comments are considered part of the body.
      const body = lines.slice(opStartLine, k + 1).join("\n");

      const hasExtensionHook = AUDIT_HELPER_REGEX.test(body);
      const hasRawWrite = RAW_WRITE_REGEX.test(body);
      const hasIntentionalSkipMarker = INTENTIONAL_SKIP_REGEX.test(body);

      let defaultStatus: CoverageStatus;
      if (hasExtensionHook) {
        defaultStatus = "audited (hook)";
      } else if (hasIntentionalSkipMarker) {
        defaultStatus = "intentionally-skipped";
      } else {
        defaultStatus = "missing";
      }

      items.push({
        surface: "prisma-hook",
        file: prismaFile,
        symbol: `${modelName}.${operation}`,
        evidence: {
          hasExtensionHook,
          hasExplicitAuditCall: false,
          hasRawWrite,
          hasIntentionalSkipMarker,
        },
        defaultStatus,
        rationale: "",
        lineHint: opStartLine + 1,
      });

      j = k + 1;
    }

    // Advance outer index past the model block.
    i = j + 1;
  }

  return items;
}

/**
 * Group hook inventory items by model and report 3-op (create/update/delete)
 * parity. Intentional asymmetries are detected via the `Audit parity exempt`
 * comment inside (or immediately above) the model block. Returns a structured
 * report; the main function uses this to decide the exit code.
 *
 * Parity scope: only `create`/`update`/`delete` are counted. Bulk ops
 * (`createMany`/`updateMany`/`deleteMany`) and `upsert` are out of scope per
 * the 3-op triad is the parity baseline.
 */
async function checkHookParity(
  hookItems: InventoryItem[],
  prismaFile: string
): Promise<HookParityReport> {
  const absPath = path.join(REPO_ROOT, prismaFile);
  const content = await fs.readFile(absPath, "utf8");
  const lines = content.split("\n");

  // Build per-model op sets from the already-enumerated hook items.
  const byModel = new Map<string, Set<string>>();
  for (const item of hookItems) {
    const [model, op] = item.symbol.split(".");
    if (!model || !op) continue;
    if (!byModel.has(model)) byModel.set(model, new Set());
    byModel.get(model)!.add(op);
  }

  // Use the same 6-space-indent model-header regex as enumeratePrismaHooks
  // so the two functions agree on what a "model block" is.
  const modelHeaderRegex = /^ {6}(\w+):\s*\{\s*$/;
  const modelEndRegex = /^ {6}\},?\s*$/;
  const exemptByModel = new Map<string, string | null>(); // rationale or null

  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(modelHeaderRegex);
    if (!m) {
      i += 1;
      continue;
    }
    const model = m[1];
    // Search up to 10 lines ABOVE the model header for a leading comment block
    // (covers the "comment-above-model-opener" placement pattern).
    const leadStart = Math.max(0, i - 10);
    const lead = lines.slice(leadStart, i).join("\n");
    // Search inside the block body up to the matching 6-space `}`.
    let j = i + 1;
    while (j < lines.length && !modelEndRegex.test(lines[j])) j += 1;
    const body = lines.slice(i, j + 1).join("\n");
    const searchText = lead + "\n" + body;
    if (/Audit parity exempt/.test(searchText)) {
      // Extract the rationale line for forensic reporting.
      const matchLine = searchText
        .split("\n")
        .find((l) => /Audit parity exempt/.test(l));
      exemptByModel.set(model, matchLine?.trim().replace(/^\/\/\s*/, "") ?? "");
    } else {
      exemptByModel.set(model, null);
    }
    i = j + 1;
  }

  const entries: HookParityEntry[] = [];
  for (const [model, ops] of byModel.entries()) {
    const hasCreate = ops.has("create");
    const hasUpdate = ops.has("update");
    const hasDelete = ops.has("delete");
    const missingOperations: string[] = [];
    if (!hasCreate) missingOperations.push("create");
    if (!hasUpdate) missingOperations.push("update");
    if (!hasDelete) missingOperations.push("delete");
    const exemptRationale = exemptByModel.get(model) ?? null;
    const isExempt = exemptRationale !== null;
    entries.push({
      model,
      hasCreate,
      hasUpdate,
      hasDelete,
      missingOperations,
      isExempt,
      exemptRationale,
    });
  }

  entries.sort((a, b) => a.model.localeCompare(b.model));

  const undocumentedAsymmetries = entries.filter(
    (e) => e.missingOperations.length > 0 && !e.isExempt
  );

  return {
    totalModels: entries.length,
    fullParity: entries.filter((e) => e.missingOperations.length === 0).length,
    exempt: entries.filter((e) => e.isExempt && e.missingOperations.length > 0)
      .length,
    undocumentedAsymmetries,
    entries,
  };
}

/**
 * Classify an API route or server-action file's evidence into a default
 * coverage status. The hook-vs-explicit refinement is Plan 02's job; this
 * helper applies the mechanical default.
 *
 * `hasRawWrite` is an INDEPENDENT audit-emission signal: a file that directly
 * calls `prisma.auditLog.create(...)` or `$executeRaw` is itself emitting
 * audits, just not via the sanctioned helper. The `raw-write` status exists
 * precisely to flag "emits audits, but not via the sanctioned helper" cases,
 * so it fires whenever `hasRawWrite` is true — regardless of whether the file
 * ALSO calls an audit helper.
 */
function classifyFileEvidence(
  hasExplicitAuditCall: boolean,
  hasRawWrite: boolean
): CoverageStatus {
  if (hasExplicitAuditCall && hasRawWrite) return "raw-write";
  if (hasExplicitAuditCall) return "audited (explicit)";
  if (hasRawWrite) return "raw-write";
  return "missing";
}

/**
 * Emit one row per `(file, mutation-verb)` pair under `app/api/**`. GET is
 * included only when the file itself contains an audit-helper call (covers
 * `app/api/auth/logout/route.ts`). The ZenStack gateway at
 * `app/api/model/[...path]/route.ts` uses an `export { handler as GET, ... }`
 * re-export block — the regex detects both `export (async )?(function|const)`
 * and the brace-re-export form.
 */
async function enumerateApiRoutes(routes: string[]): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];
  const mutationVerbs = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  const directExportRegex =
    /^export (?:async )?(?:const|function) (GET|POST|PUT|PATCH|DELETE)\b/gm;
  const reExportRegex =
    /\bhandler as (GET|POST|PUT|PATCH|DELETE)\b|\b(\w+) as (GET|POST|PUT|PATCH|DELETE)\b/g;

  for (const routeRepoPath of routes) {
    const absPath = path.join(REPO_ROOT, routeRepoPath);
    const content = await fs.readFile(absPath, "utf8");

    const hasExplicitAuditCall = AUDIT_HELPER_REGEX.test(content);
    const hasRawWrite = RAW_WRITE_REGEX.test(content);
    const hasIntentionalSkipMarker = INTENTIONAL_SKIP_REGEX.test(content);

    // Track verbs and their first-match line number.
    const verbLine = new Map<string, number>();

    let m: RegExpExecArray | null;
    directExportRegex.lastIndex = 0;
    while ((m = directExportRegex.exec(content)) !== null) {
      const verb = m[1];
      const line = content.slice(0, m.index).split("\n").length;
      if (!verbLine.has(verb)) verbLine.set(verb, line);
    }

    reExportRegex.lastIndex = 0;
    while ((m = reExportRegex.exec(content)) !== null) {
      const verb = m[1] || m[3];
      if (!verb) continue;
      const line = content.slice(0, m.index).split("\n").length;
      if (!verbLine.has(verb)) verbLine.set(verb, line);
    }

    for (const [verb, line] of verbLine.entries()) {
      const include =
        mutationVerbs.has(verb) || (verb === "GET" && hasExplicitAuditCall);
      if (!include) continue;

      items.push({
        surface: "api-route",
        file: routeRepoPath,
        symbol: verb,
        evidence: {
          hasExtensionHook: false,
          hasExplicitAuditCall,
          hasRawWrite,
          hasIntentionalSkipMarker,
        },
        defaultStatus: classifyFileEvidence(hasExplicitAuditCall, hasRawWrite),
        rationale: "",
        lineHint: line,
      });
    }
  }

  return items;
}

/**
 * Emit one row per exported function in a server-action file (files that
 * begin with the `"use server"` directive). Evidence is file-level per
 * RESEARCH §1C — Plan 02 refines per-function when a file mixes audited and
 * unaudited functions.
 */
async function enumerateServerActions(
  actions: string[]
): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];

  const useServerRegex = /^\s*["']use server["']\s*;?\s*$/m;
  const exportFnRegex = /^export (?:async )?function (\w+)\b/gm;

  for (const actionRepoPath of actions) {
    const absPath = path.join(REPO_ROOT, actionRepoPath);
    const content = await fs.readFile(absPath, "utf8");

    if (!useServerRegex.test(content)) continue;

    const hasExplicitAuditCall = AUDIT_HELPER_REGEX.test(content);
    const hasRawWrite = RAW_WRITE_REGEX.test(content);
    const hasIntentionalSkipMarker = INTENTIONAL_SKIP_REGEX.test(content);

    exportFnRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = exportFnRegex.exec(content)) !== null) {
      const fnName = m[1];
      const line = content.slice(0, m.index).split("\n").length;

      items.push({
        surface: "server-action",
        file: actionRepoPath,
        symbol: fnName,
        evidence: {
          hasExtensionHook: false,
          hasExplicitAuditCall,
          hasRawWrite,
          hasIntentionalSkipMarker,
        },
        defaultStatus: classifyFileEvidence(hasExplicitAuditCall, hasRawWrite),
        rationale: "",
        lineHint: line,
      });
    }
  }

  return items;
}

/**
 * Emit one row per worker file that looks like a BullMQ processor (has a
 * `new Worker(` binding or a `processor` export/identifier, or an inline
 * `async (job` lambda). `workers/auditLogWorker.ts` is hard-excluded because
 * it's the audit consumer — not a surface that needs to emit audits.
 */
async function enumerateWorkers(workers: string[]): Promise<InventoryItem[]> {
  const items: InventoryItem[] = [];
  const processorEvidenceRegex =
    /\bnew Worker\s*\(|\bexport (?:const|function) processor\b|\bconst processor\s*=|async \(job\s*:/;
  const hardExcludedFiles = new Set<string>([
    "testplanit/workers/auditLogWorker.ts",
  ]);

  for (const workerRepoPath of workers) {
    if (hardExcludedFiles.has(workerRepoPath)) continue;

    const absPath = path.join(REPO_ROOT, workerRepoPath);
    const content = await fs.readFile(absPath, "utf8");

    if (!processorEvidenceRegex.test(content)) continue;

    const hasExplicitAuditCall = AUDIT_HELPER_REGEX.test(content);
    const hasRawWrite = RAW_WRITE_REGEX.test(content);
    const hasIntentionalSkipMarker = INTENTIONAL_SKIP_REGEX.test(content);

    items.push({
      surface: "worker",
      file: workerRepoPath,
      symbol: "processor",
      evidence: {
        hasExtensionHook: false,
        hasExplicitAuditCall,
        hasRawWrite,
        hasIntentionalSkipMarker,
      },
      defaultStatus: classifyFileEvidence(hasExplicitAuditCall, hasRawWrite),
      rationale: "",
      lineHint: 1,
    });
  }

  return items;
}

/**
 * Emit a one-line warning if the known pre-Phase-62 fix target has unstaged
 * edits. The inventory must be generated against committed HEAD (RESEARCH §4);
 * the warning signals to the operator to stash or commit before running.
 */
function warnIfBaselineDirty(): void {
  try {
    const out = execSync("git status --porcelain testplanit/lib/prisma.ts", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (out.trim().length > 0) {
      console.warn(
        "audit-coverage: WARNING — baseline files have unstaged changes; inventory reflects working tree, not committed HEAD. Stash or commit before generating the baseline."
      );
    }
  } catch {
    // `git status` failed (e.g. not a git repo) — skip the check silently.
  }
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

/**
 * Pre-populate the rationale for the lastActiveAt skip precedent — the ONLY
 * row the script populates. All other rationales are authored in the
 * markdown (Plan 02 Task 2) and synced back into the JSON in a one-time
 * pass (Plan 02 Task 3). This override runs BEFORE totals are computed so
 * the counts block reflects the status change.
 *
 * The rationale copies the comment-block text from `testplanit/lib/prisma.ts`
 * lines 688–701 verbatim — matching the precedent wording so future audits
 * see the same phrasing on both sides of the trust boundary.
 */
function applyLastActiveAtSkipOverride(items: InventoryItem[]): void {
  const row = items.find(
    (i) => i.surface === "prisma-hook" && i.symbol === "user.update"
  );
  if (!row) return;
  if (!row.evidence.hasIntentionalSkipMarker) return;
  row.defaultStatus = "intentionally-skipped";
  row.rationale =
    "Skip audit for session keep-alive writes (throttled lastActiveAt pings from the session callback). Auditing these produces a log entry every 5 minutes per active user with no security value.";
}

/**
 * Emit the counts-block text that the human-readable AUDIT-COVERAGE.md
 * embeds verbatim. Uses the middle-dot character U+00B7 as the separator;
 * the markdown Totals section pastes this line into a fenced code block.
 * One line, trailing newline, no other content — see Plan 02 <interfaces>.
 */
async function writeCountsBlock(
  totals: InventoryOutput["totals"]
): Promise<string> {
  const line = `Total: ${totals.total} · audited (hook): ${totals.audited_hook} · audited (explicit): ${totals.audited_explicit} · raw-write: ${totals.raw_write} · missing: ${totals.missing} · intentionally-skipped: ${totals.intentionally_skipped}`;
  const outputPath = path.join(
    REPO_ROOT,
    ".planning/audit-coverage-counts.txt"
  );
  await fs.writeFile(outputPath, line + "\n", "utf8");
  return outputPath;
}

async function main(): Promise<void> {
  warnIfBaselineDirty();
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

  // Compute the hook-parity report from the raw hookItems (before the
  // lastActiveAt override downgrades user.update to intentionally-skipped;
  // parity counts the hook's existence, not its verdict).
  const hookParity = await checkHookParity(hookItems, prismaFile);

  // Move the lastActiveAt row from `audited (hook)` to `intentionally-skipped`
  // and populate its rationale BEFORE computing totals so the counts block
  // reflects the final status distribution.
  applyLastActiveAtSkipOverride(items);

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
    hookParity,
  };

  const outputPath = path.join(REPO_ROOT, ".planning/audit-coverage.json");
  await fs.writeFile(
    outputPath,
    JSON.stringify(output, null, 2) + "\n",
    "utf8"
  );

  const countsPath = await writeCountsBlock(totals);

  console.log(
    `audit-coverage: wrote ${items.length} items to ${path.relative(
      REPO_ROOT,
      outputPath
    )}`
  );
  console.log(
    `audit-coverage: wrote counts-block to ${path.relative(
      REPO_ROOT,
      countsPath
    )}`
  );
  console.log(
    `audit-coverage: hook parity — ${hookParity.fullParity}/${hookParity.totalModels} models at full CRUD parity, ${hookParity.exempt} documented exemptions, ${hookParity.undocumentedAsymmetries.length} undocumented`
  );

  if (hookParity.undocumentedAsymmetries.length > 0) {
    console.error(
      "audit-coverage: FAIL — undocumented hook parity asymmetries detected:"
    );
    for (const a of hookParity.undocumentedAsymmetries) {
      console.error(
        `  - ${a.model}: missing ${a.missingOperations.join(", ")} (no \`Audit parity exempt\` comment found in model block)`
      );
    }
    process.exit(2); // Distinct non-zero for parity failure (vs. code 1 for crash)
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
