// Live-DB proof that the generic audit trigger honours the WebhookConfig
// column denylist declared in scripts/trigger-registry.ts (SAF-02/SAF-04).
//
// Two distinct guarantees share one registry entry, and only a real Postgres
// trigger can show either of them:
//
//  1. CREDENTIALS NEVER LAND. `token` and `secret` are denylisted, so no
//     DataChangeLog row — insert or update — may carry them in its
//     `changed_cols` diff, in the before value or the after value. An
//     assertion on the key alone would pass against a trigger that kept the
//     old value under a different key, so this suite also greps the whole
//     serialized payload for the literal secret material.
//
//  2. TELEMETRY-ONLY WRITES PRODUCE NO ROW. The `last*At` timestamps and
//     `consecutiveFailureCount` are machine-written delivery telemetry bumped
//     on every receipt/dispatch. They are denylisted so a pure heartbeat bump
//     diffs to `{}` and the trigger's no-op short-circuit drops the row
//     entirely — otherwise a busy outbound endpoint would bury the audit log.
//     The fixture updates the row for real (and reads the new values back), so
//     "no new row" means the trigger short-circuited, not that nothing changed.
//
// The unit-lane siblings (lib/audit/__tests__/denylist.test.ts,
// credentialDenylist.test.ts) prove the same trigger behaviour on a disposable
// spike DB by DROPPING foreign keys. This suite runs against a seeded scratch
// database instead and builds a real project → WebhookConfig graph, so no
// constraint is ever weakened on a database other agents are sharing.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`):
//   DATABASE_URL="<scratch tpi_* url>" RUN_DB_INTEGRATION=1 pnpm exec vitest \
//     run __tests__/integration/webhook-config-denylist.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `wcd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** The registry's WebhookConfig denylist, minus the two default timestamps —
 * the columns this suite asserts can never reach the audit log. */
const DENYLISTED_COLUMNS = [
  "token",
  "secret",
  "lastReceivedAt",
  "lastDispatchedAt",
  "lastSuccessAt",
  "lastFailureAt",
  "consecutiveFailureCount",
] as const;

type ChangeLogRow = {
  id: string;
  op: string;
  changed_cols: Record<string, { old: unknown; new: unknown }> | null;
};

