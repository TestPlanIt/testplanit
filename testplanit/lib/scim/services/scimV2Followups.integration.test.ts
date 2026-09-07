/**
 * Live-DB integration coverage for the four SCIM v2 follow-ups.
 *
 * These exist because the unit suites mock the database, and every one of
 * these features leans on SQL that mocks cannot validate:
 *
 *   - the `scimRoles` text[] column and its join onto ScimRoleMapping
 *   - the `scimToken: { idpName }` relation filter that scopes cross-IdP reads
 *   - the partial-unique `previousToken` index and the overlap-window WHERE
 *   - the composite-key upsert that materializes GroupProjectPermission, and
 *     whether the materialized row actually grants access through the real
 *     permission engine
 *
 * Enable with `RUN_DB_INTEGRATION=1` and a DATABASE_URL pointed at a
 * disposable database. Every row created here is prefixed `scimv2it-` and
 * swept in afterAll.
 */

import { sql } from "kysely";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { requireScimBearer } from "~/lib/scim/auth";
import {
  SCIM_SCHEMAS,
  SCIM_SYSTEM_USER_ID,
  SYSTEM_PROJECT_ID,
} from "~/lib/scim/constants";
import { materializeGroupProjectMappings } from "~/lib/scim/access/projectMappings";
import { rotateScimToken } from "~/lib/scim/tokens";
import { resolveEffectiveProjectRoleId } from "~/lib/services/effectiveRole";
import {
  cleanupIntegrationScimTokens,
  provisionIntegrationScimToken,
} from "~/__tests__/helpers/scimIntegrationToken";

import { createScimUser, listScimUsers, putScimUser } from "./users";
import { ScimOwnershipError } from "../ownership";

import type { ScimAuthContext } from "../auth";
import type { ScimUserBody } from "../mapping/user";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();

const PREFIX = `scimv2it-${Date.now()}`;
let counter = 0;

function nextEmail(label = "u"): string {
  counter += 1;
  return `${PREFIX}-${counter}-${label}@example.com`;
}

function makeBody(overrides: Partial<ScimUserBody> = {}): ScimUserBody {
  const email = overrides.userName ?? nextEmail();
  return {
    schemas: [SCIM_SCHEMAS.CORE_USER],
    userName: email,
    externalId: `${PREFIX}-ext-${counter}`,
    name: { givenName: "Ada", familyName: "Example" },
    emails: [{ value: email, primary: true }],
    active: true,
    ...overrides,
  };
}

