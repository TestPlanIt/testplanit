// @vitest-environment node
/**
 * Phase 1 — Live-DB integration tests for ReviewRequest schema invariants.
 *
 * This is the project's FIRST live-DB Vitest integration test. It establishes
 * the pattern that Phase 2's enhanced-db E2E tests should mirror:
 *
 *   1. Per-file `// @vitest-environment node` directive — keeps Prisma off jsdom.
 *   2. TEST_RUN_ID namespacing — every fixture row carries the same suffix so
 *      `afterAll` can identify and soft-delete only this run's rows; re-runs
 *      against a polluted DB are safe.
 *   3. Soft-delete cleanup (`isDeleted: true`) — never hard-delete; matches the
 *      milestone-wide soft-delete-only rule from PROJECT.md / MEMORY.md.
 *   4. Mixed client usage:
 *        - Raw `prisma` for seeding (system context, bypasses @@validate /
 *          @@allow / @@deny — appropriate for fixture setup).
 *        - Enhanced db via `getEnhancedDb(session)` for assertions that must
 *          hit the policy engine (@@validate XOR / self-approval; @@deny
 *          append-only update).
 *        - Raw `prisma` for the partial-unique-index race assertion — the
 *          PostgreSQL constraint fires at the DB regardless of client.
 *        - Raw `prisma` for the consumedAt carve-out — matches the gate
 *          helper's documented system-context path (D-05).
 *
 * Coverage map (VALIDATION.md):
 *   - #3  XOR assignee @@validate            — describe("ReviewRequest XOR assignee ...")
 *   - #4  Self-approval @@validate           — describe("ReviewRequest self-approval ...")
 *   - #5  Append-only @@deny                 — describe("ReviewRequest append-only ...")
 *   - #16 Partial unique index race          — describe("ReviewRequest partial unique index ...")
 *
 * Test-selector substrings (for VALIDATION.md `-t` selectors):
 *   - "XOR assignee"
 *   - "self-approval"
 *   - "append-only"
 *   - "partial unique index"
 *
 * Prerequisites:
 *   - A real PostgreSQL reachable via DATABASE_URL.
 *   - `pnpm tsx prisma/setup-extensions.ts` has been run at least once so
 *     `review_request_one_pending_per_entity` is installed. The `beforeAll`
 *     probe asserts the index exists and fails loudly otherwise — preventing
 *     #16 from passing for the wrong reason.
 *
 * Run:
 *   cd testplanit && pnpm test --run lib/services/schemaValidation.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import { prisma } from "~/lib/prisma";
import { getEnhancedDb } from "~/lib/auth/utils";
import { isAlreadyPendingError } from "~/lib/utils/errors";

// Namespace every fixture row with a stable per-run suffix so afterAll can
// scope its soft-deletes to this run only (and so concurrent runs against the
// same DB never collide). String suffix because Projects.name is `@unique`.
const TEST_RUN_ID = `phase1-schema-validation-${Date.now()}-${Math.floor(
  Math.random() * 1_000_000,
)}`;

// Synthetic polymorphic entityIds — never need to FK-resolve (D-14 polymorphic
// pair). Different per describe block so partial-unique-index tests don't
// collide with append-only tests on the same (entityType, entityId) key.
const ENTITY_ID_PARTIAL_UNIQUE = 999_999_801;
const ENTITY_ID_PARTIAL_UNIQUE_AFTER_SOFT_DELETE = 999_999_802;
const ENTITY_ID_APPEND_ONLY = 999_999_803;
const ENTITY_ID_XOR_VALID = 999_999_804;

// Fixture IDs populated in beforeAll.
let projectId: number;
let requesterUserId: string;
let assigneeUserId: string;
let fromStateId: number;
let toStateId: number;

// IDs of ReviewRequest rows created during tests — soft-deleted in afterAll.
const createdReviewRequestIds: string[] = [];

beforeAll(async () => {
  // 1. Confirm the partial unique index is present. If setup-extensions.ts
  //    has not been run, the #16 race test would silently pass for the wrong
  //    reason (both inserts would succeed). Fail loudly here instead.
  const indexes = await prisma.$queryRawUnsafe<
    Array<{ indexname: string }>
  >(
    `SELECT indexname FROM pg_indexes WHERE indexname = 'review_request_one_pending_per_entity'`,
  );
  if (indexes.length === 0) {
    throw new Error(
      "Partial unique index review_request_one_pending_per_entity not present on the test DB. " +
        "Run `pnpm tsx prisma/setup-extensions.ts` before this test suite.",
    );
  }

  // 2. Reuse seeded FieldIcon / Color / Roles — every dev/test DB has these.
  const fieldIcon = await prisma.fieldIcon.findFirst({ select: { id: true } });
  const color = await prisma.color.findFirst({ select: { id: true } });
  const role = await prisma.roles.findFirst({
    where: { isDeleted: false },
    select: { id: true },
  });
  if (!fieldIcon || !color || !role) {
    throw new Error(
      "Missing seed data: FieldIcon / Color / Roles must be seeded before this test suite (run `pnpm prisma db seed`).",
    );
  }

  // 3. Seed two users (requester + assignee). Both are ADMIN so they always
  //    satisfy the @@allow('create') / @@allow('read') policies — the @@validate
  //    rules under test fire *before* policy checks. Using two distinct users
  //    keeps the self-approval test (#4) unambiguous: that test sets
  //    assigneeUserId == requestedByUserId == requester, and the XOR-valid
  //    positive case sets assigneeUserId == assignee (different from requester).
  const requester = await prisma.user.create({
    data: {
      name: `requester-${TEST_RUN_ID}`,
      email: `requester-${TEST_RUN_ID}@example.invalid`,
      access: "ADMIN",
      roleId: role.id,
      isApi: true,
    },
  });
  requesterUserId = requester.id;

  const assignee = await prisma.user.create({
    data: {
      name: `assignee-${TEST_RUN_ID}`,
      email: `assignee-${TEST_RUN_ID}@example.invalid`,
      access: "ADMIN",
      roleId: role.id,
      isApi: true,
    },
  });
  assigneeUserId = assignee.id;

  // 4. Seed a project owned by the requester so they trivially pass the
  //    Project read/write policies even without an explicit UserProjectPermission row.
  const project = await prisma.projects.create({
    data: {
      name: `proj-${TEST_RUN_ID}`,
      createdBy: requester.id,
    },
  });
  projectId = project.id;

  // 5. Reuse existing seeded Workflows for fromState / toState. The gate is
  //    not under test here (Plan 01-03 covers it); requiresReview can stay at
  //    its default (false). What matters is that two valid Workflows ids
  //    exist and can be referenced by the FKs on ReviewRequest.
  const workflows = await prisma.workflows.findMany({
    where: { isDeleted: false, isEnabled: true },
    take: 2,
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (workflows.length < 2) {
    throw new Error(
      "Need at least two Workflows rows in the DB for fromState / toState; run `pnpm prisma db seed`.",
    );
  }
  fromStateId = workflows[0].id;
  toStateId = workflows[1].id;
}, 30_000);

afterAll(async () => {
  // Soft-delete every ReviewRequest row this run created. Hard-delete is
  // forbidden by `@@deny('delete', true)` on the ReviewRequest model and by
  // the milestone-wide soft-delete rule — use raw prisma update().
  for (const id of createdReviewRequestIds) {
    try {
      await prisma.reviewRequest.update({
        where: { id },
        data: { isDeleted: true },
      });
    } catch {
      // Row may have been hard-deleted by a prior cleanup run; ignore.
    }
  }

  // Soft-delete project (cascade-safe — ReviewRequest rows already marked
  // isDeleted above; FK constraint stays satisfied).
  if (projectId) {
    try {
      await prisma.projects.update({
        where: { id: projectId },
        data: { isDeleted: true },
      });
    } catch {
      /* ignore */
    }
  }

  // Soft-delete users last (FKs on ReviewRequest already pointed at by
  // isDeleted rows are still satisfied).
  for (const userId of [requesterUserId, assigneeUserId]) {
    if (!userId) continue;
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { isDeleted: true, isActive: false },
      });
    } catch {
      /* ignore */
    }
  }

  // Release the connection so the Vitest worker exits cleanly.
  await prisma.$disconnect();
}, 30_000);

