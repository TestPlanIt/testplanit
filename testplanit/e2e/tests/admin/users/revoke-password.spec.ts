import { expect, test } from "../../../fixtures";

const TEST_EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN || "example.com";

/**
 * Revoke Password — real Prisma path.
 *
 * The existing route unit test mocks `db.user.update` via `vi.fn()`, which
 * silently accepts any call shape. That mask hid a real Prisma
 * `PrismaClientValidationError` at runtime: the generated schema used to
 * declare `password` non-nullable, so `db.user.update({ data: { password:
 * null } })` threw "Argument `password` must not be null" before any SQL
 * was sent. Users hit HTTP 500 when revoking.
 *
 * This e2e drives the real route → real Prisma client → real DB, which is
 * the only path that can catch that class of bug. If the schema field
 * regresses to non-nullable, this test fails with a 500.
 */
test.describe("Admin revoke password", () => {
  test("clears the user's password through the real Prisma path", async ({
    page,
    api,
    baseURL,
  }) => {
    // Ensure a MAGIC_LINK SsoProvider is enabled — the route's pre-flight
    // rejects revocation when no passwordless login method is configured.
    let providerId: string | null = null;
    let createdProvider = false;
    await test.step("Ensure a MAGIC_LINK SSO provider is enabled", async () => {
      const findRes = await page.request.get(
        `${baseURL}/api/model/ssoProvider/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { type: "MAGIC_LINK", enabled: true },
              select: { id: true },
            }),
          },
        }
      );
      if (findRes.ok()) {
        providerId = (await findRes.json()).data?.id ?? null;
      }
      if (!providerId) {
        const createRes = await page.request.post(
          `${baseURL}/api/model/ssoProvider/create`,
          {
            data: {
              data: {
                name: `magic-link-revoketest-${Date.now()}`,
                type: "MAGIC_LINK",
                enabled: true,
                config: {},
              },
            },
          }
        );
        expect(createRes.ok()).toBeTruthy();
        providerId = (await createRes.json()).data?.id ?? null;
        expect(providerId).toBeTruthy();
        createdProvider = true;
      }
    });

    const timestamp = Date.now();
    const testEmail = `revoke-pw-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    let userId: string | undefined;
    await test.step("Create a test user with a password", async () => {
      const userResult = await api.createUser({
        name: `Revoke PW User ${timestamp}`,
        email: testEmail,
        password: "LongEnoughPassword123!",
      });
      userId = userResult.data.id;
    });

    try {
      await test.step("Revoke the password through the real endpoint", async () => {
        // Call the real endpoint. Before the schema fix, this returned 500
        // with PrismaClientValidationError ("Argument `password` must not be
        // null"). Asserting a 200 response directly catches that regression —
        // the bug is the failure, not any downstream user-visible symptom.
        const revokeRes = await page.request.post(
          `${baseURL}/api/admin/users/${userId}/revoke-password`
        );
        expect(
          revokeRes.status(),
          `revoke-password returned ${revokeRes.status()}: ${await revokeRes.text()}`
        ).toBe(200);
        expect((await revokeRes.json()).success).toBe(true);
      });

      await test.step("Confirm the password change was persisted to the DB", async () => {
        // Confirm the side-effect: passwordChangedAt was updated (the route
        // always sets this when it succeeds). We can't observe `password`
        // directly because it is `@omit`, but this proves the UPDATE reached
        // the DB — which is enough to catch any future Prisma rejection of
        // the same payload shape.
        const userRes = await page.request.get(
          `${baseURL}/api/model/user/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: { id: userId },
                select: { passwordChangedAt: true, mustChangePassword: true },
              }),
            },
          }
        );
        expect(userRes.ok()).toBeTruthy();
        const userData = (await userRes.json()).data;
        expect(userData?.passwordChangedAt).toBeTruthy();
        expect(userData?.mustChangePassword).toBe(false);
      });
    } finally {
      await api.deleteUser(userId!);
      if (createdProvider && providerId) {
        await page.request
          .delete(`${baseURL}/api/model/ssoProvider/delete`, {
            params: { q: JSON.stringify({ where: { id: providerId } }) },
          })
          .catch(() => {});
      }
    }
  });
});
