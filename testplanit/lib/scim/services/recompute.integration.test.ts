/**
 * Live-DB integration tests for recomputeUserAccess.
 *
 * These cover the regression class that mocked-Prisma unit tests cannot catch:
 *
 *   1. recomputeUserAccess writes the correct `access` AND `accessSource`
 *      columns — proves both columns from the schema migration exist and
 *      the AccessSource enum is not mangled at the Prisma layer.
 *   2. No-op: when computed access == current access and accessSource
 *      unchanged, no DB write occurs (assert via updatedAt unchanged).
 *   3. readScimFallbackDefault returns "NONE" when the AppConfig row is
 *      absent in the live DB.
 *   4. A real mapped-group membership feeds through to the DB correctly:
 *      set Group.mappedAccess, attach user, run recompute, read back
 *      User.access.
 *
 * Run via:
 *   RUN_DB_INTEGRATION=1 pnpm exec vitest run lib/scim/services/recompute.integration.test.ts
 *
 * Cleanup: every test row is created with the deterministic prefix
 * `scimit-recompute-${Date.now()}` so the afterAll sweep can delete by
 * prefix without disturbing existing rows.
 */

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recomputeUserAccess, readScimFallbackDefault } from "./recompute";
import { SCIM_DEFAULT_MAPPED_ACCESS_KEY } from "../access/fallbackDefault";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const prisma = new PrismaClient();

const PREFIX = `scimit-recompute-${Date.now()}`;
let counter = 0;

function nextLabel(base = "u"): string {
  counter += 1;
  return `${PREFIX}-${base}-${counter}`;
}

async function makeTestUser(label: string) {
  const role = await prisma.roles.findFirst({
    where: { isDefault: true, isDeleted: false },
  });
  if (!role) throw new Error("Test prerequisite: no default role row");
  return prisma.user.create({
    data: {
      email: `${nextLabel(label)}@example.com`,
      name: `Recompute Test ${label}`,
      authMethod: "INTERNAL",
      access: "NONE",
      accessSource: "MANUAL",
      roleId: role.id,
      password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
    },
  });
}

async function makeTestGroup(mappedAccess: string | null = null) {
  return prisma.groups.create({
    data: {
      name: nextLabel("g"),
      mappedAccess: mappedAccess as never,
    },
  });
}

describeIntegration("recomputeUserAccess (live DB)", () => {
  beforeAll(async () => {
    if (!process.env.NEXTAUTH_SECRET && !process.env.API_TOKEN_SECRET) {
      process.env.NEXTAUTH_SECRET =
        "integration-test-secret-for-scim-token-hashing";
    }
  });

  afterAll(async () => {
    // Clean up group assignments first, then users, then groups.
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

    if (userIds.length > 0) {
      await prisma.groupAssignment.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    const groups = await prisma.groups.findMany({
      where: { name: { startsWith: PREFIX } },
      select: { id: true },
    });
    if (groups.length > 0) {
      await prisma.groups.deleteMany({
        where: { id: { in: groups.map((g) => g.id) } },
      });
    }

    // Remove the AppConfig row if we created one.
    await prisma.appConfig
      .deleteMany({
        where: { key: `${SCIM_DEFAULT_MAPPED_ACCESS_KEY}-integration-test` },
      })
      .catch(() => {});

    await prisma.$disconnect();
  });

  it("IT-R1: writes correct access AND accessSource columns — proves migration columns exist and enum round-trips", async () => {
    const user = await makeTestUser("write");
    const group = await makeTestGroup("USER");

    await prisma.groupAssignment.create({
      data: { userId: user.id, groupId: group.id },
    });

    await prisma.$transaction(async (tx) => {
      await recomputeUserAccess(tx, user.id, "NONE");
    });

    const updated = await prisma.user.findUnique({
      where: { id: user.id },
      select: { access: true, accessSource: true },
    });

    expect(updated).not.toBeNull();
    expect(updated!.access).toBe("USER");
    expect(updated!.accessSource).toBe("GROUP_MAPPING");
  });

  it("IT-R2: no-op — when computed access matches current, updatedAt is unchanged", async () => {
    const user = await makeTestUser("noop");
    const group = await makeTestGroup("ADMIN");

    await prisma.groupAssignment.create({
      data: { userId: user.id, groupId: group.id },
    });

    // First recompute to bring user to ADMIN / GROUP_MAPPING.
    await prisma.$transaction(async (tx) => {
      await recomputeUserAccess(tx, user.id, "NONE");
    });

    const beforeNoop = await prisma.user.findUnique({
      where: { id: user.id },
      select: { updatedAt: true, access: true, accessSource: true },
    });
    expect(beforeNoop!.access).toBe("ADMIN");
    expect(beforeNoop!.accessSource).toBe("GROUP_MAPPING");

    // Second recompute — same computed result → no write.
    await prisma.$transaction(async (tx) => {
      await recomputeUserAccess(tx, user.id, "NONE");
    });

    const afterNoop = await prisma.user.findUnique({
      where: { id: user.id },
      select: { updatedAt: true },
    });

    expect(afterNoop!.updatedAt.getTime()).toBe(
      beforeNoop!.updatedAt.getTime()
    );
  });

  it("IT-R3: readScimFallbackDefault returns NONE when AppConfig row is absent", async () => {
    const result = await prisma.$transaction(async (tx) => {
      return readScimFallbackDefault(tx);
    });

    expect(result).toBe("NONE");
  });

  it("IT-R4: enum round-trip — Group.mappedAccess USER/ADMIN flows through to User.access after recompute", async () => {
    const user = await makeTestUser("enum");
    const groupUser = await makeTestGroup("USER");
    const groupAdmin = await makeTestGroup("ADMIN");

    await prisma.groupAssignment.createMany({
      data: [
        { userId: user.id, groupId: groupUser.id },
        { userId: user.id, groupId: groupAdmin.id },
      ],
    });

    await prisma.$transaction(async (tx) => {
      await recomputeUserAccess(tx, user.id, "NONE");
    });

    const updated = await prisma.user.findUnique({
      where: { id: user.id },
      select: { access: true, accessSource: true },
    });

    expect(updated!.access).toBe("ADMIN");
    expect(updated!.accessSource).toBe("GROUP_MAPPING");
  });
});
