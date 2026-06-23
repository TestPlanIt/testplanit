/**
 * reconcile-audit-coverage.ts — REC-01 runtime parity report.
 *
 * Proves that the CDC trigger system is a strict superset of the app-layer
 * hook system: for every (entityType, trigger-op) pair where the hooks
 * produced an AuditLog row within the reconciliation window, a CDC-sourced
 * row must also exist.
 *
 * Partition strategy:
 *   - sourceTable IS NULL     → app-hook / captureAuditEvent semantic row
 *   - sourceTable IS NOT NULL → CDC / trigger-sourced row (stamped by auditLogWorker)
 *
 * Action mapping (hooks → trigger ops):
 *   CREATE / BULK_CREATE  → I  (trigger INSERT)
 *   UPDATE / BULK_UPDATE  → U  (trigger UPDATE)
 *   DELETE / BULK_DELETE  → D  (trigger DELETE)
 *
 * Semantic-only actions (LOGIN, LOGOUT, ROLE_CHANGED, etc.) are excluded from
 * the parity check — they have no trigger equivalent by design.
 *
 * SAF-04 allowlist: ApiToken, Account, UserIntegrationAuth, SsoProvider are
 * hook-only entities whose absence from CDC is intentional. They are removed
 * from the delta calculation and never reported as missing.
 *
 * Exit codes:
 *   0 — zero delta (triggers ⊇ hooks — PARITY PROVEN)
 *   1 — crash / connection error
 *   2 — non-empty delta (hook has row, trigger does not)
 *
 * Usage:
 *   cd testplanit
 *   pnpm reconcile:coverage                     # default: last 24 hours
 *   pnpm reconcile:coverage --since 48h         # last 48 hours
 *   pnpm reconcile:coverage --since 2026-06-01T00:00:00Z  # since ISO timestamp
 *   pnpm reconcile:coverage --all               # no window (full table scan)
 */

import { Client } from "pg";

// ---------------------------------------------------------------------------
// SAF-04 allowlist — hook-only entities excluded from parity check by design
// ---------------------------------------------------------------------------

/**
 * These entityType strings match the values captureAuditEvent stamps into
 * AuditLog.entityType for each model. They are credential/token tables that
 * MUST NOT have trigger coverage (SAF-04 ruling from Phase 13 research).
 * Their hook rows have no CDC counterpart; this is intentional and correct.
 *
 * ApiToken        — contains token hash + scopes
 * Account         — OAuth account: refresh_token, access_token, id_token
 * UserIntegrationAuth — OAuth credentials (additionalData Json)
 * SsoProvider     — SAML/SSO config (config Json) — semantic-only actions anyway
 */
const SAF04_HOOK_ONLY_ENTITY_TYPES = new Set<string>([
  "ApiToken",
  "Account",
  "UserIntegrationAuth",
  "SsoProvider",
]);

// ---------------------------------------------------------------------------
// Parity-relevant actions (data mutations that triggers also capture)
// ---------------------------------------------------------------------------

/**
 * Only these AuditAction values participate in the parity check. All other
 * values (LOGIN, LOGOUT, ROLE_CHANGED, PERMISSION_GRANT, SSO_CONFIG_CHANGED,
 * SHARE_LINK_*, REVIEW_*, ITERATION_*, etc.) are semantic/app-layer-only events
 * with no trigger equivalent — they are excluded by the SQL filter, not the
 * allowlist, so they never appear in either hookPresence or cdcPresence.
 */
const PARITY_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "BULK_CREATE",
  "BULK_UPDATE",
  "BULK_DELETE",
] as const;

// ---------------------------------------------------------------------------
// --since flag parsing
// ---------------------------------------------------------------------------

const DEFAULT_SINCE_HOURS = 24;

type SinceResult = { mode: "timestamp"; since: Date } | { mode: "all" };

