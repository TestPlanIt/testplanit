import { expect, test } from "../../../fixtures";

/**
 * SSO Provider Management E2E Tests
 *
 * Tests that verify admin SSO configuration functionality:
 * - Viewing the SSO admin page
 * - Configuring Google OAuth provider
 * - Toggling Force SSO setting
 * - Managing email domain restrictions
 */

// Every test here mutates the single global SsoProvider table, and a stray
// forceSso=true hides the password form for every later sign-in in the suite.
// Run this file's tests in order on one worker instead of letting
// fullyParallel interleave their setup and cleanup.
test.describe.configure({ mode: "default" });

type ApiRequest = import("@playwright/test").APIRequestContext;

async function listGoogleProviderIds(
  request: ApiRequest,
  baseURL: string
): Promise<string[]> {
  const res = await request.get(`${baseURL}/api/model/ssoProvider/findMany`, {
    params: {
      q: JSON.stringify({ where: { type: "GOOGLE" }, select: { id: true } }),
    },
  });
  if (!res.ok()) return [];
  const body = await res.json();
  return (body?.data ?? []).map((provider: { id: string }) => provider.id);
}

async function listProviderForceSso(
  request: ApiRequest,
  baseURL: string
): Promise<Map<string, boolean>> {
  const res = await request.get(`${baseURL}/api/model/ssoProvider/findMany`, {
    params: { q: JSON.stringify({ select: { id: true, forceSso: true } }) },
  });
  if (!res.ok()) return new Map();
  const body = await res.json();
  return new Map(
    (body?.data ?? []).map((provider: { id: string; forceSso: boolean }) => [
      provider.id,
      provider.forceSso,
    ])
  );
}

// ZenStack's RPC handler reads delete args from the `q` query param and only
// accepts the DELETE method; a POST here would silently return 400.
async function deleteSsoProvider(
  request: ApiRequest,
  baseURL: string,
  id: string
): Promise<void> {
  await request
    .delete(`${baseURL}/api/model/ssoProvider/delete`, {
      params: { q: JSON.stringify({ where: { id } }) },
    })
    .catch(() => {});
}

