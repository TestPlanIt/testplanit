/**
 * Phase 13 — Trigger drift + idempotent apply (CAP-02, CAP-03, CAP-04 spirit).
 *
 * After running scripts/apply-triggers.ts, the live `tpl_audit_%` trigger count equals the
 * registry length, computed with count(DISTINCT trigger_name) — information_schema.triggers
 * returns ONE ROW PER EVENT, so an I/U/D trigger appears as 3 rows; DISTINCT collapses them
 * to one (Pitfall B / 12-SPIKE-FINDINGS Finding A).
 *
 *   - CAP-03: live count == TRIGGER_REGISTRY.length (expected count comes from the real
 *             registry, never a hardcoded number).
 *   - CAP-02: a second apply is idempotent — the count is unchanged and the script exits 0.
 *   - CAP-04 (drift detection): dropping one trigger makes the live count fall below the
 *             registry length, proving the drift assertion would FAIL if a `prisma db push`
 *             silently removed a trigger (Pitfall E); a re-apply then restores it.
 *
 * Gating: copies the Phase 12 spike pattern EXACTLY — skips cleanly (no DB connection, no apply)
 * when RUN_DB_INTEGRATION is unset, so the unit lane stays green. The live assertion runs in 13-06.
 *
 * Run (GREEN against the spike DB):
 *   RUN_DB_INTEGRATION=1 \
 *   DIRECT_DATABASE_URL="postgresql://user:password@localhost:55432/spike" \
 *   DATABASE_URL="postgresql://user:password@localhost:56432/spike" \
 *   pnpm exec vitest run --config vitest.config.mts lib/audit/__tests__/triggerDrift.test.ts
 */
import { execSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TRIGGER_REGISTRY } from "~/scripts/trigger-registry";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DIRECT_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeDb = RUN_INTEGRATION && HAS_DB ? describe : describe.skip;

/** tpl_audit_<lowercased table, non-alphanumeric → _>. Must match apply-triggers.ts triggerNameFor. */
const triggerNameFor = (table: string): string =>
  "tpl_audit_" + table.toLowerCase().replace(/[^a-z0-9]/g, "_");

describeDb(
  "triggerDrift — idempotent apply + drift via count(DISTINCT trigger_name) (CAP-02, CAP-03, CAP-04)",
  () => {
    let direct: import("pg").Client;

    // Drift query — MUST use DISTINCT (Pitfall B): one row per (trigger × event), so count(*) would
    // triple-count an I/U/D trigger and false-pass when a trigger is missing.
    const liveTriggerCount = async (): Promise<number> => {
      const r = await direct.query(
        `SELECT count(DISTINCT trigger_name)::int AS n
           FROM information_schema.triggers
          WHERE trigger_name LIKE 'tpl_audit_%'`,
      );
      return r.rows[0].n as number;
    };

    // Idempotent re-apply script (CAP-04/CAP-05 mechanism). Uses DIRECT_DATABASE_URL because DDL must
    // bypass any pooler. stdio:pipe so a non-zero exit throws (asserts exit 0).
    const applyTriggers = () =>
      execSync("pnpm exec tsx scripts/apply-triggers.ts", {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: DIRECT_URL,
          pnpm_config_verify_deps_before_run: "false",
        },
        stdio: "pipe",
      });

    beforeAll(async () => {
      const { Client } = await import("pg");
      direct = new Client({ connectionString: DIRECT_URL });
      await direct.connect();
    }, 60_000);

    afterAll(async () => {
      if (direct) await direct.end();
    });

    it("apply installs one trigger per registry entry (count via DISTINCT trigger_name) — CAP-03", async () => {
      applyTriggers();
      const count = await liveTriggerCount();
      expect(count).toBe(TRIGGER_REGISTRY.length);
    });

    it("a second apply is idempotent: trigger count unchanged, script exits 0 — CAP-02", async () => {
      const before = await liveTriggerCount();
      // execSync throws on non-zero exit, so reaching the next line proves exit 0.
      expect(() => applyTriggers()).not.toThrow();
      const after = await liveTriggerCount();
      expect(after).toBe(before);
      expect(after).toBe(TRIGGER_REGISTRY.length);
    });

    it("dropping one trigger makes the live count fall below the registry — drift detection (CAP-04)", async () => {
      applyTriggers();
      expect(await liveTriggerCount()).toBe(TRIGGER_REGISTRY.length);

      // Simulate a `prisma db push` that silently dropped a trigger (Pitfall E). Identifier comes
      // only from the static in-repo registry — no user input in this DDL.
      const dropped = TRIGGER_REGISTRY[0];
      const droppedTrigger = triggerNameFor(dropped.table);
      await direct.query(
        `DROP TRIGGER IF EXISTS ${droppedTrigger} ON "${dropped.table}";`,
      );

      // The drift assertion would now FAIL: live count is short by exactly the dropped trigger.
      expect(await liveTriggerCount()).toBe(TRIGGER_REGISTRY.length - 1);

      // A re-apply restores the dropped trigger (CAP-04/CAP-05 self-healing on the next push).
      applyTriggers();
      expect(await liveTriggerCount()).toBe(TRIGGER_REGISTRY.length);
    });
  },
);
