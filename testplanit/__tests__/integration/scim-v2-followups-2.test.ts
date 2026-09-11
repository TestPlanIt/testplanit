/**
 * Live-DB integration coverage for the SCIM v2 follow-ups, part 2 (V19-V30).
 *
 * Continues the V1-V18 numbering from
 * `lib/scim/services/scimV2Followups.integration.test.ts`. That file lives
 * outside `__tests__/integration/`, so CI's db-integration workflow — which
 * globs only this directory — never executes it. These cases live here so the
 * gate actually runs them.
 *
 * What only a real database can prove, and why each case is here:
 *
 *   - `partitionMembers` ANDs `scimOwnershipReadFilter(ctx)` into the member
 *     lookup, so cross-IdP grafting is refused by SQL, not by a code path a
 *     mock can fake. All three member-bearing verbs (POST / PUT / PATCH) share
 *     that helper, and all three are exercised.
 *   - The overlap-window rotation columns are a partial-unique index plus a
 *     WHERE clause; revoking has to clear them for the superseded bearer to
 *     actually die, and only `requireScimBearer` against real rows shows that.
 *   - The recompute worker batches at 100 rows per transaction. Batch
 *     boundaries, partial-commit survival, and convergence on rerun are
 *     transaction semantics — untestable with a mocked client.
 *   - `User.scimRoles` is a nullable `text[]`: Prisma/ZenStack type it as
 *     `string[]`, but a row written outside the ORM (a migration backfill, a
 *     hand-fixed row, a bulk COPY) can hold SQL NULL. V28-V30 pin what happens
 *     then.
 *
 * Enable with `RUN_DB_INTEGRATION=1` and a DATABASE_URL pointed at a
 * disposable database:
 *
 *   DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 \
 *     pnpm exec vitest run __tests__/integration/scim-v2-followups-2.test.ts
 *
 * Every row created here carries the `scimv2it2-<suffix>` prefix (the suffix
 * is per-run random so concurrent runs against one scratch database cannot
 * collide) and is swept in afterAll.
 */

import { sql } from "kysely";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  cleanupIntegrationScimTokens,
  provisionIntegrationScimToken,
} from "~/__tests__/helpers/scimIntegrationToken";
import { createRawDbClient } from "~/lib/rawDbClient";
import { ScimAuthError, requireScimBearer } from "~/lib/scim/auth";
import {
  SCIM_SCHEMAS,
  SCIM_SYSTEM_USER_ID,
  SYSTEM_PROJECT_ID,
} from "~/lib/scim/constants";
import {
  createScimGroup,
  patchScimGroup,
  putScimGroup,
} from "~/lib/scim/services/groups";
import { recomputeUserAccess } from "~/lib/scim/services/recompute";
import { createScimUser, putScimUser } from "~/lib/scim/services/users";
import {
  mintScimToken,
  revokeScimToken,
  rotateScimToken,
} from "~/lib/scim/tokens";

import type { ScimAuthContext } from "~/lib/scim/auth";
import type { ScimGroupBody } from "~/lib/scim/mapping/group";
import type { ScimUserBody } from "~/lib/scim/mapping/user";

/* -------------------------------------------------------------------------- */
/* Probes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Two seams this suite needs that the database cannot show on its own:
 *
 *   - audit events are enqueued onto BullMQ, not written in-transaction, so a
 *     run without Valkey drops them on the floor. Recording the call keeps the
 *     "skipped member ids reach the audit trail" assertion honest.
 *   - the recompute worker has no injection point for a mid-batch failure.
 *     Failing the Nth call — rather than a particular user id — makes the
 *     forced failure land in batch 2 regardless of the row order Postgres
 *     hands back.
 *
 * Both wrappers delegate to the real implementation, so an unarmed probe
 * changes nothing about behaviour.
 */
const probe = vi.hoisted(() => ({
  auditEvents: [] as Array<{
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  }>,
  recomputeCalls: [] as string[],
  failOnCallNumber: null as number | null,
}));

