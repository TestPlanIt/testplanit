// Live-DB integration tests for AuthenticationService.storeUserAuth.
//
// These guard the per-user OAuth token persistence path against the real
// `@@unique([userId, integrationId])` constraint on UserIntegrationAuth. A
// mocked-Prisma test cannot catch the regression these cover: storing auth a
// second time for the same (user, integration) must UPDATE the existing row,
// not create a second one (which fails with Postgres unique-violation P2002).
// This is exactly the bug that surfaced only during live OAuth re-authorization
// and token refresh — see feedback_prisma_helper_live_db_test.
//
// Run via (requires the dev DB seeded by `pnpm generate`):
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test AuthenticationService.integration --run
//
// Cleanup: the throwaway Integration created here is deleted in afterAll, which
// cascades its UserIntegrationAuth rows (onDelete: Cascade).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";

import { AuthenticationService } from "./AuthenticationService";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const prisma = createRawDbClient();

describeIntegration("AuthenticationService.storeUserAuth (live DB)", () => {
  let userId: string;
  let integrationId: number;

  beforeAll(async () => {
    // Reuse an existing seeded user as the FK target (never created here).
    const user = await prisma.user.findFirstOrThrow();
    userId = user.id;

    // Throwaway OAuth integration so the (userId, integrationId) pair is unique
    // to this test and can be cascade-deleted afterward.
    const integration = await prisma.integration.create({
      data: {
        name: `oauth-upsert-test-${Date.now()}`,
        provider: "GITEA",
        authType: "OAUTH2",
        status: "ACTIVE",
        credentials: {},
        settings: {},
      },
    });
    integrationId = integration.id;
  });

  afterAll(async () => {
    if (integrationId) {
      await prisma.integration.delete({ where: { id: integrationId } });
    }
    await prisma.$disconnect();
  });

  it("creates a single active row on first authorization", async () => {
    await AuthenticationService.storeUserAuth(userId, integrationId, {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const rows = await prisma.userIntegrationAuth.findMany({
      where: { userId, integrationId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(true);
  });

  it("updates in place on re-authorization without violating the unique constraint", async () => {
    // Second store for the same (user, integration). The old deactivate-then-
    // create implementation threw P2002 here; the upsert must not.
    await expect(
      AuthenticationService.storeUserAuth(userId, integrationId, {
        accessToken: "access-2",
        refreshToken: "refresh-2",
        expiresAt: new Date(Date.now() + 3600_000),
      })
    ).resolves.not.toThrow();

    const rows = await prisma.userIntegrationAuth.findMany({
      where: { userId, integrationId },
    });
    expect(rows).toHaveLength(1);

    // The stored token is the new one (decrypted round-trip).
    const auth = await AuthenticationService.getUserAuth(userId, integrationId);
    expect(auth?.accessToken).toBe("access-2");
    expect(auth?.refreshToken).toBe("refresh-2");
  });

  it("reactivates and updates an inactive row (re-auth after revoke)", async () => {
    await prisma.userIntegrationAuth.updateMany({
      where: { userId, integrationId },
      data: { isActive: false },
    });

    await expect(
      AuthenticationService.storeUserAuth(userId, integrationId, {
        accessToken: "access-3",
      })
    ).resolves.not.toThrow();

    const rows = await prisma.userIntegrationAuth.findMany({
      where: { userId, integrationId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(true);
    const auth = await AuthenticationService.getUserAuth(userId, integrationId);
    expect(auth?.accessToken).toBe("access-3");
  });
});