describeIntegration("SCIM v2 follow-ups (live DB)", () => {
  let oktaCtx: ScimAuthContext;
  let entraCtx: ScimAuthContext;
  const mintedTokenIds: string[] = [];
  const createdGroupIds: number[] = [];
  const createdRoleValues: string[] = [];
  let projectId: number;
  let defaultRoleId: number;

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

    const okta = await provisionIntegrationScimToken("v2-okta", "OKTA");
    const entra = await provisionIntegrationScimToken("v2-entra", "ENTRA");
    oktaCtx = okta.ctx;
    entraCtx = entra.ctx;
    mintedTokenIds.push(okta.tokenId, entra.tokenId);

    const defaultRole = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
      select: { id: true },
    });
    if (!defaultRole) throw new Error("No default role configured");
    defaultRoleId = defaultRole.id;

    // NO_ACCESS default isolates the mapping's effect: without a grant the
    // member resolves to no role at all.
    const project = await db.projects.create({
      data: {
        name: `${PREFIX}-project`,
        createdBy: SCIM_SYSTEM_USER_ID,
        defaultAccessType: "NO_ACCESS",
      },
      select: { id: true },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    const sweepable = await db.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { id: true },
    });
    const sweepIds = sweepable.map((r) => r.id);

    if (createdGroupIds.length > 0) {
      await db.groupProjectAccessMapping.deleteMany({
        where: { groupId: { in: createdGroupIds } },
      });
      await db.groupProjectPermission.deleteMany({
        where: { groupId: { in: createdGroupIds } },
      });
      await db.groupAssignment.deleteMany({
        where: { groupId: { in: createdGroupIds } },
      });
      await db.groups.deleteMany({ where: { id: { in: createdGroupIds } } });
    }
    if (createdRoleValues.length > 0) {
      await db.scimRoleMapping.deleteMany({
        where: { roleValue: { in: createdRoleValues } },
      });
    }
    if (sweepIds.length > 0) {
      // Raw SQL rather than a typed JSON-path filter: ZenStack v3 models
      // `path` as a string, and the outbox discriminator is a JSON field
      // (`payload.id`) that the typed WhereInput does not express portably.
      await sql`
        DELETE FROM "WebhookOutboxEvent"
        WHERE "payload"->>'id' = ANY(${sql.val(sweepIds)})
      `.execute(db.$qb);
      await db.account.deleteMany({ where: { userId: { in: sweepIds } } });
      await db.user.deleteMany({ where: { id: { in: sweepIds } } });
    }
    if (projectId) {
      await db.projects.deleteMany({ where: { id: projectId } });
    }
    await cleanupIntegrationScimTokens(db, mintedTokenIds);
    await db.$disconnect();
  });

  /* ---------------------------------------------------------------- */
  /* HYBRID-01 — roles hybrid                                          */
  /* ---------------------------------------------------------------- */

  describe("roles hybrid", () => {
    it("V1: persists the roles attribute into the scimRoles text[] column", async () => {
      const created = await createScimUser(
        makeBody({ roles: [{ value: "QA-Lead" }, "Contractor"] } as never),
        oktaCtx
      );

      const row = await db.user.findUnique({
        where: { id: created.resource.id },
        select: { scimRoles: true },
      });

      expect(row!.scimRoles).toEqual(["qa-lead", "contractor"]);
    });

    it("V2: a mapped role drives the access tier on create", async () => {
      const roleValue = `${PREFIX}-lead`;
      createdRoleValues.push(roleValue);
      await db.scimRoleMapping.create({
        data: { roleValue, mappedAccess: "PROJECTADMIN" },
      });

      const created = await createScimUser(
        makeBody({ roles: [{ value: roleValue }] } as never),
        oktaCtx
      );

      const row = await db.user.findUnique({
        where: { id: created.resource.id },
        select: { access: true, accessSource: true },
      });
      expect(row!.access).toBe("PROJECTADMIN");
      expect(row!.accessSource).toBe("GROUP_MAPPING");
    });

    it("V3: an unmapped role value leaves the tier alone", async () => {
      const created = await createScimUser(
        makeBody({ roles: [{ value: `${PREFIX}-unmapped` }] } as never),
        oktaCtx
      );

      const row = await db.user.findUnique({
        where: { id: created.resource.id },
        select: { access: true },
      });
      // Falls back to the configured default rather than being demoted.
      expect(row!.access).toBe("NONE");
    });

    it("V4: a role tier beats a higher group tier through real SQL", async () => {
      const roleValue = `${PREFIX}-contractor`;
      createdRoleValues.push(roleValue);
      await db.scimRoleMapping.create({
        data: { roleValue, mappedAccess: "USER" },
      });

      const group = await db.groups.create({
        data: { name: `${PREFIX}-admins`, mappedAccess: "ADMIN" },
        select: { id: true },
      });
      createdGroupIds.push(group.id);

      const created = await createScimUser(
        makeBody({ roles: [{ value: roleValue }] } as never),
        oktaCtx
      );
      await db.groupAssignment.create({
        data: { userId: created.resource.id, groupId: group.id },
      });

      // Re-run resolution the way a membership change would.
      await putScimUser(
        created.resource.id,
        makeBody({
          userName: created.resource.userName!,
          roles: [{ value: roleValue }, { value: "extra" }],
        } as never),
        oktaCtx
      );

      const row = await db.user.findUnique({
        where: { id: created.resource.id },
        select: { access: true },
      });
      expect(row!.access).toBe("USER");
    });
  });

  /* ---------------------------------------------------------------- */
  /* V2-MULTI-IDP-01 — cross-IdP ownership                             */
  /* ---------------------------------------------------------------- */

  describe("cross-IdP ownership", () => {
    it("V5: stamps the provisioning token as a real foreign key", async () => {
      const created = await createScimUser(makeBody(), oktaCtx);

      const row = await db.user.findUnique({
        where: { id: created.resource.id },
        select: { scimTokenId: true },
      });
      expect(row!.scimTokenId).toBe(oktaCtx.tokenId);
    });

    it("V6: another IdP cannot overwrite the row", async () => {
      const created = await createScimUser(makeBody(), oktaCtx);

      await expect(
        putScimUser(
          created.resource.id,
          makeBody({
            userName: created.resource.userName!,
            active: false,
          }),
          entraCtx
        )
      ).rejects.toBeInstanceOf(ScimOwnershipError);

      const row = await db.user.findUnique({
        where: { id: created.resource.id },
        select: { isActive: true },
      });
      expect(row!.isActive).toBe(true);
    });

    it("V7: the relation filter hides another IdP's users from list", async () => {
      const created = await createScimUser(makeBody(), oktaCtx);

      const asOkta = await listScimUsers(
        { filter: `userName eq "${created.resource.userName}"` },
        oktaCtx
      );
      const asEntra = await listScimUsers(
        { filter: `userName eq "${created.resource.userName}"` },
        entraCtx
      );

      expect(asOkta.resources.map((r) => r.id)).toContain(created.resource.id);
      expect(asEntra.resources.map((r) => r.id)).not.toContain(
        created.resource.id
      );
    });

    it("V8: a sibling token for the same IdP may write — rotation must not lock a directory out", async () => {
      const created = await createScimUser(makeBody(), oktaCtx);
      const sibling = await provisionIntegrationScimToken("v2-okta-2", "OKTA");
      mintedTokenIds.push(sibling.tokenId);

      await expect(
        putScimUser(
          created.resource.id,
          makeBody({
            userName: created.resource.userName!,
            active: false,
          }),
          sibling.ctx
        )
      ).resolves.toBeDefined();

      const row = await db.user.findUnique({
        where: { id: created.resource.id },
        select: { isActive: true },
      });
      expect(row!.isActive).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- */
  /* D-08 — overlap-window rotation                                    */
  /* ---------------------------------------------------------------- */

  describe("overlap-window rotation", () => {
    function bearerRequest(plaintext: string): NextRequest {
      return new NextRequest("http://localhost:3000/api/scim/v2/Users", {
        headers: { authorization: `Bearer ${plaintext}` },
      });
    }

    it("V9: both the new and the superseded bearer authenticate during the window", async () => {
      const provisioned = await provisionIntegrationScimToken("v2-rot", "OKTA");
      mintedTokenIds.push(provisioned.tokenId);

      // Mint again to capture a plaintext we control, then rotate it.
      const rotated = await rotateScimToken(
        provisioned.tokenId,
        3_600_000,
        SCIM_SYSTEM_USER_ID
      );

      const viaNew = await requireScimBearer(bearerRequest(rotated.plaintext));
      expect(viaNew.tokenId).toBe(provisioned.tokenId);

      const secondRotation = await rotateScimToken(
        provisioned.tokenId,
        3_600_000,
        SCIM_SYSTEM_USER_ID
      );

      // The bearer superseded by the second rotation still resolves, and to
      // the SAME token row — same id, same IdP, same rate-limit bucket.
      const viaOld = await requireScimBearer(bearerRequest(rotated.plaintext));
      expect(viaOld.tokenId).toBe(provisioned.tokenId);
      expect(viaOld.idpName).toBe("OKTA");

      const viaNewest = await requireScimBearer(
        bearerRequest(secondRotation.plaintext)
      );
      expect(viaNewest.tokenId).toBe(provisioned.tokenId);
    });

    it("V10: an elapsed window rejects the superseded bearer", async () => {
      const provisioned = await provisionIntegrationScimToken(
        "v2-rot-exp",
        "OKTA"
      );
      mintedTokenIds.push(provisioned.tokenId);

      const rotated = await rotateScimToken(
        provisioned.tokenId,
        3_600_000,
        SCIM_SYSTEM_USER_ID
      );
      const superseded = rotated.plaintext;
      await rotateScimToken(
        provisioned.tokenId,
        3_600_000,
        SCIM_SYSTEM_USER_ID
      );

      // Wind the window back so the SQL predicate excludes it.
      await db.scimToken.update({
        where: { id: provisioned.tokenId },
        data: { previousTokenExpiresAt: new Date(Date.now() - 1000) },
      });

      await expect(
        requireScimBearer(bearerRequest(superseded))
      ).rejects.toThrow();
    });

    it("V11: a zero-overlap rotation clears the previous bearer columns", async () => {
      const provisioned = await provisionIntegrationScimToken(
        "v2-rot-none",
        "OKTA"
      );
      mintedTokenIds.push(provisioned.tokenId);

      await rotateScimToken(
        provisioned.tokenId,
        3_600_000,
        SCIM_SYSTEM_USER_ID
      );
      await rotateScimToken(provisioned.tokenId, 0, SCIM_SYSTEM_USER_ID);

      const row = await db.scimToken.findUnique({
        where: { id: provisioned.tokenId },
        select: { previousToken: true, previousTokenExpiresAt: true },
      });
      expect(row!.previousToken).toBeNull();
      expect(row!.previousTokenExpiresAt).toBeNull();
    });

    it("V12: rotation preserves provenance — the rotated token still owns its users", async () => {
      const provisioned = await provisionIntegrationScimToken(
        "v2-rot-own",
        "OKTA"
      );
      mintedTokenIds.push(provisioned.tokenId);

      const created = await createScimUser(makeBody(), provisioned.ctx);
      await rotateScimToken(
        provisioned.tokenId,
        3_600_000,
        SCIM_SYSTEM_USER_ID
      );

      const row = await db.user.findUnique({
        where: { id: created.resource.id },
        select: { scimTokenId: true },
      });
      expect(row!.scimTokenId).toBe(provisioned.tokenId);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Per-project access mapping                                        */
  /* ---------------------------------------------------------------- */

  describe("per-project access mapping", () => {
    async function makeGroupWithMember(label: string) {
      const group = await db.groups.create({
        data: { name: `${PREFIX}-${label}` },
        select: { id: true },
      });
      createdGroupIds.push(group.id);

      const email = nextEmail(label);
      const member = await db.user.create({
        data: {
          email,
          name: `${PREFIX} ${label}`,
          roleId: defaultRoleId,
          access: "USER",
        },
        select: { id: true },
      });
      await db.groupAssignment.create({
        data: { userId: member.id, groupId: group.id },
      });
      return { groupId: group.id, userId: member.id };
    }

    it("V13: a mapping materializes a derived GroupProjectPermission row", async () => {
      const { groupId } = await makeGroupWithMember("pm1");
      await db.groupProjectAccessMapping.create({
        data: { groupId, projectId, mappedAccess: "PROJECTADMIN" },
      });

      await db.$transaction(async (tx) => {
        await materializeGroupProjectMappings(tx, groupId);
      });

      const row = await db.groupProjectPermission.findUnique({
        where: { groupId_projectId: { groupId, projectId } },
      });
      expect(row).not.toBeNull();
      // GLOBAL_ROLE regardless of tier: a group row cannot confer
      // project-admin authority, and the mapping picks no role.
      expect(row!.accessType).toBe("GLOBAL_ROLE");
      expect(row!.roleId).toBeNull();
      expect(row!.derivedFromMapping).toBe(true);
    });

    it("V14: the materialized grant actually resolves through the permission engine", async () => {
      const { groupId, userId } = await makeGroupWithMember("pm2");

      // Baseline: the project denies by default, so the member has no role.
      const before = await resolveEffectiveProjectRoleId(
        userId,
        projectId,
        db as never
      );
      expect(before).toBeNull();

      await db.groupProjectAccessMapping.create({
        data: { groupId, projectId, mappedAccess: "PROJECTADMIN" },
      });
      await db.$transaction(async (tx) => {
        await materializeGroupProjectMappings(tx, groupId);
      });

      // The member carries their own global role onto the project.
      const after = await resolveEffectiveProjectRoleId(
        userId,
        projectId,
        db as never
      );
      expect(after).toBe(defaultRoleId);
    });

    it("V15: USER maps to GLOBAL_ROLE, so the member carries their own role onto the project", async () => {
      const { groupId, userId } = await makeGroupWithMember("pm3");
      await db.groupProjectAccessMapping.create({
        data: { groupId, projectId, mappedAccess: "USER" },
      });
      await db.$transaction(async (tx) => {
        await materializeGroupProjectMappings(tx, groupId);
      });

      const row = await db.groupProjectPermission.findUnique({
        where: { groupId_projectId: { groupId, projectId } },
      });
      expect(row!.accessType).toBe("GLOBAL_ROLE");

      const resolved = await resolveEffectiveProjectRoleId(
        userId,
        projectId,
        db as never
      );
      expect(resolved).toBe(defaultRoleId);
    });

    it("V16: removing the mapping withdraws the grant", async () => {
      const { groupId, userId } = await makeGroupWithMember("pm4");
      await db.groupProjectAccessMapping.create({
        data: { groupId, projectId, mappedAccess: "PROJECTADMIN" },
      });
      await db.$transaction(async (tx) => {
        await materializeGroupProjectMappings(tx, groupId);
      });
      expect(
        await resolveEffectiveProjectRoleId(userId, projectId, db as never)
      ).toBe(defaultRoleId);

      await db.groupProjectAccessMapping.deleteMany({
        where: { groupId, projectId },
      });
      await db.$transaction(async (tx) => {
        await materializeGroupProjectMappings(tx, groupId);
      });

      expect(
        await db.groupProjectPermission.findUnique({
          where: { groupId_projectId: { groupId, projectId } },
        })
      ).toBeNull();
      expect(
        await resolveEffectiveProjectRoleId(userId, projectId, db as never)
      ).toBeNull();
    });

    it("V17: a manually-assigned permission survives a mapping sweep", async () => {
      const { groupId } = await makeGroupWithMember("pm5");
      await db.groupProjectPermission.create({
        data: {
          groupId,
          projectId,
          accessType: "SPECIFIC_ROLE",
          roleId: defaultRoleId,
          derivedFromMapping: false,
        },
      });

      // No mapping for this group at all — the sweep must leave it alone.
      await db.$transaction(async (tx) => {
        await materializeGroupProjectMappings(tx, groupId);
      });

      const row = await db.groupProjectPermission.findUnique({
        where: { groupId_projectId: { groupId, projectId } },
      });
      expect(row).not.toBeNull();
      expect(row!.derivedFromMapping).toBe(false);
      expect(row!.roleId).toBe(defaultRoleId);
    });

    it("V18: re-running materialization is idempotent", async () => {
      const { groupId } = await makeGroupWithMember("pm6");
      await db.groupProjectAccessMapping.create({
        data: { groupId, projectId, mappedAccess: "ADMIN" },
      });

      for (let i = 0; i < 3; i += 1) {
        await db.$transaction(async (tx) => {
          await materializeGroupProjectMappings(tx, groupId);
        });
      }

      const rows = await db.groupProjectPermission.findMany({
        where: { groupId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].accessType).toBe("GLOBAL_ROLE");
    });
  });
});
