/**
 * Live-DB integration tests for the SCIM Users service layer.
 *
 * These cover the regression class that mocked-Prisma unit tests cannot
 * catch:
 *
 *   1. The five SCIM identity columns (scimUserName, scimExternalId,
 *      scimGivenName, scimFamilyName, scimExtensions) are reachable from
 *      the generated client. If a prior migration was skipped, the
 *      Postgres "unknown column" error fires here and not in production.
 *   2. AuthMethod.SCIM is a valid enum value at the database level — proves
 *      the enum migration landed on the live DB.
 *   3. The sentinel `__system__` Projects row at id = -1 is FK-targetable
 *      so SCIM webhook outbox events with projectId = -1 actually commit.
 *   4. scimExtensions JSONB round-trips through the SELECT-then-merge path:
 *      POST writes two URN buckets, PATCH overwrites one, GET observes
 *      both. Mocked tests pass even when the URN partition is dropped.
 *   5. PATCH active:false deletes Account rows inside the same tx.
 *   6. PUT no-op writes a scimNoOp audit row WITHOUT emitting a webhook
 *      outbox event.
 *   7. JIT-bind path UPDATEs an existing row instead of throwing P2002.
 *
 * Run via:
 *   RUN_DB_INTEGRATION=1 pnpm exec vitest run lib/scim/services/users.integration.test.ts
 *
 * Cleanup: every test row is created with the email prefix
 * `scimit-<timestamp>-<n>@example.com` so the afterAll sweep can delete
 * by prefix without disturbing existing rows. The synthetic SCIM
 * Provisioner user and the sentinel `__system__` Projects row are
 * permanent seed rows and are NEVER deleted by this file.
 *
 * Why not the ROLLBACK_SENTINEL withRollback pattern (submitResult.integration
 * uses it): the service-under-test calls `db.$transaction(...)`
 * internally, which Prisma resolves against the outer tx in a nested call.
 * Throwing the sentinel from the outer body to force rollback would unwind
 * BOTH the test scaffold and the production-path tx as one unit; the inner
 * service flow would see its own try/finally invariants violated. Per-test
 * row cleanup via the deterministic email prefix is cleaner here.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";

import {
  SCIM_SCHEMAS,
  SCIM_SYSTEM_USER_ID,
  SYSTEM_PROJECT_ID,
} from "../constants";
import {
  createScimUser,
  deleteScimUser,
  getScimUserById,
  patchScimUser,
  putScimUser,
} from "./users";

import type { ScimAuthContext } from "../auth";
import type { ScimUserBody } from "../mapping/user";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();

const EMAIL_PREFIX = `scimit-${Date.now()}`;
let emailCounter = 0;

function nextEmail(label = "u"): string {
  emailCounter += 1;
  return `${EMAIL_PREFIX}-${emailCounter}-${label}@example.com`;
}

function nextExternalId(label = "ext"): string {
  return `${EMAIL_PREFIX}-${label}-${emailCounter}`;
}

function makeBody(overrides: Partial<ScimUserBody> = {}): ScimUserBody {
  const email = overrides.userName ?? nextEmail();
  const externalId = overrides.externalId ?? nextExternalId();
  return {
    schemas: [SCIM_SCHEMAS.CORE_USER],
    userName: email,
    externalId,
    name: { givenName: "Alice", familyName: "Example" },
    emails: [{ value: email, primary: true }],
    active: true,
    ...overrides,
  };
}

describeIntegration("SCIM Users service (live DB)", () => {
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

    // Sanity check: the sentinel Projects row must exist before any test
    // can fire a webhook outbox event with projectId = -1.
    const systemProject = await db.projects.findUnique({
      where: { id: SYSTEM_PROJECT_ID },
    });
    if (!systemProject) {
      throw new Error(
        "Integration prerequisite failed: the sentinel __system__ Projects " +
          "row at id = -1 is missing. Run `pnpm generate` (which seeds it)."
      );
    }

    const scimUser = await db.user.findUnique({
      where: { id: SCIM_SYSTEM_USER_ID },
    });
    if (!scimUser) {
      throw new Error(
        "Integration prerequisite failed: the synthetic SCIM Provisioner " +
          "user is missing. Run `pnpm generate`."
      );
    }
  });

  afterAll(async () => {
    // Sweep every test row by the deterministic email prefix.
    const sweepable = await db.user.findMany({
      where: { email: { startsWith: EMAIL_PREFIX } },
      select: { id: true },
    });
    const sweepIds = sweepable.map((r) => r.id);

    // Sweep the webhook outbox rows whose payload references one of the
    // test users. Outbox events fired by SCIM mutations have
    // actorUserId = SCIM_SYSTEM_USER_ID, so a `userId` filter would miss
    // them; payload.id is the discriminator the service writes.
    if (sweepIds.length > 0) {
      await db.webhookOutboxEvent.deleteMany({
        where: {
          // Raw Prisma-style JSON-path filter v3's typed WhereInput doesn't model.
          OR: sweepIds.map((id) => ({
            payload: { path: ["id"], equals: id },
          })) as any,
        },
      });
      await db.account.deleteMany({
        where: { userId: { in: sweepIds } },
      });
      await db.user.deleteMany({ where: { id: { in: sweepIds } } });
    }
    await db.$disconnect();
  });

  it("IT1: creates a new SCIM user with authMethod=SCIM and all five scim* columns persisted", async () => {
    const result = await createScimUser(makeBody(), ctx);
    expect(result.linked).toBe(false);

    const row = await db.user.findUnique({
      where: { id: result.resource.id },
    });
    expect(row).not.toBeNull();
    expect(row!.authMethod).toBe("SCIM");
    expect(row!.scimUserName).toBe(result.resource.userName);
    expect(row!.scimExternalId).toBe(result.resource.externalId);
    expect(row!.scimGivenName).toBe("Alice");
    expect(row!.scimFamilyName).toBe("Example");
    expect(row!.isActive).toBe(true);
    expect(row!.isDeleted).toBe(false);
  });

  it("IT2: PUT preserves all scimExtensions URN buckets through round-trip (SELECT-then-merge)", async () => {
    const urnA = SCIM_SCHEMAS.ENTERPRISE_USER;
    const urnB = "urn:custom:test:extension";

    const initialEmail = nextEmail("urn");
    const body: ScimUserBody = {
      schemas: [SCIM_SCHEMAS.CORE_USER, urnA, urnB],
      userName: initialEmail,
      externalId: nextExternalId("urn"),
      name: { givenName: "Round", familyName: "Trip" },
      emails: [{ value: initialEmail, primary: true }],
      active: true,
      [urnA]: { department: "eng" },
      [urnB]: { customField: "value-A" },
    } as unknown as ScimUserBody;

    const created = await createScimUser(body, ctx);

    // PUT a body that touches urnB only — the service's SELECT-then-merge
    // must preserve urnA verbatim from the existing row.
    const putBody: ScimUserBody = {
      schemas: [SCIM_SCHEMAS.CORE_USER, urnB],
      userName: initialEmail,
      externalId: body.externalId,
      name: { givenName: "Round", familyName: "Trip" },
      emails: [{ value: initialEmail, primary: true }],
      active: true,
      [urnB]: { customField: "value-B" },
    } as unknown as ScimUserBody;
    await putScimUser(created.resource.id, putBody, ctx);

    const after = await db.user.findUnique({
      where: { id: created.resource.id },
      select: { scimExtensions: true },
    });
    const ext = after!.scimExtensions as Record<string, unknown>;
    expect(ext).toBeTruthy();
    // urnA bucket preserved (this is the load-bearing assertion)
    expect(ext[urnA]).toMatchObject({ department: "eng" });
    // urnB bucket overwritten with new value
    expect(ext[urnB]).toMatchObject({ customField: "value-B" });
  });

  it("IT3: PATCH active:false deletes Account rows in the same tx", async () => {
    const created = await createScimUser(makeBody(), ctx);

    await db.account.create({
      data: {
        userId: created.resource.id,
        type: "oauth",
        provider: "saml",
        providerAccountId: `${EMAIL_PREFIX}-acct-${Date.now()}`,
      },
    });

    const before = await db.account.count({
      where: { userId: created.resource.id },
    });
    expect(before).toBe(1);

    const patchBody = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", path: "active", value: false }],
    };
    await patchScimUser(created.resource.id, patchBody as never, ctx);

    const after = await db.account.count({
      where: { userId: created.resource.id },
    });
    expect(after).toBe(0);

    const row = await db.user.findUnique({
      where: { id: created.resource.id },
    });
    expect(row!.isActive).toBe(false);
    expect(row!.isDeleted).toBe(false);
  });

  it("IT4: writes a WebhookOutboxEvent row with projectId=-1 FK-targeting the __system__ row", async () => {
    const created = await createScimUser(makeBody(), ctx);

    const events = await db.webhookOutboxEvent.findMany({
      where: {
        eventName: "scim.user.created",
        projectId: SYSTEM_PROJECT_ID,
        actorUserId: SCIM_SYSTEM_USER_ID,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    // Must include at least one row whose payload references the new user.
    const matching = events.find((e) => {
      const payload = e.payload as Record<string, unknown> | null;
      return payload?.id === created.resource.id;
    });
    expect(matching).toBeDefined();
    expect(matching!.projectId).toBe(SYSTEM_PROJECT_ID);
  });

  it("IT5: JIT-bind path UPDATEs existing row and returns linked:true", async () => {
    const email = nextEmail("jit");

    // Pre-seed a row WITHOUT scimExternalId (a SAML/OAuth user the IdP is
    // now binding via SCIM for the first time). roleId target the seeded
    // default role; access stays at NONE.
    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const existing = await db.user.create({
      data: {
        email,
        name: "Pre Existing",
        externalId: null,
        scimExternalId: null,
        authMethod: "INTERNAL",
        access: "NONE",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
    });

    const externalId = nextExternalId("jit");
    const body: ScimUserBody = {
      schemas: [SCIM_SCHEMAS.CORE_USER],
      userName: email,
      externalId,
      name: { givenName: "Jit", familyName: "Bound" },
      emails: [{ value: email, primary: true }],
      active: true,
    };

    const result = await createScimUser(body, ctx);
    expect(result.linked).toBe(true);
    expect(result.resource.id).toBe(existing.id);

    const after = await db.user.findUnique({
      where: { id: existing.id },
    });
    expect(after!.scimExternalId).toBe(externalId);
    // externalId column (SAML NameID) was NOT overwritten
    expect(after!.externalId).toBeNull();

    // No second row was inserted under the same email.
    const dupes = await db.user.count({ where: { email } });
    expect(dupes).toBe(1);
  });

  it("IT6: PUT no-op emits a scimNoOp audit but writes no new webhook outbox row", async () => {
    const created = await createScimUser(makeBody(), ctx);

    const baseline = await db.webhookOutboxEvent.count({
      where: {
        actorUserId: SCIM_SYSTEM_USER_ID,
        projectId: SYSTEM_PROJECT_ID,
      },
    });

    const row = await db.user.findUnique({
      where: { id: created.resource.id },
    });
    const noopBody: ScimUserBody = {
      schemas: [SCIM_SCHEMAS.CORE_USER],
      userName: row!.scimUserName as string,
      externalId: row!.scimExternalId as string,
      name: {
        givenName: row!.scimGivenName as string,
        familyName: row!.scimFamilyName as string,
      },
      emails: [{ value: row!.email, primary: true }],
      active: row!.isActive,
    };

    await putScimUser(created.resource.id, noopBody, ctx);

    const after = await db.webhookOutboxEvent.count({
      where: {
        actorUserId: SCIM_SYSTEM_USER_ID,
        projectId: SYSTEM_PROJECT_ID,
      },
    });
    // No NEW outbox event was inserted by the no-op PUT.
    expect(after).toBe(baseline);
  });

  it("IT7: DELETE soft-deletes and getScimUserById then throws NotFound", async () => {
    const created = await createScimUser(makeBody(), ctx);

    const result = await deleteScimUser(created.resource.id, ctx);
    expect(result.status).toBe(204);

    await expect(getScimUserById(created.resource.id, ctx)).rejects.toThrow(
      /not found/i
    );

    const row = await db.user.findUnique({
      where: { id: created.resource.id },
    });
    expect(row!.isDeleted).toBe(true);
    expect(row!.isActive).toBe(false);
    // Email + scimExternalId preserved for resurrection.
    expect(row!.email).toBeTruthy();
    expect(row!.scimExternalId).toBeTruthy();
  });
});