// Build a minimal next-auth Session shape from a user id. `getEnhancedDb`
// only reads `session.user.id`, then re-fetches the user with its role and
// rolePermissions from the DB — so the rest of the Session shape can be a
// type assertion.
function sessionFor(userId: string): Session {
  return {
    user: { id: userId },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  } as unknown as Session;
}

describe("ReviewRequest XOR assignee @@validate (live-DB)", () => {
  it("XOR assignee rejects create when both assigneeUserId and assigneeRoleId are null", async () => {
    const enhanced = await getEnhancedDb(sessionFor(requesterUserId));
    await expect(
      enhanced.reviewRequest.create({
        data: {
          projectId,
          entityType: "CASE",
          entityId: ENTITY_ID_XOR_VALID + 100,
          requestedByUserId: requesterUserId,
          assigneeUserId: null,
          assigneeRoleId: null,
          fromStateId,
          toStateId,
        },
      }),
    ).rejects.toThrow(/Exactly one of/i);
  });

  it("XOR assignee rejects create when both assigneeUserId and assigneeRoleId are set", async () => {
    const enhanced = await getEnhancedDb(sessionFor(requesterUserId));
    const someRole = await prisma.roles.findFirst({
      where: { isDeleted: false },
      select: { id: true },
    });
    await expect(
      enhanced.reviewRequest.create({
        data: {
          projectId,
          entityType: "CASE",
          entityId: ENTITY_ID_XOR_VALID + 200,
          requestedByUserId: requesterUserId,
          assigneeUserId,
          assigneeRoleId: someRole!.id,
          fromStateId,
          toStateId,
        },
      }),
    ).rejects.toThrow(/Exactly one of/i);
  });

  it("XOR assignee allows create when only assigneeUserId is set", async () => {
    const enhanced = await getEnhancedDb(sessionFor(requesterUserId));
    const created = await enhanced.reviewRequest.create({
      data: {
        projectId,
        entityType: "CASE",
        entityId: ENTITY_ID_XOR_VALID,
        requestedByUserId: requesterUserId,
        assigneeUserId, // distinct from requesterUserId — also satisfies self-approval rule
        assigneeRoleId: null,
        fromStateId,
        toStateId,
      },
    });
    createdReviewRequestIds.push(created.id);
    expect(created.status).toBe("PENDING");
    expect(created.assigneeUserId).toBe(assigneeUserId);
    expect(created.assigneeRoleId).toBeNull();
  });
});