function parseSinceArg(argv: string[]): SinceResult {
  const allIdx = argv.indexOf("--all");
  if (allIdx !== -1) {
    return { mode: "all" };
  }

  const sinceIdx = argv.indexOf("--since");
  if (sinceIdx === -1) {
    // Default: last 24 hours
    const since = new Date(Date.now() - DEFAULT_SINCE_HOURS * 60 * 60 * 1000);
    return { mode: "timestamp", since };
  }

  const rawValue = argv[sinceIdx + 1];
  if (!rawValue || rawValue.startsWith("--")) {
    throw new Error(
      "--since requires a value: an ISO 8601 timestamp (e.g. 2026-06-01T00:00:00Z) " +
        "or a duration like 24h / 7d / 30m. Use --all to disable the window."
    );
  }

  if (rawValue === "0") {
    return { mode: "all" };
  }

  // Try duration parsing: Nh, Nd, Nm (hours, days, minutes)
  const durationMatch = /^(\d+)(h|d|m)$/i.exec(rawValue);
  if (durationMatch) {
    const amount = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2].toLowerCase();
    let ms: number;
    if (unit === "h") ms = amount * 60 * 60 * 1000;
    else if (unit === "d") ms = amount * 24 * 60 * 60 * 1000;
    else ms = amount * 60 * 1000; // 'm' = minutes
    const since = new Date(Date.now() - ms);
    return { mode: "timestamp", since };
  }

  // Try ISO 8601 timestamp
  const parsed = new Date(rawValue);
  if (isNaN(parsed.getTime())) {
    throw new Error(
      `--since value "${rawValue}" is not a valid ISO 8601 timestamp or duration (Nh/Nd/Nm). ` +
        "Examples: 2026-06-01T00:00:00Z, 24h, 7d, 30m"
    );
  }
  return { mode: "timestamp", since: parsed };
}

