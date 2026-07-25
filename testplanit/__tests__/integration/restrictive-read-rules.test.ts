// Regression guard for the Phase 1 over-collapse.
//
// WebhookConfig / WebhookOutboxEvent / AuditLog / ShareLink / ReviewRequest have
// deliberately RESTRICTIVE read rules — a plain project member must NOT read
// them just because they can read the project's ordinary data. The Phase 1
// AuthCtx sweep briefly collapsed these to `projectId in accessibleProjectIds`,
// which grants read to any project member (including via project-default
// access) — a cross-project leak of webhook secrets etc. It was reverted; this
// test fails if the fast-path collapse is ever reintroduced.
//
// Setup: a GLOBAL_ROLE-default project (so a plain USER with a global role gets
// access through the default branch, NOT an explicit grant), a plain member who
// is neither creator nor PROJECTADMIN, a run, and a webhook config. The member
// must SEE the run (proves they hold project access via accessibleProjectIds)
// but NOT the webhook config (proves the restrictive rule still gates it).
//
// Run via:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test restrictive-read-rules --run

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { WorkflowScope } from "~/zenstack/models";

import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `rrr-${Date.now()}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;
async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

interface Fixture {
  projectId: number;
  runId: number;
  webhookConfigId: string;
  plainMember: AuthUser; // default-GLOBAL_ROLE access, not creator/PROJECTADMIN
}
let fixture: Fixture | null = null;

async function setupFixture(): Promise<Fixture> {
  const userRole = await db.roles.findFirst({ where: { name: "user" } });
  if (!userRole) throw new Error("Dev DB missing seeded `user` role.");
  const runWorkflow = await db.workflows.findFirst({
    where: { scope: WorkflowScope.RUNS, isDeleted: false, isEnabled: true },
  });
  if (!runWorkflow)
    throw new Error("Dev DB missing RUNS-scoped Workflows row.");

  const creator = await db.user.create({
    data: {
      email: `${TAG}-creator@example.test`,
      name: `${TAG} creator`,
      access: "USER",
      roleId: userRole.id,
    },
  });
  const plain = await db.user.create({
    data: {
      email: `${TAG}-plain@example.test`,
      name: `${TAG} plain`,
      access: "USER",
      roleId: userRole.id,
    },
  });

  // GLOBAL_ROLE default: every active user with a global role gets project
  // access without any explicit grant — the widest ordinary-member path.
  const project = await db.projects.create({
    data: {
      name: `${TAG}-project`,
      createdBy: creator.id,
      defaultAccessType: "GLOBAL_ROLE",
      defaultRoleId: null,
    },
  });

  const run = await db.testRuns.create({
    data: {
      projectId: project.id,
      name: `${TAG}-run`,
      stateId: runWorkflow.id,
      createdById: creator.id,
    },
  });
  const webhook = await db.webhookConfig.create({
    data: {
      projectId: project.id,
      token: `${TAG}-token`,
      adapterType: "GENERIC_HMAC",
      direction: "OUTBOUND",
      secret: "s3cr3t",
      name: `${TAG}-hook`,
    },
  });

  return {
    projectId: project.id,
    runId: run.id,
    webhookConfigId: webhook.id,
    plainMember: await fetchAuthUser(plain.id),
  };
}

async function cleanup(f: Fixture | null) {
  if (!f) return;
  const safe = async (op: () => Promise<unknown>) => {
    try {
      await op();
    } catch {
      /* best-effort */
    }
  };
  await safe(() =>
    db.webhookConfig.deleteMany({ where: { token: { startsWith: TAG } } })
  );
  await safe(() =>
    db.testRuns.updateMany({
      where: { name: { startsWith: TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.projects.updateMany({
      where: { name: { startsWith: TAG } },
      data: { isDeleted: true },
    })
  );
  await safe(() =>
    db.user.updateMany({
      where: { email: { startsWith: TAG } },
      data: { isDeleted: true, isActive: false },
    })
  );
}

beforeAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  fixture = await setupFixture();
}, 30_000);
afterAll(async () => {
  if (!RUN_INTEGRATION || !HAS_DB_URL) return;
  await cleanup(fixture);
  await db.$disconnect();
}, 30_000);

describeIntegration(
  "restrictive read rules are not widened by accessibleProjectIds",
  () => {
    it("a plain member CAN read ordinary project data (has project access)", async () => {
      const enhanced = await getAuthDb(fixture!.plainMember);
      const run = await enhanced.testRuns.findUnique({
        where: { id: fixture!.runId },
      });
      expect(run).not.toBeNull();
    });

    it("the same plain member CANNOT read the project's webhook config (restrictive rule holds)", async () => {
      const enhanced = await getAuthDb(fixture!.plainMember);
      const cfg = await enhanced.webhookConfig.findUnique({
        where: { id: fixture!.webhookConfigId },
      });
      expect(cfg).toBeNull();
      const many = await enhanced.webhookConfig.findMany({
        where: { projectId: fixture!.projectId },
      });
      expect(many.map((c) => c.id)).not.toContain(fixture!.webhookConfigId);
    });
  }
);
