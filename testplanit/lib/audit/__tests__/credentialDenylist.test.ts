/**
 * Phase 15 Plan 02 — Credential-denylist gate (RED until 15-04 apply gate).
 *
 * Proves that a write to a credential-bearing table (Integration) NEVER leaks the
 * `credentials` column into DataChangeLog. The trigger's per-table denylist (set by
 * the registry entry's `denylist: ["createdAt", "updatedAt", "credentials"]`) must
 * strip `credentials` before the diff is captured.
 *
 * Goes GREEN after the 15-04 apply gate installs the 68-entry registry onto the spike DB.
 * Until then the Integration trigger does not exist and the test correctly shows no
 * DataChangeLog row (the trigger is absent, so no row is written — which vacuously satisfies
 * the "credentials not in changed_cols" invariant; the real proof is after 15-04 when both
 * the trigger fires AND credentials is absent).
 *
 * Gating: copies the Phase 13 spike pattern EXACTLY — skips cleanly (no DB connection attempted)
 * when RUN_DB_INTEGRATION is unset, so the unit lane stays green.
 *
 * Run (GREEN after 15-04 apply gate):
 *   RUN_DB_INTEGRATION=1 \
 *   DIRECT_DATABASE_URL="postgresql://user:password@localhost:55432/spike" \
 *   DATABASE_URL="postgresql://user:password@localhost:56432/spike" \
 *   pnpm exec vitest run --config vitest.config.mts lib/audit/__tests__/credentialDenylist.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DIRECT_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeDb = RUN_INTEGRATION && HAS_DB ? describe : describe.skip;

const ctx = (o: Record<string, string>) => JSON.stringify(o);

describeDb(
  "credentialDenylist — Integration.credentials never reaches DataChangeLog (SAF-02 / COV-04)",
  () => {
    let direct: import("pg").Client;

    const MARKER = `creddeny-${Date.now()}`;
    const createdIntegrationIds: number[] = [];

    beforeAll(async () => {
      const { Client } = await import(/* @vite-ignore */ "pg");
      direct = new Client({ connectionString: DIRECT_URL });
      await direct.connect();

      // Drop Integration's outgoing FK constraints so a minimal fixture row inserts without a
      // full parent graph (disposable-spike-DB pattern from Phase 12/13). The audit trigger
      // fires regardless of referential integrity; dropping FKs does NOT affect the denylist
      // assertion — it only lets the INSERT produce a real id for the trigger to capture.
      await direct.query(`DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT conrelid::regclass::text AS tbl, conname
            FROM pg_constraint
           WHERE contype = 'f'
             AND conrelid = '"Integration"'::regclass
        LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname); END LOOP;
      END $$;`);
    }, 60_000);

    afterAll(async () => {
      if (direct) {
        try {
          if (createdIntegrationIds.length) {
            await direct.query(`DELETE FROM "Integration" WHERE id = ANY($1)`, [
              createdIntegrationIds,
            ]);
          }
        } catch {
          /* best effort */
        }
        await direct.end();
      }
    });

    it("INSERT into Integration with credentials → DataChangeLog row EXISTS, changed_cols OMITS credentials (SAF-02)", async () => {
      const creds = JSON.stringify({
        api_key: `${MARKER}-secret-key`,
        token: "should-never-appear",
      });
      const name = `${MARKER}-integration`;

      await direct.query("BEGIN");
      await direct.query("SELECT set_config('app.audit_context', $1, true)", [
        ctx({ userId: "credtest-actor" }),
      ]);
      const ins = await direct.query(
        `INSERT INTO "Integration" (name, provider, "authType", credentials, status, "updatedAt")
         VALUES ($1, 'JIRA', 'API_KEY', $2::jsonb, 'INACTIVE', now())
         RETURNING id`,
        [name, creds]
      );
      await direct.query("COMMIT");
      const integrationId: number = ins.rows[0].id;
      createdIntegrationIds.push(integrationId);

      const r = await direct.query(
        `SELECT changed_cols FROM "DataChangeLog"
        WHERE "table" = 'Integration' AND op = 'I' AND pk = $1
        ORDER BY id DESC LIMIT 1`,
        [String(integrationId)]
      );

      // The trigger must have fired and produced a row (proves the trigger is active and
      // a non-credential column was captured — i.e., the row was not wholesale dropped).
      expect(r.rows).toHaveLength(1);
      const captured = r.rows[0].changed_cols ?? {};

      // SAF-02: the credentials column must NEVER appear in the captured diff.
      expect("credentials" in captured).toBe(false);

      // Sanity: a non-credential column (name) IS present in the diff, proving the row
      // was written for a real capture (not short-circuited by the no-op guard).
      expect("name" in captured).toBe(true);
      expect(captured.name?.new).toBe(name);
    });

    it("UPDATE of Integration changing credentials alongside name → changed_cols OMITS credentials, INCLUDES name (SAF-02)", async () => {
      // Insert a fixture row to update.
      const nameOriginal = `${MARKER}-upd-integration`;
      const credsOriginal = JSON.stringify({
        api_key: `${MARKER}-original-secret`,
      });

      await direct.query("BEGIN");
      await direct.query("SELECT set_config('app.audit_context', $1, true)", [
        ctx({ userId: "credtest-actor-insert" }),
      ]);
      const ins = await direct.query(
        `INSERT INTO "Integration" (name, provider, "authType", credentials, status, "updatedAt")
         VALUES ($1, 'GITHUB', 'PERSONAL_ACCESS_TOKEN', $2::jsonb, 'INACTIVE', now())
         RETURNING id`,
        [nameOriginal, credsOriginal]
      );
      await direct.query("COMMIT");
      const integrationId: number = ins.rows[0].id;
      createdIntegrationIds.push(integrationId);

      // Now UPDATE both credentials and name in the same statement.
      const nameUpdated = `${MARKER}-upd-integration-changed`;
      const credsUpdated = JSON.stringify({
        api_key: `${MARKER}-new-secret`,
        token: "still-should-not-appear",
      });

      await direct.query("BEGIN");
      await direct.query("SELECT set_config('app.audit_context', $1, true)", [
        ctx({ userId: "credtest-actor-update" }),
      ]);
      await direct.query(
        `UPDATE "Integration" SET name = $1, credentials = $2::jsonb WHERE id = $3`,
        [nameUpdated, credsUpdated, integrationId]
      );
      await direct.query("COMMIT");

      const r = await direct.query(
        `SELECT changed_cols FROM "DataChangeLog"
        WHERE "table" = 'Integration' AND op = 'U' AND pk = $1
        ORDER BY id DESC LIMIT 1`,
        [String(integrationId)]
      );

      // The trigger must have produced a U row (proves the trigger captured the UPDATE).
      expect(r.rows).toHaveLength(1);
      const captured = r.rows[0].changed_cols ?? {};

      // SAF-02: credentials must not appear even when it changed alongside an audited column.
      expect("credentials" in captured).toBe(false);

      // The captured non-credential column (name) IS present and reflects the change.
      expect("name" in captured).toBe(true);
      expect(captured.name?.new).toBe(nameUpdated);
      expect(captured.name?.old).toBe(nameOriginal);
    });
  }
);
