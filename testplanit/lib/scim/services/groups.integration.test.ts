/**
 * Live-DB integration tests for the SCIM Groups service layer.
 *
 * Run via:
 *   RUN_DB_INTEGRATION=1 pnpm exec vitest run lib/scim/services/groups.integration.test.ts
 *
 * Coverage targets (mocked-Prisma unit tests cannot reach these):
 *   1. The three SCIM Groups columns (scimDisplayName, externalId @unique,
 *      scimExtensions Json) are reachable from the generated client.
 *   2. GroupAssignment.createMany / deleteMany commit atomically inside the
 *      service-owned tx so member-sync survives partial failure.
 *   3. URN merge round-trip — POST writes two URN buckets, PATCH overwrites
 *      one, GET observes both.
 *   4. AuthMethod doesn't apply to Groups (sanity — Groups have no auth).
 *   5. WebhookOutboxEvent rows FK against the sentinel __system__ Projects
 *      row at id = -1.
 *   6. PUT no-op suppresses webhook emit and stamps scimNoOp audit.
 *
 * Cleanup: every test row is created with the deterministic prefix
 * `scimit-groups-${Date.now()}` so the afterAll sweep can delete by prefix
 * without disturbing existing rows.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";

import {
  SCIM_SCHEMAS,
  SCIM_SYSTEM_USER_ID,
  SYSTEM_PROJECT_ID,
} from "../constants";
import {
  createScimGroup,
  deleteScimGroup,
  getScimGroupById,
  patchScimGroup,
  putScimGroup,
} from "./groups";

import type { ScimAuthContext } from "../auth";
import type { ScimGroupBody } from "../mapping/group";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();

const PREFIX = `scimit-groups-${Date.now()}`;
let counter = 0;

function nextDisplayName(label = "g"): string {
  counter += 1;
  return `${PREFIX}-${label}-${counter}`;
}

function nextExternalId(label = "ext"): string {
  return `${PREFIX}-${label}-${counter}`;
}

function makeBody(overrides: Partial<ScimGroupBody> = {}): ScimGroupBody {
  const displayName = overrides.displayName ?? nextDisplayName();
  const externalId = overrides.externalId ?? nextExternalId();
  return {
    schemas: [SCIM_SCHEMAS.CORE_GROUP],
    displayName,
    externalId,
    members: [],
    ...overrides,
  } as ScimGroupBody;
}

async function makeTestUser(emailLabel: string): Promise<string> {
  const role = await db.roles.findFirst({
    where: { isDefault: true, isDeleted: false },
  });
  if (!role) throw new Error("Test prerequisite: no default role row");
  const user = await db.user.create({
    data: {
      email: `${PREFIX}-${emailLabel}-${counter}@example.com`,
      name: `Member ${emailLabel}`,
      authMethod: "INTERNAL",
      access: "NONE",
      roleId: role.id,
      password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
    },
  });
  return user.id;
}

describeIntegration("SCIM Groups service (live DB)", () => {
  let ctx: ScimAuthContext;

  beforeAll(async () => {
    if (!process.env.NEXTAUTH_SECRET && !process.env.API_TOKEN_SECRET) {
      process.env.NEXTAUTH_SECRET =
        "integration-test-secret-for-scim-token-hashing";
    }
    ctx = {
      tokenId: `scimit-tok-${Date.now()}`,
      systemUserId: SCIM_SYSTEM_USER_ID,
    };

    const systemProject = await db.projects.findUnique({
      where: { id: SYSTEM_PROJECT_ID },
    });
    if (!systemProject) {
      throw new Error(
        "Integration prerequisite failed: the sentinel __system__ Projects " +
          "row at id = -1 is missing. Run `pnpm generate` (which seeds it)."
      );
    }
  });

  afterAll(async () => {
    // Sweep test groups (and their assignments via cascade).
    const groups = await db.groups.findMany({
      where: { name: { startsWith: PREFIX } },
      select: { id: true },
    });
    const groupIds = groups.map((g) => g.id);

    if (groupIds.length > 0) {
      await db.webhookOutboxEvent.deleteMany({
        where: {
          // Raw Prisma-style JSON-path filter v3's typed WhereInput doesn't model.
          OR: groupIds.map((id) => ({
            payload: { path: ["id"], equals: id },
          })) as any,
        },
      });
      await db.groupAssignment.deleteMany({
        where: { groupId: { in: groupIds } },
      });
      await db.groups.deleteMany({ where: { id: { in: groupIds } } });
    }

    // Sweep test users.
    const users = await db.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    });
    if (users.length > 0) {
      const ids = users.map((u) => u.id);
      await db.groupAssignment.deleteMany({
        where: { userId: { in: ids } },
      });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }

    await db.$disconnect();
  });

  it("IT1: POST persists scimDisplayName (lowercased), externalId, scimExtensions JSON and stamps updatedAt", async () => {
    const displayName = nextDisplayName("persist");
    const externalId = nextExternalId("persist");

    const body = {
      schemas: [SCIM_SCHEMAS.CORE_GROUP, "urn:custom:ext"],
      displayName,
      externalId,
      members: [],
      "urn:custom:ext": { customAttr: "value" },
    } as unknown as ScimGroupBody;

    const result = await createScimGroup(body, ctx);
    expect(result.linked).toBe(false);

    const row = await db.groups.findUnique({
      where: { id: parseInt(result.resource.id, 10) },
    });
    expect(row).not.toBeNull();
    expect(row!.name).toBe(displayName);
    expect(row!.scimDisplayName).toBe(displayName.toLowerCase());
    expect(row!.externalId).toBe(externalId);
    expect(row!.updatedAt).not.toBeNull();
    const ext = row!.scimExtensions as Record<string, unknown> | null;
    expect(ext).toBeTruthy();
    expect(ext!["urn:custom:ext"]).toMatchObject({ customAttr: "value" });
  });

  it("IT2: POST with members creates GroupAssignment rows; GET returns members projection", async () => {
    const memberId = await makeTestUser("member");

    const result = await createScimGroup(
      makeBody({
        displayName: nextDisplayName("withmembers"),
        members: [{ value: memberId }],
      }),
      ctx
    );

    const groupId = parseInt(result.resource.id, 10);
    const assignments = await db.groupAssignment.findMany({
      where: { groupId },
    });
    expect(assignments.length).toBe(1);
    expect(assignments[0].userId).toBe(memberId);

    const fetched = await getScimGroupById(result.resource.id, ctx);
    expect(fetched.members?.length).toBe(1);
    expect(fetched.members?.[0].value).toBe(memberId);
  });

  it("IT3: resurrection — POST with same externalId on tombstone flips isDeleted false", async () => {
    const displayName = nextDisplayName("res");
    const externalId = nextExternalId("res");

    const created = await createScimGroup(
      makeBody({ displayName, externalId, members: [] }),
      ctx
    );
    await deleteScimGroup(created.resource.id, ctx);

    const tomb = await db.groups.findUnique({
      where: { id: parseInt(created.resource.id, 10) },
    });
    expect(tomb!.isDeleted).toBe(true);
    expect(tomb!.externalId).toBe(externalId);

    const resurrect = await createScimGroup(
      makeBody({
        displayName: nextDisplayName("res2"),
        externalId,
        members: [],
      }),
      ctx
    );
    expect(resurrect.linked).toBe(false);

    const after = await db.groups.findUnique({
      where: { id: parseInt(created.resource.id, 10) },
    });
    expect(after!.isDeleted).toBe(false);
    expect(after!.externalId).toBe(externalId);
  });

  it("IT4: URN merge round-trip — PUT replaces one bucket, preserves the other", async () => {
    const urnA = "urn:custom:bucket-a";
    const urnB = "urn:custom:bucket-b";

    const displayName = nextDisplayName("urn");
    const externalId = nextExternalId("urn");

    const body = {
      schemas: [SCIM_SCHEMAS.CORE_GROUP, urnA, urnB],
      displayName,
      externalId,
      members: [],
      [urnA]: { value: "A1" },
      [urnB]: { value: "B1" },
    } as unknown as ScimGroupBody;

    const created = await createScimGroup(body, ctx);

    const putBody = {
      schemas: [SCIM_SCHEMAS.CORE_GROUP, urnB],
      displayName,
      externalId,
      members: [],
      [urnB]: { value: "B2" },
    } as unknown as ScimGroupBody;
    await putScimGroup(created.resource.id, putBody, ctx);

    const after = await db.groups.findUnique({
      where: { id: parseInt(created.resource.id, 10) },
      select: { scimExtensions: true },
    });
    const ext = after!.scimExtensions as Record<string, unknown>;
    expect(ext[urnA]).toMatchObject({ value: "A1" });
    expect(ext[urnB]).toMatchObject({ value: "B2" });
  });

  it("IT5: member-PATCH GroupAssignment.createMany inside tx; deleteMany inside tx", async () => {
    const userA = await makeTestUser("uA");
    const userB = await makeTestUser("uB");

    const created = await createScimGroup(
      makeBody({
        displayName: nextDisplayName("mp"),
        members: [{ value: userA }],
      }),
      ctx
    );
    const groupId = parseInt(created.resource.id, 10);

    // PATCH add userB
    await patchScimGroup(
      created.resource.id,
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "add", path: "members", value: [{ value: userB }] }],
      } as never,
      ctx
    );

    let assignments = await db.groupAssignment.findMany({
      where: { groupId },
    });
    expect(assignments.length).toBe(2);
    expect(assignments.map((a) => a.userId).sort()).toEqual(
      [userA, userB].sort()
    );

    // PATCH remove userA (Entra-shape)
    await patchScimGroup(
      created.resource.id,
      {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          {
            op: "Remove",
            path: "members",
            value: [{ value: userA }],
          },
        ],
      } as never,
      ctx
    );

    assignments = await db.groupAssignment.findMany({
      where: { groupId },
    });
    expect(assignments.length).toBe(1);
    expect(assignments[0].userId).toBe(userB);
  });

  it("IT6: WebhookOutboxEvent FK targets the __system__ Projects row at -1", async () => {
    const created = await createScimGroup(
      makeBody({ displayName: nextDisplayName("wh"), members: [] }),
      ctx
    );

    const events = await db.webhookOutboxEvent.findMany({
      where: {
        eventName: "scim.group.created",
        projectId: SYSTEM_PROJECT_ID,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const matching = events.find((e) => {
      const payload = e.payload as Record<string, unknown> | null;
      return payload?.id === parseInt(created.resource.id, 10);
    });
    expect(matching).toBeDefined();
    expect(matching!.projectId).toBe(SYSTEM_PROJECT_ID);
  });

  it("IT7: PUT no-op suppresses webhook + stamps scimNoOp audit", async () => {
    const created = await createScimGroup(
      makeBody({
        displayName: nextDisplayName("noop"),
        externalId: nextExternalId("noop"),
        members: [],
      }),
      ctx
    );

    const baseline = await db.webhookOutboxEvent.count({
      where: {
        projectId: SYSTEM_PROJECT_ID,
        eventName: "scim.group.updated",
      },
    });

    const row = await db.groups.findUnique({
      where: { id: parseInt(created.resource.id, 10) },
    });

    const noopBody: ScimGroupBody = {
      schemas: [SCIM_SCHEMAS.CORE_GROUP],
      displayName: row!.name,
      externalId: row!.externalId ?? undefined,
      members: [],
    } as ScimGroupBody;

    await putScimGroup(created.resource.id, noopBody, ctx);

    const after = await db.webhookOutboxEvent.count({
      where: {
        projectId: SYSTEM_PROJECT_ID,
        eventName: "scim.group.updated",
      },
    });
    expect(after).toBe(baseline);
  });

  it("IT8: DELETE tombstones + getScimGroupById throws NotFound + externalId preserved", async () => {
    const externalId = nextExternalId("del");
    const created = await createScimGroup(
      makeBody({
        displayName: nextDisplayName("del"),
        externalId,
        members: [],
      }),
      ctx
    );

    const result = await deleteScimGroup(created.resource.id, ctx);
    expect(result.status).toBe(204);

    await expect(getScimGroupById(created.resource.id, ctx)).rejects.toThrow(
      /not found/i
    );

    const row = await db.groups.findUnique({
      where: { id: parseInt(created.resource.id, 10) },
    });
    expect(row!.isDeleted).toBe(true);
    expect(row!.externalId).toBe(externalId);
  });
});