vi.mock("~/lib/services/auditLog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/services/auditLog")>();
  return {
    ...actual,
    captureAuditEvent: async (
      event: Parameters<typeof actual.captureAuditEvent>[0]
    ) => {
      probe.auditEvents.push(event);
      return actual.captureAuditEvent(event);
    },
  };
});

vi.mock("~/lib/scim/services/recompute", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/scim/services/recompute")>();
  return {
    ...actual,
    recomputeUserAccess: async (
      ...args: Parameters<typeof actual.recomputeUserAccess>
    ): Promise<void> => {
      probe.recomputeCalls.push(args[1]);
      if (
        probe.failOnCallNumber !== null &&
        probe.recomputeCalls.length === probe.failOnCallNumber
      ) {
        throw new Error(
          `forced recompute failure on call ${probe.failOnCallNumber}`
        );
      }
      return actual.recomputeUserAccess(...args);
    },
  };
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();

/** Random per-run so concurrent suites on one scratch DB never collide. */
const SFX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const PREFIX = `scimv2it2-${SFX}`;

/** Mirrors the private BATCH_SIZE in workers/scimAccessRecomputeWorker.ts. */
const WORKER_BATCH_SIZE = 100;

let counter = 0;

function makeUserBody(overrides: Record<string, unknown> = {}): ScimUserBody {
  counter += 1;
  const email =
    (overrides.userName as string | undefined) ??
    `${PREFIX}-${counter}@example.com`;
  return {
    schemas: [SCIM_SCHEMAS.CORE_USER],
    userName: email,
    externalId: `${PREFIX}-ext-${counter}`,
    name: { givenName: "Ada", familyName: "Example" },
    emails: [{ value: email, primary: true }],
    active: true,
    ...overrides,
  } as unknown as ScimUserBody;
}

function makeGroupBody(overrides: Record<string, unknown> = {}): ScimGroupBody {
  counter += 1;
  return {
    schemas: [SCIM_SCHEMAS.CORE_GROUP],
    displayName: `${PREFIX}-group-${counter}`,
    externalId: `${PREFIX}-gext-${counter}`,
    members: [],
    ...overrides,
  } as unknown as ScimGroupBody;
}

function bearerRequest(plaintext: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/scim/v2/Users", {
    headers: { authorization: `Bearer ${plaintext}` },
  });
}

/** Every member id the service reported as skipped for `groupId`. */
function skippedMemberIds(groupId: number): string[] {
  return probe.auditEvents
    .filter(
      (e) =>
        e.entityType === "Groups" &&
        e.entityId === String(groupId) &&
        Array.isArray(e.metadata?.scimSkippedMemberIds)
    )
    .flatMap((e) => e.metadata!.scimSkippedMemberIds as string[]);
}