describeIntegration("WebhookConfig audit denylist (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let webhookConfigId: string;

  const ORIGINAL_TOKEN = `${STAMP}-token-original`;
  const ORIGINAL_SECRET = `${STAMP}-secret-original`;
  const ROTATED_TOKEN = `${STAMP}-token-rotated`;
  const ROTATED_SECRET = `${STAMP}-secret-rotated`;

  /** Every audit row this WebhookConfig has ever produced, oldest first. The
   * pk filter is the fixture's own cuid, so concurrent suites on the same
   * scratch database cannot perturb the count. */
  const changeLogRows = () =>
    db.$queryRaw<ChangeLogRow[]>`
      SELECT id::text AS id, op, changed_cols
        FROM "DataChangeLog"
       WHERE "table" = 'WebhookConfig' AND pk = ${webhookConfigId}
       ORDER BY id ASC
    `;

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (!dbName.startsWith("tpi_")) {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against a tpi_* scratch DB, never \`ew\``
      );
    }

    // The trigger must actually be attached, or every assertion below would
    // pass vacuously against a database that simply audits nothing.
    const [{ count }] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
        FROM information_schema.triggers
       WHERE event_object_table = 'WebhookConfig'
         AND trigger_name = 'tpl_audit_webhookconfig'
    `;
    if (Number(count) === 0) {
      throw new Error(
        "Test prerequisite: tpl_audit_webhookconfig is not attached — run scripts/apply-triggers.ts against this database"
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Webhook Denylist Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await db.projects.create({
      data: { name: `${STAMP}-project`, createdBy: adminUserId },
      select: { id: true },
    });
    projectId = project.id;

    const config = await db.webhookConfig.create({
      data: {
        projectId,
        adapterType: "GENERIC_HMAC",
        direction: "OUTBOUND",
        token: ORIGINAL_TOKEN,
        secret: ORIGINAL_SECRET,
        name: `${STAMP}-hook`,
        url: "https://example.invalid/hooks/denylist",
      },
      select: { id: true },
    });
    webhookConfigId = config.id;
  });

  afterAll(async () => {
    // DataChangeLog rows are deliberately NOT cleaned up: the append-only
    // enforcement triggers reject DELETE of unprocessed rows, which is the
    // point of that substrate. The fixture rows themselves go.
    if (webhookConfigId) {
      await db.webhookConfig.deleteMany({ where: { id: webhookConfigId } });
    }
    if (projectId) await db.projects.deleteMany({ where: { id: projectId } });
    if (adminUserId) await db.user.deleteMany({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("captures the insert but never the token or secret", async () => {
    const rows = await changeLogRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].op).toBe("I");

    const captured = rows[0].changed_cols ?? {};
    // The row IS audited — projectId/name/url are all there — so the
    // absences below are the denylist, not a missing trigger.
    expect(Object.keys(captured)).toEqual(
      expect.arrayContaining(["projectId", "name", "url"])
    );
    for (const column of DENYLISTED_COLUMNS) {
      expect(column in captured).toBe(false);
    }
    expect(JSON.stringify(captured)).not.toContain(ORIGINAL_TOKEN);
    expect(JSON.stringify(captured)).not.toContain(ORIGINAL_SECRET);
  });

  it("a delivery-telemetry-only update writes no audit row at all", async () => {
    const before = await changeLogRows();

    const dispatchedAt = new Date("2026-02-03T04:05:06.000Z");
    await db.webhookConfig.update({
      where: { id: webhookConfigId },
      data: {
        lastReceivedAt: dispatchedAt,
        lastDispatchedAt: dispatchedAt,
        lastSuccessAt: dispatchedAt,
        lastFailureAt: dispatchedAt,
        consecutiveFailureCount: 7,
      },
    });

    // The write really landed — so "no new row" below is the trigger's no-op
    // short-circuit on an all-denylisted diff, not an update that never ran.
    const stored = await db.webhookConfig.findUniqueOrThrow({
      where: { id: webhookConfigId },
      select: { lastDispatchedAt: true, consecutiveFailureCount: true },
    });
    expect(stored.consecutiveFailureCount).toBe(7);
    expect(stored.lastDispatchedAt?.toISOString()).toBe(
      dispatchedAt.toISOString()
    );

    const after = await changeLogRows();
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
  });

  it("a credential rotation alongside a real edit audits the edit and drops the credentials", async () => {
    const before = await changeLogRows();

    await db.webhookConfig.update({
      where: { id: webhookConfigId },
      data: {
        token: ROTATED_TOKEN,
        secret: ROTATED_SECRET,
        // A non-denylisted column changes in the SAME statement, so the
        // diff is non-empty and the row survives the no-op short-circuit —
        // this is the case where a leak would actually be visible.
        name: `${STAMP}-hook-renamed`,
        endpointHealth: "DEGRADED",
      },
    });

    const after = await changeLogRows();
    expect(after).toHaveLength(before.length + 1);
    const row = after[after.length - 1];
    expect(row.op).toBe("U");

    const captured = row.changed_cols ?? {};
    expect(captured.name).toEqual({
      old: `${STAMP}-hook`,
      new: `${STAMP}-hook-renamed`,
    });
    expect(captured.endpointHealth).toEqual({
      old: "HEALTHY",
      new: "DEGRADED",
    });

    for (const column of DENYLISTED_COLUMNS) {
      expect(column in captured).toBe(false);
    }
    // Neither the retired nor the new credential appears anywhere in the
    // payload — not as a key, not as `old`, not as `new`.
    const serialized = JSON.stringify(captured);
    for (const value of [
      ORIGINAL_TOKEN,
      ORIGINAL_SECRET,
      ROTATED_TOKEN,
      ROTATED_SECRET,
    ]) {
      expect(serialized).not.toContain(value);
    }

    // And the rotation really happened, so the absence above is the
    // denylist rather than an update Postgres discarded.
    const stored = await db.webhookConfig.findUniqueOrThrow({
      where: { id: webhookConfigId },
      select: { token: true, secret: true },
    });
    expect(stored.token).toBe(ROTATED_TOKEN);
    expect(stored.secret).toBe(ROTATED_SECRET);
  });
});
