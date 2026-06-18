import { expect, test } from "../../../fixtures";

const TEST_EMAIL_DOMAIN = process.env.TEST_EMAIL_DOMAIN || "example.com";

/**
 * Admin AddUser — optional password when magic link is configured.
 *
 * Proves the new behavior: when an enabled MAGIC_LINK SsoProvider exists (or
 * the email server is configured), the AddUser form labels the password
 * field as "(Optional)" and lets admins create a user with a blank password.
 * The client falls back to `crypto.randomUUID()` so the `@password` attribute
 * still hashes an unusable secret; the new user is expected to sign in via
 * magic link / SSO instead.
 *
 * Mirror of the revoke-password pre-flight check (see
 * app/api/admin/users/[userId]/revoke-password/route.ts).
 */
test.describe("AddUser optional password (magic link configured)", () => {
  test("admin can create a user with a blank password", async ({
    page,
    api,
    baseURL,
  }) => {
    const timestamp = Date.now();
    const testEmail = `add-blank-pw-${timestamp}@${TEST_EMAIL_DOMAIN}`;
    const testName = `Blank PW User ${timestamp}`;

    // Ensure a MAGIC_LINK SsoProvider is enabled. page.request inherits the
    // admin storage state, so these model calls are authenticated.
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
        const data = await findRes.json();
        providerId = data.data?.id ?? null;
      }
      if (!providerId) {
        const createRes = await page.request.post(
          `${baseURL}/api/model/ssoProvider/create`,
          {
            data: {
              data: {
                name: `magic-link-addusertest-${timestamp}`,
                type: "MAGIC_LINK",
                enabled: true,
                config: {},
              },
            },
          }
        );
        expect(createRes.ok()).toBeTruthy();
        const created = await createRes.json();
        providerId = created.data?.id ?? null;
        expect(providerId).toBeTruthy();
        createdProvider = true;
      }
    });

    let createdUserId: string | null = null;

    try {
      await test.step("Open the Add User dialog", async () => {
        await page.goto("/en-US/admin/users");
        await page.waitForLoadState("networkidle");

        const addButton = page.getByRole("button", { name: /add/i }).first();
        await expect(addButton).toBeVisible({ timeout: 10000 });
        await addButton.click();

        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible({ timeout: 5000 });
      });

      await test.step("Submit the form with a blank password", async () => {
        const dialog = page.getByRole("dialog");

        // The password label should gain an "(Optional)" marker — this is the
        // user-visible signal that the form recognized the passwordless login
        // path. If the MAGIC_LINK provider check broke, the label stays
        // required and this assertion fails fast.
        await expect(dialog.getByText(/\(optional\)/i).first()).toBeVisible({
          timeout: 5000,
        });

        await dialog.getByPlaceholder(/^name$/i).fill(testName);
        await dialog.getByPlaceholder(/^email$/i).fill(testEmail);
        // Intentionally leave password + confirmPassword blank.

        await dialog.getByRole("button", { name: /^submit$/i }).click();

        // Dialog closes on a successful create.
        await expect(dialog).not.toBeVisible({ timeout: 15000 });
      });

      await test.step("Verify the new user appears in the admin list", async () => {
        await page.waitForLoadState("networkidle");
        await expect(page.getByText(testEmail).first()).toBeVisible({
          timeout: 10000,
        });
      });

      await test.step("Capture the new user ID for cleanup", async () => {
        const userRes = await page.request.get(
          `${baseURL}/api/model/user/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: { email: testEmail },
                select: { id: true },
              }),
            },
          }
        );
        if (userRes.ok()) {
          createdUserId = (await userRes.json()).data?.id ?? null;
        }
        expect(createdUserId).toBeTruthy();
      });
    } finally {
      if (createdUserId) {
        await api.deleteUser(createdUserId);
      }
      if (createdProvider && providerId) {
        await page.request
          .post(`${baseURL}/api/model/ssoProvider/delete`, {
            data: { where: { id: providerId } },
          })
          .catch(() => {});
      }
    }
  });
});