test.describe("Admin SSO Provider Management", () => {
  test("Admin can view SSO configuration page", async ({ page }) => {
    await test.step("Open the SSO admin page", async () => {
      await page.goto("/en-US/admin/sso");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify SSO page, providers, and security sections render", async () => {
      // Verify page loads with SSO page title (data-testid="sso-page-title")
      const pageTitle = page.getByTestId("sso-page-title");
      await expect(pageTitle).toBeVisible({ timeout: 10000 });

      // Verify sign-in providers section is visible
      const providersSection = page.getByText("Sign-in Providers");
      await expect(providersSection).toBeVisible({ timeout: 10000 });

      // Verify security settings card
      const securitySection = page.getByText("Security").first();
      await expect(securitySection).toBeVisible({ timeout: 5000 });
    });
  });

  test("Admin can view and interact with Google OAuth provider", async ({
    page,
  }) => {
    await test.step("Open the SSO admin page and verify the Google OAuth section", async () => {
      await page.goto("/en-US/admin/sso");
      await page.waitForLoadState("networkidle");

      // Find Google OAuth section — use exact: true to avoid strict mode violation
      const googleLabel = page
        .getByText("Google OAuth", { exact: true })
        .first();
      await expect(googleLabel).toBeVisible({ timeout: 10000 });
    });

    await test.step("Open the Google config dialog, verify inputs, then close it", async () => {
      // Find the Setup/Edit button for Google — button with "Setup" or "Edit" text
      const googleSetupBtn = page
        .getByRole("button", { name: /setup|edit|configure/i })
        .first();
      const isSetupVisible = await googleSetupBtn
        .isVisible()
        .catch(() => false);

      if (isSetupVisible) {
        // Click to open the Google config dialog
        await googleSetupBtn.click();

        // Verify dialog opens
        const dialog = page.locator('[role="dialog"]');
        await expect(dialog).toBeVisible({ timeout: 5000 });

        // Check dialog has input fields
        const inputs = dialog.locator("input");
        const inputCount = await inputs.count();
        expect(inputCount).toBeGreaterThanOrEqual(2);

        // Close dialog with Escape
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible({ timeout: 5000 });
      }
    });
  });

  test("Admin can configure Google OAuth with client credentials", async ({
    page,
    request,
    baseURL,
  }) => {
    // Remember the Google providers that existed before the test so cleanup
    // removes exactly the rows this test created and restores the rest.
    const existingProviderIds = new Set(
      await listGoogleProviderIds(request, baseURL!)
    );

    try {
      const dialog = page.locator('[role="dialog"]');

      await test.step("Open the Google OAuth config dialog", async () => {
        await page.goto("/en-US/admin/sso");
        await page.waitForLoadState("networkidle");

        // Find the Setup/Edit button for Google OAuth
        const setupBtn = page
          .getByRole("button", { name: /setup|edit|configure/i })
          .first();
        await expect(setupBtn).toBeVisible({ timeout: 10000 });
        await setupBtn.click();

        // Verify dialog opens
        await expect(dialog).toBeVisible({ timeout: 5000 });
      });

      await test.step("Enter client credentials, save, and verify Configured badge", async () => {
        // Fill client ID and secret
        const inputs = dialog.locator("input");
        await inputs.nth(0).fill("test-client-id-e2e");
        await inputs.nth(1).fill("test-client-secret-e2e");

        // Submit
        const saveBtn = dialog
          .getByRole("button", { name: /save|submit/i })
          .first();
        await saveBtn.click();

        // Wait for dialog to close
        await expect(dialog).not.toBeVisible({ timeout: 10000 });

        // Page should show "Configured" badge
        const configuredBadge = page.getByText("Configured").first();
        await expect(configuredBadge).toBeVisible({ timeout: 10000 });
      });
    } finally {
      for (const id of await listGoogleProviderIds(request, baseURL!)) {
        if (existingProviderIds.has(id)) {
          await request
            .patch(`${baseURL}/api/model/ssoProvider/update`, {
              data: { where: { id }, data: { config: null, enabled: false } },
            })
            .catch(() => {});
        } else {
          await deleteSsoProvider(request, baseURL!, id);
        }
      }
    }
  });

  test("Admin can toggle Force SSO setting", async ({
    page,
    request,
    baseURL,
  }) => {
    // Always create a provider of our own for the toggle to write to. Other
    // spec files create and delete providers concurrently, so one that merely
    // exists right now can be gone before the Security page loads or the
    // toggle writes, leaving nothing to update and nothing to verify.
    const createRes = await request.post(
      `${baseURL}/api/model/ssoProvider/create`,
      {
        data: {
          data: {
            name: `google-temp-e2e-${Date.now()}`,
            type: "GOOGLE",
            enabled: false,
            forceSso: false,
            config: { clientId: "temp-e2e", clientSecret: "temp-e2e" },
          },
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const createdProviderId: string | null =
      (await createRes.json())?.data?.id ?? null;
    expect(createdProviderId).toBeTruthy();

    // The toggle only writes to the providers the Security page had loaded,
    // so verify the flag on ours plus whatever else existed before the page
    // loads, ignoring any that another spec deletes in the meantime.
    const trackedIds = Array.from(
      new Set([
        createdProviderId!,
        ...(await listProviderForceSso(request, baseURL!)).keys(),
      ])
    );
    const trackedFlagsAre = async (expected: boolean) => {
      const current = await listProviderForceSso(request, baseURL!);
      const present = trackedIds.filter((id) => current.has(id));
      return (
        present.length > 0 &&
        present.every((id) => current.get(id) === expected)
      );
    };

    let forceSsoSwitch: ReturnType<typeof page.locator> | undefined;
    let initialState: string | null = null;

    try {
      await test.step("Open the Security page and capture the Force SSO switch state", async () => {
        // The Force SSO toggle lives in the Sign-in Enforcement section of the
        // Security admin page (/admin/security), not the SSO/Authentication page.
        await page.goto("/en-US/admin/security");
        await page.waitForLoadState("networkidle");
        // Wait a moment for the useFindManySsoProvider hook to populate the ssoProviders array
        await page.waitForTimeout(1000);

        // The Force SSO switch is rendered as <Switch id="forceSso" /> paired with
        // a <Label htmlFor="forceSso"> ("Force SSO Login"). Target the switch by id.
        forceSsoSwitch = page.locator('button[role="switch"]#forceSso').first();

        await expect(forceSsoSwitch).toBeVisible({ timeout: 20000 });

        initialState = await forceSsoSwitch.getAttribute("data-state");
      });

      const initiallyOn = initialState === "checked";

      await test.step("Toggle Force SSO and confirm every provider is updated", async () => {
        // The switch flips optimistically and the handler writes forceSso to
        // every provider, so confirm the writes landed through the API before
        // toggling back; otherwise the two batches of updates can overlap.
        await forceSsoSwitch!.click();
        await expect(forceSsoSwitch!).toHaveAttribute(
          "data-state",
          initiallyOn ? "unchecked" : "checked",
          { timeout: 15000 }
        );
        await expect
          .poll(() => trackedFlagsAre(!initiallyOn), {
            message:
              "the pre-existing SSO providers should reflect the toggled Force SSO",
            timeout: 15000,
          })
          .toBe(true);
      });

      await test.step("Toggle Force SSO back and confirm every provider is restored", async () => {
        await forceSsoSwitch!.click();
        await expect(forceSsoSwitch!).toHaveAttribute(
          "data-state",
          initiallyOn ? "checked" : "unchecked",
          { timeout: 15000 }
        );
        await expect
          .poll(() => trackedFlagsAre(initiallyOn), {
            message:
              "the pre-existing SSO providers should be back to their original Force SSO",
            timeout: 15000,
          })
          .toBe(true);
      });
    } finally {
      // A leftover forceSso=true hides the password form for the rest of the
      // suite, so clear it on every provider even if the test failed midway.
      if (initialState !== "checked") {
        await request
          .patch(`${baseURL}/api/model/ssoProvider/updateMany`, {
            data: { where: {}, data: { forceSso: false } },
          })
          .catch(() => {});
      }
      if (createdProviderId) {
        await deleteSsoProvider(request, baseURL!, createdProviderId);
      }
    }
  });

  test("Admin can manage email domain restrictions", async ({
    page,
    request,
    baseURL,
  }) => {
    const testDomain = `e2etest${Date.now()}.com`;
    let createdDomainId: string | null = null;
    let isRestrictionEnabled = false;

    try {
      await test.step("Open the SSO page and enable email domain restriction", async () => {
        await page.goto("/en-US/admin/sso");
        await page.waitForLoadState("networkidle");

        // Find "Restrict Email Domains" label
        const restrictLabel = page.getByText("Restrict Email Domains");
        await expect(restrictLabel).toBeVisible({ timeout: 10000 });

        // Get the switch for domain restriction (sibling of the label container)
        const restrictContainer = restrictLabel.locator("../.."); // grandparent
        const restrictSwitch = restrictContainer
          .locator('button[role="switch"]')
          .first();

        isRestrictionEnabled =
          (await restrictSwitch.getAttribute("data-state")) === "checked";

        if (!isRestrictionEnabled) {
          await restrictSwitch.click();
          await page.waitForTimeout(1500);
          // Verify it's now enabled
          await expect(restrictSwitch).toHaveAttribute(
            "data-state",
            "checked",
            {
              timeout: 5000,
            }
          );
        }
      });

      await test.step("Add the test email domain and verify it appears", async () => {
        // Domain input should now be visible
        const domainInput = page.locator("input[placeholder]").last();
        await expect(domainInput).toBeVisible({ timeout: 5000 });

        // Type the test domain
        await domainInput.fill(testDomain);

        // Click Add button
        const addBtn = page.getByRole("button", { name: /add/i }).last();
        await addBtn.click();
        await page.waitForTimeout(1500);

        // The domain should appear in the list
        const domainEntry = page.getByText(testDomain);
        await expect(domainEntry).toBeVisible({ timeout: 5000 });
      });

      await test.step("Capture the created domain ID for cleanup", async () => {
        // Get the created domain ID for cleanup
        try {
          const domainRes = await request.get(
            `${baseURL}/api/model/allowedEmailDomain/findFirst`,
            {
              params: {
                q: JSON.stringify({
                  where: { domain: testDomain },
                  select: { id: true },
                }),
              },
            }
          );
          if (domainRes.ok()) {
            const domainData = await domainRes.json();
            createdDomainId = domainData?.data?.id ?? null;
          }
        } catch {
          // Non-fatal
        }
      });

      await test.step("Delete the test email domain and verify removal", async () => {
        // Delete the domain via the X button
        // The domain list row structure: div > { span(domain text), div > { switch, button(X) } }
        // Find the X button (last button in the container that shows the domain text)
        const domainSpan = page.getByText(testDomain, { exact: true });
        await expect(domainSpan).toBeVisible({ timeout: 3000 });
        // Navigate to the delete button — it's a sibling's last child button
        const domainRowContainer = domainSpan.locator("../../.."); // Go up to the row div
        const deleteBtn = domainRowContainer.locator("button").last();
        await deleteBtn.click();
        await page.waitForTimeout(1500);

        // Domain should no longer be visible
        await expect(page.getByText(testDomain)).not.toBeVisible({
          timeout: 5000,
        });
      });

      await test.step("Disable domain restriction if the test enabled it", async () => {
        // Disable domain restriction if we enabled it
        if (!isRestrictionEnabled) {
          const restrictSwitchAfter = page
            .getByText("Restrict Email Domains")
            .locator("../..")
            .locator('button[role="switch"]')
            .first();
          const currentState =
            await restrictSwitchAfter.getAttribute("data-state");
          if (currentState === "checked") {
            await restrictSwitchAfter.click();
            await page.waitForTimeout(1000);
          }
        }
      });
    } finally {
      // Clean up domain via API if it still exists
      if (createdDomainId) {
        try {
          await request.delete(
            `${baseURL}/api/model/allowedEmailDomain/delete`,
            {
              params: { q: JSON.stringify({ where: { id: createdDomainId } }) },
            }
          );
        } catch {
          // Non-fatal
        }
      }
    }
  });

  test("Admin can view Microsoft and SAML provider sections", async ({
    page,
  }) => {
    await test.step("Open the SSO admin page", async () => {
      await page.goto("/en-US/admin/sso");
      await page.waitForLoadState("networkidle");
    });

    await test.step("Verify Microsoft, SAML, and Magic Link provider sections render", async () => {
      // Verify Microsoft SSO section is present
      const microsoftSection = page.getByText("Microsoft SSO");
      await expect(microsoftSection).toBeVisible({ timeout: 10000 });

      // Verify SAML section is present
      const samlSection = page.getByText("SAML Provider");
      await expect(samlSection).toBeVisible({ timeout: 10000 });

      // Verify Magic Link section is present
      const magicLinkSection = page.getByText("Magic Link Authentication");
      await expect(magicLinkSection).toBeVisible({ timeout: 10000 });
    });
  });
});