describe("ReviewRequest self-approval @@validate (live-DB)", () => {
  it("self-approval rejects create when assigneeUserId equals requestedByUserId", async () => {
    const enhanced = await getEnhancedDb(sessionFor(requesterUserId));
    await expect(
      enhanced.reviewRequest.create({
        data: {
          projectId,
          entityType: "CASE",
          entityId: ENTITY_ID_XOR_VALID + 300,
          requestedByUserId: requesterUserId,
          assigneeUserId: requesterUserId, // self-approval — must reject
          assigneeRoleId: null,
          fromStateId,
          toStateId,
        },
      }),
    ).rejects.toThrow(/Requester cannot/i);
  });
});

describe("ReviewRequest append-only @@deny (live-DB)", () => {
  let approvedRequestId: string;

  // Local setup: create a PENDING row via raw prisma, then flip it to
  // APPROVED via raw prisma (raw bypasses the @@deny — appropriate for
  // arrange/act in a test, mirroring the gate helper's system-context path).
  beforeAll(async () => {
    const pending = await prisma.reviewRequest.create({
      data: {
        projectId,
        entityType: "CASE",
        entityId: ENTITY_ID_APPEND_ONLY,
        requestedByUserId: requesterUserId,
        assigneeUserId,
        fromStateId,
        toStateId,
        status: "PENDING",
      },
    });
    createdReviewRequestIds.push(pending.id);

    await prisma.reviewRequest.update({
      where: { id: pending.id },
      data: {
        status: "APPROVED",
        decidedByUserId: assigneeUserId,
        decidedAt: new Date(),
      },
    });
    approvedRequestId = pending.id;
  }, 30_000);

  it("append-only rejects update to decisionComment after status != PENDING", async () => {
    const enhanced = await getEnhancedDb(sessionFor(requesterUserId));
    await expect(
      enhanced.reviewRequest.update({
        where: { id: approvedRequestId },
        data: { decisionComment: "tamper attempt" },
      }),
    ).rejects.toThrow();

    // Verify the row is untouched.
    const after = await prisma.reviewRequest.findUnique({
      where: { id: approvedRequestId },
      select: { decisionComment: true, status: true },
    });
    expect(after?.status).toBe("APPROVED");
    expect(after?.decisionComment).toBeNull();
  });

  it("append-only allows raw prisma to stamp consumedAt on APPROVED row", async () => {
    // D-05 carve-out: the gate helper stamps consumedAt via raw prisma to
    // bypass @@deny — proves the one-shot semantics work end-to-end at the DB.
    const stamp = new Date();
    const updated = await prisma.reviewRequest.update({
      where: { id: approvedRequestId },
      data: { consumedAt: stamp },
    });
    expect(updated.consumedAt).not.toBeNull();
    expect(updated.consumedAt?.getTime()).toBe(stamp.getTime());
    expect(updated.status).toBe("APPROVED");
  });
});