describeIntegration("SCIM v2 follow-ups, part 2 (live DB)", () => {
  let oktaCtx: ScimAuthContext;
  let entraCtx: ScimAuthContext;
  let defaultRoleId: number;
  const mintedTokenIds: string[] = [];
  const createdGroupIds: number[] = [];
  const createdRoleValues: string[] = [];

  beforeAll(async () => {
    if (!process.env.NEXTAUTH_SECRET && !process.env.API_TOKEN_SECRET) {
      process.env.NEXTAUTH_SECRET =
        "integration-test-secret-for-scim-token-hashing";
    }

    const systemProject = await db.projects.findUnique({
      where: { id: SYSTEM_PROJECT_ID },
    });
    if (!systemProject) {
      throw new Error(
        "Integration prerequisite failed: the sentinel __system__ Projects " +
          "row at id = -1 is missing. Seed the database first."
      );
    }

    const defaultRole = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
      select: { id: true },
    });
    if (!defaultRole) throw new Error("No default role configured");
    defaultRoleId = defaultRole.id;

    const okta = await provisionIntegrationScimToken(`okta-${SFX}`, "OKTA");
    const entra = await provisionIntegrationScimToken(`entra-${SFX}`, "ENTRA");
    oktaCtx = okta.ctx;
    entraCtx = entra.ctx;
    mintedTokenIds.push(okta.tokenId, entra.tokenId);
  });

  afterAll(async () => {
    const groups = await db.groups.findMany({
      where: { name: { startsWith: PREFIX } },
      select: { id: true },
    });
    const groupIds = Array.from(
      new Set([...groups.map((g) => g.id), ...createdGroupIds])
    );

    if (groupIds.length > 0) {
      // Raw SQL rather than a typed JSON-path filter: ZenStack v3 models
      // `path` as a string, and the outbox discriminator is a JSON field.
      await sql`
        DELETE FROM "WebhookOutboxEvent"
        WHERE "payload"->>'id' = ANY(${sql.val(groupIds.map(String))})
      `.execute(db.$qb);
      await db.groupAssignment.deleteMany({
        where: { groupId: { in: groupIds } },
      });
      await db.groups.deleteMany({ where: { id: { in: groupIds } } });
    }

    const users = await db.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      await sql`
        DELETE FROM "WebhookOutboxEvent"
        WHERE "payload"->>'id' = ANY(${sql.val(userIds)})
      `.execute(db.$qb);
      await db.groupAssignment.deleteMany({
        where: { userId: { in: userIds } },
      });
      await db.account.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    }

    if (createdRoleValues.length > 0) {
      await db.scimRoleMapping.deleteMany({
        where: { roleValue: { in: createdRoleValues } },
      });
    }

    await cleanupIntegrationScimTokens(db, mintedTokenIds);
    await db.$disconnect();
  });

  /* ------------------------------------------------------------------ */
  /* V19-V22 — cross-IdP member grafting                                 */
  /* ------------------------------------------------------------------ */

  describe("cross-IdP member grafting", () => {
    let foreignUserId: string;
    let foreignDisplayName: string;
    let unownedUserId: string;

    beforeAll(async () => {
      // Provisioned by entra: okta must not be able to see or graft it.
      const created = await createScimUser(
        makeUserBody({
          name: { givenName: "Foreign", familyName: SFX.toUpperCase() },
        }),
        entraCtx
      );
      foreignUserId = created.resource.id;
      const row = await db.user.findUniqueOrThrow({
        where: { id: foreignUserId },
        select: { name: true, scimTokenId: true },
      });
      foreignDisplayName = row.name;
      expect(row.scimTokenId).toBe(entraCtx.tokenId);

      // Manually created: unowned (scimTokenId NULL), so either IdP may use it.
      counter += 1;
      const unowned = await db.user.create({
        data: {
          email: `${PREFIX}-unowned-${counter}@example.com`,
          name: `${PREFIX} unowned`,
          roleId: defaultRoleId,
          access: "NONE",
        },
        select: { id: true },
      });
      unownedUserId = unowned.id;
    });

    it("V19: POST cannot graft another IdP's user into a group", async () => {
      const result = await createScimGroup(
        makeGroupBody({ members: [{ value: foreignUserId }] }),
        oktaCtx
      );
      const groupId = parseInt(result.resource.id, 10);
      createdGroupIds.push(groupId);

      const assignments = await db.groupAssignment.findMany({
        where: { groupId },
      });
      expect(assignments).toHaveLength(0);

      expect(skippedMemberIds(groupId)).toContain(foreignUserId);

      expect(result.resource.members).toHaveLength(0);
      expect(JSON.stringify(result.resource)).not.toContain(foreignDisplayName);
    });

    it("V20: PUT cannot graft another IdP's user into a group", async () => {
      const body = makeGroupBody();
      const created = await createScimGroup(body, oktaCtx);
      const groupId = parseInt(created.resource.id, 10);
      createdGroupIds.push(groupId);

      const put = await putScimGroup(
        created.resource.id,
        {
          ...body,
          members: [{ value: foreignUserId }],
        } as ScimGroupBody,
        oktaCtx
      );

      const assignments = await db.groupAssignment.findMany({
        where: { groupId },
      });
      expect(assignments).toHaveLength(0);

      expect(skippedMemberIds(groupId)).toContain(foreignUserId);

      expect(put.resource.members).toHaveLength(0);
      expect(JSON.stringify(put.resource)).not.toContain(foreignDisplayName);
    });

    it("V21: PATCH cannot graft another IdP's user into a group", async () => {
      const created = await createScimGroup(makeGroupBody(), oktaCtx);
      const groupId = parseInt(created.resource.id, 10);
      createdGroupIds.push(groupId);

      const patched = await patchScimGroup(
        created.resource.id,
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            { op: "add", path: "members", value: [{ value: foreignUserId }] },
          ],
        } as never,
        oktaCtx
      );

      const assignments = await db.groupAssignment.findMany({
        where: { groupId },
      });
      expect(assignments).toHaveLength(0);

      expect(skippedMemberIds(groupId)).toContain(foreignUserId);

      expect(patched.resource.members).toHaveLength(0);
      expect(JSON.stringify(patched.resource)).not.toContain(
        foreignDisplayName
      );
    });

    it("V22: an unowned user is addable by either IdP", async () => {
      const viaOkta = await createScimGroup(
        makeGroupBody({ members: [{ value: unownedUserId }] }),
        oktaCtx
      );
      const oktaGroupId = parseInt(viaOkta.resource.id, 10);
      createdGroupIds.push(oktaGroupId);

      expect(
        await db.groupAssignment.findMany({ where: { groupId: oktaGroupId } })
      ).toHaveLength(1);
      expect(viaOkta.resource.members.map((m) => m.value)).toEqual([
        unownedUserId,
      ]);
      expect(skippedMemberIds(oktaGroupId)).toHaveLength(0);

      const viaEntra = await createScimGroup(
        makeGroupBody({ members: [{ value: unownedUserId }] }),
        entraCtx
      );
      const entraGroupId = parseInt(viaEntra.resource.id, 10);
      createdGroupIds.push(entraGroupId);

      expect(
        await db.groupAssignment.findMany({ where: { groupId: entraGroupId } })
      ).toHaveLength(1);
      expect(viaEntra.resource.members.map((m) => m.value)).toEqual([
        unownedUserId,
      ]);
      expect(skippedMemberIds(entraGroupId)).toHaveLength(0);

      // Membership is not a claim: the row stays unowned, so the other IdP
      // keeps its access too.
      const row = await db.user.findUniqueOrThrow({
        where: { id: unownedUserId },
        select: { scimTokenId: true },
      });
      expect(row.scimTokenId).toBeNull();
    });
  });

  /* ------------------------------------------------------------------ */
  /* V23-V24 — revoke kills the superseded bearer                        */
  /* ------------------------------------------------------------------ */

  describe("revoke during a rotation overlap", () => {
    async function bearerFailure(
      plaintext: string
    ): Promise<{ status: number; detail: string }> {
      try {
        await requireScimBearer(bearerRequest(plaintext));
      } catch (err) {
        if (!(err instanceof ScimAuthError)) throw err;
        const body = (await err.response.json()) as { detail?: string };
        return { status: err.response.status, detail: body.detail ?? "" };
      }
      throw new Error("expected the bearer to be rejected");
    }

    it("V23: revoke kills BOTH the current and the superseded bearer", async () => {
      const minted = await mintScimToken({
        name: `scimit-revoke-${SFX}`,
        idpName: "OKTA",
        expiresAt: null,
        createdById: SCIM_SYSTEM_USER_ID,
      });
      mintedTokenIds.push(minted.token.id);
      const supersededBearer = minted.plaintext;

      const rotated = await rotateScimToken(
        minted.token.id,
        3_600_000,
        SCIM_SYSTEM_USER_ID
      );
      const currentBearer = rotated.plaintext;

      // Both live during the window, and both resolve to the same token row.
      await expect(
        requireScimBearer(bearerRequest(currentBearer))
      ).resolves.toMatchObject({ tokenId: minted.token.id, idpName: "OKTA" });
      await expect(
        requireScimBearer(bearerRequest(supersededBearer))
      ).resolves.toMatchObject({ tokenId: minted.token.id, idpName: "OKTA" });

      await revokeScimToken(minted.token.id, SCIM_SYSTEM_USER_ID);

      // The current bearer still hashes to the row, which is now revoked.
      const current = await bearerFailure(currentBearer);
      expect(current.status).toBe(401);
      expect(current.detail).toBe("Token revoked");

      // The superseded bearer no longer matches anything: revoke cleared the
      // overlap columns, so it cannot be resolved at all.
      const superseded = await bearerFailure(supersededBearer);
      expect(superseded.status).toBe(401);
      expect(superseded.detail).toBe("Token rejected");
    });

    it("V24: revoke clears the overlap columns and closes rotation", async () => {
      const minted = await mintScimToken({
        name: `scimit-revoke2-${SFX}`,
        idpName: "OKTA",
        expiresAt: null,
        createdById: SCIM_SYSTEM_USER_ID,
      });
      mintedTokenIds.push(minted.token.id);

      await rotateScimToken(minted.token.id, 3_600_000, SCIM_SYSTEM_USER_ID);
      const during = await db.scimToken.findUniqueOrThrow({
        where: { id: minted.token.id },
        select: { previousToken: true, previousTokenExpiresAt: true },
      });
      expect(during.previousToken).not.toBeNull();
      expect(during.previousTokenExpiresAt).not.toBeNull();

      await revokeScimToken(minted.token.id, SCIM_SYSTEM_USER_ID);

      const after = await db.scimToken.findUniqueOrThrow({
        where: { id: minted.token.id },
        select: {
          isActive: true,
          revokedAt: true,
          previousToken: true,
          previousTokenPrefix: true,
          previousTokenExpiresAt: true,
        },
      });
      expect(after.isActive).toBe(false);
      expect(after.revokedAt).not.toBeNull();
      expect(after.previousToken).toBeNull();
      expect(after.previousTokenPrefix).toBeNull();
      expect(after.previousTokenExpiresAt).toBeNull();

      // A revoked credential cannot be rotated back into a working bearer.
      await expect(
        rotateScimToken(minted.token.id, 3_600_000, SCIM_SYSTEM_USER_ID)
      ).rejects.toThrow(/revoked/i);
    });
  });

  /* ------------------------------------------------------------------ */
  /* V25-V27 — recompute worker against the real database                */
  /* ------------------------------------------------------------------ */

  describe("scim-access-recompute worker", () => {
    const roleValue = `${PREFIX}-lead`;
    const otherRoleValue = `${PREFIX}-other`;
    let holderIds: string[] = [];
    let nonHolderIds: string[] = [];

    async function runProcessor(): Promise<void> {
      // Dynamic import keeps the worker (bullmq + valkey at module scope) out
      // of the statically-analyzed graph of the skipped unit lane.
      const workerMod = "../../workers/scimAccessRecomputeWorker";
      const mod = await import(/* @vite-ignore */ workerMod);
      await (mod.processor as (job: unknown) => Promise<void>)({
        id: `${PREFIX}-job`,
        data: { roleValue, adminUserId: SCIM_SYSTEM_USER_ID },
      });
    }

    async function tiersByUser(): Promise<
      Map<string, { access: string; accessSource: string; updatedAt: Date }>
    > {
      const rows = await db.user.findMany({
        where: { id: { in: [...holderIds, ...nonHolderIds] } },
        select: {
          id: true,
          access: true,
          accessSource: true,
          updatedAt: true,
        },
      });
      return new Map(
        rows.map((r) => [
          r.id,
          {
            access: r.access as string,
            accessSource: r.accessSource as string,
            updatedAt: r.updatedAt as Date,
          },
        ])
      );
    }

    beforeAll(async () => {
      // 100 holders written straight to the column…
      const bulk = Array.from({ length: WORKER_BATCH_SIZE }, (_, i) => {
        counter += 1;
        return {
          email: `${PREFIX}-holder-${i}@example.com`,
          name: `${PREFIX} holder ${i}`,
          roleId: defaultRoleId,
          scimRoles: [roleValue],
        };
      });
      await db.user.createMany({ data: bulk });

      // …plus two provisioned over the wire with MIXED CASE role values, which
      // the mapper lowercases on the way in. Both must be picked up by a
      // worker job keyed on the lowercased value.
      const wireValue = roleValue.toUpperCase();
      const scimHolders: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const created = await createScimUser(
          makeUserBody({ roles: [{ value: wireValue }] }),
          oktaCtx
        );
        scimHolders.push(created.resource.id);
      }
      for (const id of scimHolders) {
        const row = await db.user.findUniqueOrThrow({
          where: { id },
          select: { scimRoles: true, access: true },
        });
        expect(row.scimRoles).toEqual([roleValue]);
        // No mapping exists yet, so the create left the tier alone.
        expect(row.access).toBe("NONE");
      }

      // Non-holders: an unmapped role value the job never selects on.
      const others = Array.from({ length: 4 }, (_, i) => {
        counter += 1;
        return {
          email: `${PREFIX}-nonholder-${i}@example.com`,
          name: `${PREFIX} nonholder ${i}`,
          roleId: defaultRoleId,
          scimRoles: [otherRoleValue],
        };
      });
      await db.user.createMany({ data: others });

      const holders = await db.user.findMany({
        where: { scimRoles: { has: roleValue }, isDeleted: false },
        select: { id: true },
      });
      holderIds = holders.map((h) => h.id);

      const nonHolders = await db.user.findMany({
        where: { scimRoles: { has: otherRoleValue }, isDeleted: false },
        select: { id: true },
      });
      nonHolderIds = nonHolders.map((h) => h.id);

      // The admin action that triggers the job in production.
      createdRoleValues.push(roleValue);
      await db.scimRoleMapping.create({
        data: { roleValue, mappedAccess: "PROJECTADMIN" },
      });
    });

    it("V25: a role-mapping job retiers every holder across batch boundaries, and nobody else", async () => {
      expect(holderIds.length).toBeGreaterThan(WORKER_BATCH_SIZE);
      expect(nonHolderIds).toHaveLength(4);

      const before = await tiersByUser();
      expect(holderIds.every((id) => before.get(id)!.access === "NONE")).toBe(
        true
      );

      await runProcessor();

      const after = await tiersByUser();
      for (const id of holderIds) {
        expect(after.get(id)!.access).toBe("PROJECTADMIN");
        expect(after.get(id)!.accessSource).toBe("GROUP_MAPPING");
      }
      for (const id of nonHolderIds) {
        expect(after.get(id)!.access).toBe("NONE");
        expect(after.get(id)!.accessSource).toBe("MANUAL");
      }
    });

    it("V26: a failure in batch 2 keeps batch 1's writes, and a rerun converges", async () => {
      // An admin retiering the mapping is what re-runs the sweep.
      await db.scimRoleMapping.update({
        where: { roleValue },
        data: { mappedAccess: "USER" },
      });

      probe.recomputeCalls.length = 0;
      probe.failOnCallNumber = WORKER_BATCH_SIZE + 1;
      let threw = false;
      try {
        await runProcessor();
      } catch {
        threw = true;
      } finally {
        probe.failOnCallNumber = null;
      }
      expect(threw).toBe(true);

      // Call N is user N in the worker's own iteration order, so call
      // BATCH_SIZE + 1 is the first row of the second transaction.
      const failedUserId = probe.recomputeCalls[WORKER_BATCH_SIZE];
      expect(failedUserId).toBeTruthy();

      const afterFailure = await tiersByUser();
      const committed = holderIds.filter(
        (id) => afterFailure.get(id)!.access === "USER"
      );
      const rolledBack = holderIds.filter(
        (id) => afterFailure.get(id)!.access === "PROJECTADMIN"
      );

      // Batch 1 committed in its own transaction and survived; batch 2 rolled
      // back whole, including rows the failing one never reached.
      expect(committed).toHaveLength(WORKER_BATCH_SIZE);
      expect(rolledBack).toHaveLength(holderIds.length - WORKER_BATCH_SIZE);
      expect(rolledBack).toContain(failedUserId);

      await runProcessor();

      const afterRerun = await tiersByUser();
      for (const id of holderIds) {
        expect(afterRerun.get(id)!.access).toBe("USER");
        expect(afterRerun.get(id)!.accessSource).toBe("GROUP_MAPPING");
      }
    });

    it("V27: rerunning a converged job is a no-op, down to the row timestamps", async () => {
      const before = await tiersByUser();

      await runProcessor();

      const after = await tiersByUser();
      for (const id of [...holderIds, ...nonHolderIds]) {
        expect(after.get(id)!.access).toBe(before.get(id)!.access);
        expect(after.get(id)!.accessSource).toBe(before.get(id)!.accessSource);
        // recomputeUserAccess short-circuits when nothing changes, so an
        // idempotent rerun must not even touch updatedAt.
        expect(after.get(id)!.updatedAt.getTime()).toBe(
          before.get(id)!.updatedAt.getTime()
        );
      }
    });
  });

  /* ------------------------------------------------------------------ */
  /* V28-V30 — NULL scimRoles                                            */
  /* ------------------------------------------------------------------ */

  describe("NULL scimRoles column", () => {
    let nullRolesUserId: string;
    let nullRolesEmail: string;

    beforeAll(async () => {
      counter += 1;
      nullRolesUserId = `${PREFIX}-nullroles-${counter}`;
      nullRolesEmail = `${PREFIX}-nullroles-${counter}@example.com`;
      // Straight to SQL: the ORM always writes an array for a scalar list, so
      // a genuine NULL can only be produced outside it — a migration that
      // added the column without a default, a backfill, or a bulk COPY.
      await db.$executeRaw`
        INSERT INTO "User" ("id", "name", "email", "roleId", "updatedAt")
        VALUES (${nullRolesUserId}, ${`${PREFIX} null roles`}, ${nullRolesEmail}, ${defaultRoleId}, NOW())
      `;
    });

    it("V28: a NULL scimRoles column reaches the ORM as an empty array, not null", async () => {
      // The column really is SQL NULL…
      const raw = await sql<{
        isNull: boolean;
      }>`SELECT "scimRoles" IS NULL AS "isNull" FROM "User" WHERE "id" = ${sql.val(nullRolesUserId)}`.execute(
        db.$qb
      );
      expect(raw.rows[0].isNull).toBe(true);

      // …but every consumer sees `[]`. This is the whole reason the unguarded
      // dereferences downstream survive: `resolveRoleTiers`
      // (lib/scim/services/recompute.ts:21, reached from :51) and the PUT
      // diff (lib/scim/services/users.ts:690) both call a method on this
      // value with no null check, so the ORM's normalization is what stands
      // between a NULL column and a TypeError. If that normalization ever
      // changes, this assertion fails here rather than as a 500 in
      // production.
      const row = await db.user.findUniqueOrThrow({
        where: { id: nullRolesUserId },
        select: { scimRoles: true },
      });
      expect(row.scimRoles).toEqual([]);
    });

    it("V29: recomputeUserAccess does not crash on a NULL scimRoles row", async () => {
      await expect(
        recomputeUserAccess(db as never, nullRolesUserId, "NONE")
      ).resolves.toBeUndefined();

      // Ungoverned — no groups, no asserted roles — so the tier is untouched.
      const row = await db.user.findUniqueOrThrow({
        where: { id: nullRolesUserId },
        select: { access: true, accessSource: true },
      });
      expect(row.access).toBe("NONE");
      expect(row.accessSource).toBe("MANUAL");
    });

    it("V30: a SCIM PUT over a NULL scimRoles row succeeds and rewrites the column", async () => {
      const wireRole = `${PREFIX}-PUT`;

      const result = await putScimUser(
        nullRolesUserId,
        makeUserBody({
          userName: nullRolesEmail,
          roles: [{ value: wireRole }],
        }),
        oktaCtx
      );
      expect(result.status).toBe(200);
      expect(result.resource.id).toBe(nullRolesUserId);

      const row = await db.user.findUniqueOrThrow({
        where: { id: nullRolesUserId },
        select: { scimRoles: true, scimTokenId: true, access: true },
      });
      // The NULL is replaced by the normalized (lowercased) assertion…
      expect(row.scimRoles).toEqual([wireRole.toLowerCase()]);
      // …the first real write claims the unowned row…
      expect(row.scimTokenId).toBe(oktaCtx.tokenId);
      // …and an unmapped role value still leaves the tier alone.
      expect(row.access).toBe("NONE");
    });
  });
});
