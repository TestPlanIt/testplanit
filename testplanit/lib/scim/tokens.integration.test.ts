/**
 * Live-DB integration tests for the SCIM tokens service.
 *
 * These cover the regression class that mocked-Prisma unit tests cannot catch:
 *   1. The full mint -> findUnique-by-hash -> decryptScimSecret roundtrip
 *      against the real `secret` column. If `encrypt` and `decrypt` ever
 *      drift (different key, different algo, different envelope shape) this
 *      test fails immediately; the unit tests would still pass because they
 *      mock `~/utils/encryption`.
 *   2. The revoke write-path actually lands the soft-revoke fields
 *      (isActive: false + revokedAt + revokedById) in the DB and not just on
 *      the in-memory result object.
 *   3. The synthetic `__scim__` User row is seeded and FK-targetable; the
 *      mint helper FKs `systemUserId` against the hardcoded
 *      `SCIM_SYSTEM_USER_ID` and will throw a foreign-key violation if the
 *      seed regressed.
 *
 * Prerequisite: the SCIM-token schema must be applied to the target
 * database (`pnpm generate` runs `zenstack db push` which materializes the
 * `ScimToken` table and the `IdpName` enum, AND `db/seed.ts` upserts the
 * `__scim__` User row). The test runner picks this file up via the
 * `*.integration.test.ts` glob in `vitest.config.mts`.
 *
 * Run via (requires a reachable DATABASE_URL):
 *   cd testplanit && RUN_DB_INTEGRATION=1 pnpm exec vitest run lib/scim/tokens.integration.test.ts
 *
 * Cleanup: every test row created here is deleted by id in `afterEach`. The
 * synthetic `__scim__` User row is NEVER deleted -- it's a permanent seed
 * row that downstream phases (07 Users CRUD, 08 Groups CRUD) FK against.
 *
 * Note on `@@unique([name, idpName])`: the base schema does NOT enforce
 * per-IdP name uniqueness; name uniqueness scope is an intentionally open
 * design question. This integration test deliberately does NOT assert P2002
 * on a duplicate (name, idpName); two mints with the same (name, idpName)
 * succeed. If a future change adds the unique constraint, a new test should
 * land here that asserts the P2002 surface.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";


import { hashToken } from "~/lib/api-tokens";
import {
  SCIM_SYSTEM_USER_EMAIL,
  SCIM_SYSTEM_USER_ID,
  SCIM_TOKEN_PREFIX,
} from "~/lib/scim/constants";
import {
  decryptScimSecret,
  getScimTokenById,
  listScimTokens,
  mintScimToken,
  revokeScimToken,
} from "./tokens";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();

describeIntegration("SCIM tokens service (live DB)", () => {
  let adminUserId: string;
  const createdTokenIds: string[] = [];

  beforeAll(async () => {
    // Ensure NEXTAUTH_SECRET is set for hashToken; if a developer runs this
    // without the seeded `.env`, the helper would throw before any DB call.
    if (!process.env.NEXTAUTH_SECRET && !process.env.API_TOKEN_SECRET) {
      process.env.NEXTAUTH_SECRET =
        "integration-test-secret-for-scim-token-hashing";
    }

    // Reuse any existing seeded non-SCIM User as the `createdById` FK target.
    // We pick the first non-system user so the test does not depend on a
    // specific seed identity.
    const admin = await db.user.findFirst({
      where: { id: { not: SCIM_SYSTEM_USER_ID } },
    });
    if (!admin) {
      throw new Error(
        "Integration test prerequisite failed: no non-SCIM User row found. " +
          "Run `pnpm generate` (which runs db/seed.ts) before this test."
      );
    }
    adminUserId = admin.id;
  });

  afterEach(async () => {
    if (createdTokenIds.length === 0) return;
    await db.scimToken.deleteMany({
      where: { id: { in: createdTokenIds.splice(0) } },
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("mints a token whose hash matches the DB row, whose secret decrypts to the plaintext, and whose systemUserId targets the seeded synthetic User", async () => {
    const { token, plaintext } = await mintScimToken({
      name: `integration-mint-${Date.now()}`,
      idpName: "OKTA",
      expiresAt: null,
      createdById: adminUserId,
    });
    createdTokenIds.push(token.id);

    // plaintext is the show-once tps_ bearer
    expect(plaintext.startsWith(SCIM_TOKEN_PREFIX)).toBe(true);
    expect(plaintext.length).toBeGreaterThan(40);

    // findUnique by hash returns the same row we just minted
    const byHash = await db.scimToken.findUnique({
      where: { token: hashToken(plaintext) },
    });
    expect(byHash).not.toBeNull();
    expect(byHash!.id).toBe(token.id);

    // The DB `secret` column is encrypted -- NOT equal to the plaintext.
    expect(byHash!.secret).not.toBe(plaintext);
    expect(byHash!.secret.length).toBeGreaterThan(plaintext.length);

    // decryptScimSecret round-trips the stored ciphertext back to plaintext
    const decrypted = await decryptScimSecret(byHash!.secret);
    expect(decrypted).toBe(plaintext);

    // The hardcoded systemUserId targets the seeded synthetic SCIM User
    expect(byHash!.systemUserId).toBe(SCIM_SYSTEM_USER_ID);
    expect(byHash!.createdById).toBe(adminUserId);
    expect(byHash!.isActive).toBe(true);
    expect(byHash!.revokedAt).toBeNull();
    expect(byHash!.revokedById).toBeNull();
    expect(byHash!.tokenPrefix).toBe(plaintext.substring(0, 12));
  });

  it("revoke sets isActive: false + revokedAt + revokedById in the DB row", async () => {
    const { token } = await mintScimToken({
      name: `integration-revoke-${Date.now()}`,
      idpName: "ENTRA",
      expiresAt: null,
      createdById: adminUserId,
    });
    createdTokenIds.push(token.id);

    await revokeScimToken(token.id, adminUserId);

    const after = await db.scimToken.findUnique({
      where: { id: token.id },
    });
    expect(after).not.toBeNull();
    expect(after!.isActive).toBe(false);
    expect(after!.revokedAt).toBeInstanceOf(Date);
    expect(after!.revokedById).toBe(adminUserId);
  });

  it("listScimTokens filters revoked rows by default and includes them when showRevoked: true", async () => {
    const namePrefix = `integration-list-${Date.now()}`;

    const active = await mintScimToken({
      name: `${namePrefix}-active`,
      idpName: "ONELOGIN",
      expiresAt: null,
      createdById: adminUserId,
    });
    createdTokenIds.push(active.token.id);

    const revoked = await mintScimToken({
      name: `${namePrefix}-revoked`,
      idpName: "ONELOGIN",
      expiresAt: null,
      createdById: adminUserId,
    });
    createdTokenIds.push(revoked.token.id);
    await revokeScimToken(revoked.token.id, adminUserId);

    const defaultList = await listScimTokens({
      showRevoked: false,
      search: namePrefix,
    });
    const defaultIds = defaultList.map((r) => r.id);
    expect(defaultIds).toContain(active.token.id);
    expect(defaultIds).not.toContain(revoked.token.id);

    const fullList = await listScimTokens({
      showRevoked: true,
      search: namePrefix,
    });
    const fullIds = fullList.map((r) => r.id);
    expect(fullIds).toContain(active.token.id);
    expect(fullIds).toContain(revoked.token.id);
  });

  it("getScimTokenById returns the row when it exists and null otherwise", async () => {
    const { token } = await mintScimToken({
      name: `integration-get-${Date.now()}`,
      idpName: "OTHER",
      expiresAt: null,
      createdById: adminUserId,
    });
    createdTokenIds.push(token.id);

    const found = await getScimTokenById(token.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(token.id);

    const missing = await getScimTokenById("definitely-not-a-real-cuid");
    expect(missing).toBeNull();
  });

  it("the synthetic __scim__ User row is seeded with the expected shape", async () => {
    const scimUser = await db.user.findUnique({
      where: { email: SCIM_SYSTEM_USER_EMAIL },
    });
    expect(scimUser).not.toBeNull();
    expect(scimUser!.id).toBe(SCIM_SYSTEM_USER_ID);
    expect(scimUser!.access).toBe("USER");
    expect(scimUser!.isActive).toBe(false);
  });
});
