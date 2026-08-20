// Live-DB integration scaffold for PROV-04 — synced parentId resolution and
// the cycle-guard trigger interaction on the real sync write path.
//
// Two plans convert these todos, in order:
//   - 22-02 converts todos 1-5 (the inline best-effort resolve-on-sync
//     write, the cross-project/cycle-rejection cases, and the
//     isRequirement classification write).
//   - 22-05 converts todo 6 (the end-of-import re-resolution pass —
//     completing the hierarchy within one import run when a child is
//     imported before its parent).
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-sync-parentid.integration.test.ts

import { beforeAll, describe, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `sp-${Date.now()}`;

describeIntegration("SyncService synced parentId (live DB)", () => {
  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the
    // worktree .env DATABASE_URL resolves to `ew`, and this suite writes
    // real rows through the live cycle-guard trigger.
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }
  });

  it.todo("links a synced child to its parent row against the live database");
  it.todo("does not link a parent that lives in a different project");
  it.todo(
    "clears a previously linked parent when the tracker stops reporting one"
  );
  it.todo("a cyclic tracker parent is rejected by the live cycle-guard trigger");
  it.todo("sets isRequirement from the project's stored requirements config");
  it.todo(
    "completes the hierarchy within one import run when a child is imported before its parent"
  );
});

// STAMP retained for the converting plans' fixture-row prefixing
// convention (mirrors requirement-subtree-delete.integration.test.ts's
// STAMP usage) — referenced here only to keep the constant from being
// flagged unused until 22-02 starts creating fixture rows with it.
void STAMP;