describe("ReviewRequest partial unique index — one PENDING per entity (live-DB)", () => {
  it("partial unique index rejects duplicate PENDING create with P2002 / AlreadyPendingError surface", async () => {
    // First PENDING: must succeed. Raw prisma is used for both inserts —
    // the partial unique index is a DB-layer constraint that fires regardless
    // of which client issues the write, and raw avoids policy-engine noise
    // from clouding the assertion.
    const first = await prisma.reviewRequest.create({
      data: {
        projectId,
        entityType: "CASE",
        entityId: ENTITY_ID_PARTIAL_UNIQUE,
        requestedByUserId: requesterUserId,
        assigneeUserId,
        fromStateId,
        toStateId,
        status: "PENDING",
      },
    });
    createdReviewRequestIds.push(first.id);
    expect(first.status).toBe("PENDING");

    // Second PENDING on the same (entityType, entityId): MUST reject with a
    // P2002 whose meta.target identifies the partial unique index — and the
    // isAlreadyPendingError detector from Plan 02 MUST recognise it.
    let caught: unknown;
    try {
      await prisma.reviewRequest.create({
        data: {
          projectId,
          entityType: "CASE",
          entityId: ENTITY_ID_PARTIAL_UNIQUE,
          requestedByUserId: requesterUserId,
          assigneeUserId,
          fromStateId,
          toStateId,
          status: "PENDING",
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    expect(isAlreadyPendingError(caught)).toBe(true);
  });

  it("partial unique index allows a second create after the first is soft-deleted", async () => {
    // The partial index is gated by `WHERE status = 'PENDING' AND "isDeleted" = false`.
    // Soft-deleting the first PENDING must free the (entityType, entityId)
    // slot so a fresh PENDING create can land.
    const first = await prisma.reviewRequest.create({
      data: {
        projectId,
        entityType: "CASE",
        entityId: ENTITY_ID_PARTIAL_UNIQUE_AFTER_SOFT_DELETE,
        requestedByUserId: requesterUserId,
        assigneeUserId,
        fromStateId,
        toStateId,
        status: "PENDING",
      },
    });
    createdReviewRequestIds.push(first.id);

    await prisma.reviewRequest.update({
      where: { id: first.id },
      data: { isDeleted: true },
    });

    const second = await prisma.reviewRequest.create({
      data: {
        projectId,
        entityType: "CASE",
        entityId: ENTITY_ID_PARTIAL_UNIQUE_AFTER_SOFT_DELETE,
        requestedByUserId: requesterUserId,
        assigneeUserId,
        fromStateId,
        toStateId,
        status: "PENDING",
      },
    });
    createdReviewRequestIds.push(second.id);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("PENDING");
  });
});
