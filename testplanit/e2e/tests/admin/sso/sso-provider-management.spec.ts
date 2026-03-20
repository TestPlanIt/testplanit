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

test.describe("Admin SSO Provider Management", () => {
  test("Admin can view SSO configuration page", async ({ page }) => {
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

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

  test("Admin can view and interact with Google OAuth provider", async ({
    page,
  }) => {
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

    // Find Google OAuth section — use exact: true to avoid strict mode violation
    const googleLabel = page.getByText("Google OAuth", { exact: true }).first();
    await expect(googleLabel).toBeVisible({ timeout: 10000 });

    // Find the Setup/Edit button for Google — button with "Setup" or "Edit" text
    const googleSetupBtn = page
      .getByRole("button", { name: /setup|edit/i })
      .first();
    const isSetupVisible = await googleSetupBtn.isVisible().catch(() => false);

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

  test("Admin can configure Google OAuth with client credentials", async ({
    page,
    request,
    baseURL,
  }) => {
    // Track existing Google provider to restore state
    let existingProviderId: string | null = null;
    try {
      const listRes = await request.get(
        `${baseURL}/api/model/ssoProvider/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: { type: "GOOGLE" },
              select: { id: true },
            }),
          },
        }
      );
      if (listRes.ok()) {
        const data = await listRes.json();
        if (data?.data?.id) {
          existingProviderId = data.data.id;
        }
      }
    } catch {
      // No existing provider
    }

    try {
      await page.goto("/en-US/admin/sso");
      await page.waitForLoadState("networkidle");

      // Find the Setup/Edit button for Google OAuth
      const setupBtn = page.getByRole("button", { name: /setup|edit/i }).first();
      await expect(setupBtn).toBeVisible({ timeout: 10000 });
      await setupBtn.click();

      // Verify dialog opens
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Fill client ID and secret
      const inputs = dialog.locator("input");
      await inputs.nth(0).fill("test-client-id-e2e");
      await inputs.nth(1).fill("test-client-secret-e2e");

      // Submit
      const saveBtn = dialog.getByRole("button", { name: /save|submit/i }).first();
      await saveBtn.click();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 10000 });

      // Page should show "Configured" badge
      const configuredBadge = page.getByText("Configured").first();
      await expect(configuredBadge).toBeVisible({ timeout: 10000 });
    } finally {
      // Clean up Google provider
      try {
        const findRes = await request.get(
          `${baseURL}/api/model/ssoProvider/findFirst`,
          {
            params: {
              q: JSON.stringify({
                where: { type: "GOOGLE" },
                select: { id: true },
              }),
            },
          }
        );
        if (findRes.ok()) {
          const found = await findRes.json();
          const providerId = found?.data?.id;
          if (providerId && providerId !== existingProviderId) {
            await request.post(`${baseURL}/api/model/ssoProvider/delete`, {
              data: { where: { id: providerId } },
            });
          } else if (providerId) {
            await request.post(`${baseURL}/api/model/ssoProvider/update`, {
              data: {
                where: { id: providerId },
                data: { config: null, enabled: false },
              },
            });
          }
        }
      } catch {
        // Non-fatal
      }
    }
  });

  test("Admin can toggle Force SSO setting", async ({
    page,
    request,
    baseURL,
  }) => {
    // Ensure at least one SSO provider exists so the Force SSO toggle has something to update
    let createdProviderId: string | null = null;
    try {
      const findRes = await request.get(
        `${baseURL}/api/model/ssoProvider/findFirst`,
        {
          params: {
            q: JSON.stringify({
              where: {},
              select: { id: true },
            }),
          },
        }
      );
      const found = findRes.ok() ? await findRes.json() : null;
      if (!found?.data?.id) {
        // Create a temporary Google provider so we have something to toggle
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
        if (createRes.ok()) {
          const created = await createRes.json();
          createdProviderId = created?.data?.id ?? null;
        }
      }
    } catch {
      // Non-fatal - test may still work if providers already exist
    }

    try {
      await page.goto("/en-US/admin/sso");
      await page.waitForLoadState("networkidle");
      // Wait a moment for the useFindManySsoProvider hook to populate the ssoProviders array
      await page.waitForTimeout(1000);

      // Find the Force SSO Login label
      const forceSsoLabel = page.getByText("Force SSO Login");
      await expect(forceSsoLabel).toBeVisible({ timeout: 10000 });

      // Navigate from the label to the container div and find the switch within it
      // Structure: div.flex > { div > { Label("Force SSO Login"), p }, Switch }
      const forceSsoContainer = forceSsoLabel.locator("../..");
      const forceSsoSwitch = forceSsoContainer
        .locator('button[role="switch"]')
        .first();

      await expect(forceSsoSwitch).toBeVisible({ timeout: 5000 });

      const initialState = await forceSsoSwitch.getAttribute("data-state");

      // Toggle Force SSO — the handler calls updateProvider for ALL ssoProviders
      // which may result in multiple API calls or none if the hook hasn't loaded providers yet.
      // Use polling instead of waitForResponse since the number of API calls varies.
      await forceSsoSwitch.click();

      // Poll for state change
      await expect
        .poll(
          async () => forceSsoSwitch.getAttribute("data-state"),
          { message: "Force SSO switch state should change after toggle", timeout: 15000 }
        )
        .not.toBe(initialState);

      // Toggle back to restore original state
      await forceSsoSwitch.click();

      await expect
        .poll(
          async () => forceSsoSwitch.getAttribute("data-state"),
          { message: "Force SSO switch state should be restored", timeout: 15000 }
        )
        .toBe(initialState);
    } finally {
      // Clean up temporary provider if we created one
      if (createdProviderId) {
        try {
          await request.post(`${baseURL}/api/model/ssoProvider/delete`, {
            data: { where: { id: createdProviderId } },
          });
        } catch {
          // Non-fatal
        }
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

    try {
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

      const isRestrictionEnabled =
        (await restrictSwitch.getAttribute("data-state")) === "checked";

      if (!isRestrictionEnabled) {
        await restrictSwitch.click();
        await page.waitForTimeout(1500);
        // Verify it's now enabled
        await expect(restrictSwitch).toHaveAttribute("data-state", "checked", { timeout: 5000 });
      }

      // Domain input should now be visible
      const domainInput = page.locator('input[placeholder]').last();
      await expect(domainInput).toBeVisible({ timeout: 5000 });

      // Type the test domain
      await domainInput.fill(testDomain);

      // Click Add button
      const addBtn = page
        .getByRole("button", { name: /add/i })
        .last();
      await addBtn.click();
      await page.waitForTimeout(1500);

      // The domain should appear in the list
      const domainEntry = page.getByText(testDomain);
      await expect(domainEntry).toBeVisible({ timeout: 5000 });

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

      // Disable domain restriction if we enabled it
      if (!isRestrictionEnabled) {
        const restrictSwitchAfter = page
          .getByText("Restrict Email Domains")
          .locator("../..")
          .locator('button[role="switch"]')
          .first();
        const currentState = await restrictSwitchAfter.getAttribute("data-state");
        if (currentState === "checked") {
          await restrictSwitchAfter.click();
          await page.waitForTimeout(1000);
        }
      }
    } finally {
      // Clean up domain via API if it still exists
      if (createdDomainId) {
        try {
          await request.post(
            `${baseURL}/api/model/allowedEmailDomain/delete`,
            {
              data: { where: { id: createdDomainId } },
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
    await page.goto("/en-US/admin/sso");
    await page.waitForLoadState("networkidle");

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