function printHelp(): void {
  console.log(`
reconcile-audit-coverage — REC-01 runtime parity report

Proves that the CDC trigger system is a strict superset of the app-layer hook
system by querying the live AuditLog and reporting any (entityType, op) where
a hook-sourced row exists but no CDC-sourced row does.

Usage:
  cd testplanit
  pnpm reconcile:coverage [--since <window>] [--all]

Flags:
  --since <value>   Reconciliation window. Accepts:
                    - ISO 8601 timestamp: 2026-06-01T00:00:00Z
                    - Duration: 24h (hours), 7d (days), 30m (minutes)
                    Default: ${DEFAULT_SINCE_HOURS}h (last ${DEFAULT_SINCE_HOURS} hours)
  --all             Disable window — scan the full AuditLog table
  --help            Print this help and exit

Environment:
  DIRECT_DATABASE_URL   Preferred (bypasses pgbouncer for read queries)
  DATABASE_URL          Fallback

Exit codes:
  0   Zero delta — triggers ⊇ hooks (PARITY PROVEN)
  1   Crash or connection error
  2   Non-empty delta — one or more (entityType, op) pairs have hook rows but no CDC rows
`);
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

type ParityRow = {
  entity_type: string;
  mapped_op: string;
  has_hook_row: boolean;
  has_cdc_row: boolean;
  hook_row_count: string; // pg returns bigint as string
};

/**
 * A single grouped query partitions AuditLog by sourceTable, maps action to
 * trigger op (I/U/D), filters to parity-relevant actions only, and returns one
 * row per (entityType, mapped_op) with booleans for hook presence and CDC
 * presence. The $1 parameter is the since timestamp (or null for --all mode).
 *
 * Parameterized: the only user-supplied value ($1) is bound as a query
 * parameter, never interpolated into the SQL string. All identifiers
 * (column names, table names) are static literals.
 */
const PARITY_QUERY = `
SELECT
  "entityType"                                               AS entity_type,
  CASE
    WHEN action::text IN ('CREATE', 'BULK_CREATE')  THEN 'I'
    WHEN action::text IN ('UPDATE', 'BULK_UPDATE')  THEN 'U'
    WHEN action::text IN ('DELETE', 'BULK_DELETE')  THEN 'D'
  END                                                        AS mapped_op,
  bool_or("sourceTable" IS NULL)                            AS has_hook_row,
  bool_or("sourceTable" IS NOT NULL)                        AS has_cdc_row,
  count(*) FILTER (WHERE "sourceTable" IS NULL)             AS hook_row_count
FROM "AuditLog"
WHERE action::text = ANY($2::text[])
  AND ($1::timestamptz IS NULL OR "timestamp" >= $1::timestamptz)
GROUP BY "entityType", mapped_op
HAVING bool_or("sourceTable" IS NULL)   -- only rows where hook produced at least one entry
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  // Parse --since / --all
  const sinceResult = parseSinceArg(argv);

  // Resolve DB connection
  const usingDirect = Boolean(process.env.DIRECT_DATABASE_URL);
  const connectionString =
    process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "[reconcile-audit-coverage] ERROR: No database connection configured.\n" +
        "Set DIRECT_DATABASE_URL (preferred — bypasses pgbouncer) or DATABASE_URL " +
        "before running this script."
    );
    process.exit(1);
  }

  const client = new Client({ connectionString });

  let sinceDisplay: string;
  let sinceParam: string | null;

  if (sinceResult.mode === "all") {
    sinceDisplay = "all time (no window)";
    sinceParam = null;
  } else {
    sinceDisplay = sinceResult.since.toISOString();
    sinceParam = sinceResult.since.toISOString();
  }

  console.log(
    `[reconcile-audit-coverage] Connecting via ${usingDirect ? "DIRECT_DATABASE_URL" : "DATABASE_URL"}...`
  );

  await client.connect();

  try {
    console.log(
      `[reconcile-audit-coverage] Querying AuditLog — window: ${sinceDisplay}`
    );

    const { rows } = await client.query<ParityRow>(PARITY_QUERY, [
      sinceParam,
      PARITY_ACTIONS as unknown as string[],
    ]);

    // Build presence maps
    const hookPresence = new Map<string, string>(); // key → hook_row_count
    const cdcPresence = new Set<string>();

    for (const row of rows) {
      const key = `${row.entity_type}|${row.mapped_op}`;
      if (row.has_hook_row) {
        hookPresence.set(key, row.hook_row_count);
      }
      if (row.has_cdc_row) {
        cdcPresence.add(key);
      }
    }

    // Compute delta: hook pairs not covered by CDC and not allowlisted
    type DeltaRow = { entityType: string; op: string; hookRowCount: string };
    const delta: DeltaRow[] = [];
    const allowlistedCount = new Map<string, number>();

    for (const [key, hookRowCount] of hookPresence.entries()) {
      const [entityType, op] = key.split("|");

      if (SAF04_HOOK_ONLY_ENTITY_TYPES.has(entityType)) {
        // Allowlisted — intentionally hook-only, not a delta
        allowlistedCount.set(
          entityType,
          (allowlistedCount.get(entityType) ?? 0) + 1
        );
        continue;
      }

      if (!cdcPresence.has(key)) {
        delta.push({ entityType, op, hookRowCount });
      }
    }

    // Report
    const totalChecked = hookPresence.size;
    const cdcCoveredCount = [...hookPresence.keys()].filter(
      (k) =>
        cdcPresence.has(k) && !SAF04_HOOK_ONLY_ENTITY_TYPES.has(k.split("|")[0])
    ).length;
    const allowlistedTotal = [...allowlistedCount.values()].reduce(
      (sum, n) => sum + n,
      0
    );

    console.log("");
    console.log("=== reconcile-audit-coverage report ===");
    console.log(`Window:              ${sinceDisplay}`);
    console.log(`(entityType, op) pairs checked: ${totalChecked}`);
    console.log(`  CDC-covered:       ${cdcCoveredCount}`);
    console.log(`  Allowlisted (SAF-04 hook-only): ${allowlistedTotal}`);
    console.log(`  Delta (gap):       ${delta.length}`);
    console.log("");

    if (allowlistedCount.size > 0) {
      console.log("SAF-04 allowlisted entities (hook-only by design):");
      for (const [entityType, count] of [
        ...allowlistedCount.entries(),
      ].sort()) {
        console.log(`  ${entityType} — ${count} op(s) skipped`);
      }
      console.log("");
    }

    if (delta.length === 0) {
      console.log("PARITY PROVEN: triggers ⊇ hooks (0 hook-only deltas)");
      console.log("");
      process.exit(0);
    }

    // Print delta table
    console.error(
      `PARITY GAP DETECTED: ${delta.length} (entityType, op) pair(s) have hook rows but no CDC rows:`
    );
    console.error("");
    const col1 = Math.max(
      "entityType".length,
      ...delta.map((r) => r.entityType.length)
    );
    const header = "entityType".padEnd(col1) + "  op  hookRows";
    console.error(header);
    console.error("-".repeat(header.length));
    for (const row of delta.sort(
      (a, b) =>
        a.entityType.localeCompare(b.entityType) || a.op.localeCompare(b.op)
    )) {
      console.error(
        row.entityType.padEnd(col1) +
          "  " +
          row.op.padEnd(3) +
          " " +
          row.hookRowCount
      );
    }
    console.error("");
    console.error(
      "Run `pnpm triggers:apply` against the spike DB and re-exercise the " +
        "affected entities to generate CDC rows, then re-run this report."
    );
    console.error("");

    process.exit(2);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[reconcile-audit-coverage] Unexpected error:", err);
  process.exit(1);
});
