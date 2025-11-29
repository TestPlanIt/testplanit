import { type Page, type Locator, expect } from "@playwright/test";

export class SamlConfigurationPage {
  readonly page: Page;
  readonly entityIdInput: Locator;
  readonly ssoUrlInput: Locator;
  readonly certificateInput: Locator;
  readonly issuerInput: Locator;
  readonly emailAttributeSelect: Locator;
  readonly nameAttributeSelect: Locator;
  readonly autoProvisionCheckbox: Locator;
  readonly saveButton: Locator;
  readonly testConnectionButton: Locator;
  readonly pageTitle: Locator;

  constructor(page: Page) {
    this.page = page;
    this.entityIdInput = page.getByRole("textbox", { name: "Entity ID" });
    this.ssoUrlInput = page.getByRole("textbox", { name: "SSO URL" });
    this.certificateInput = page.getByRole("textbox", {
      name: "X.509 Certificate",
    });
    this.issuerInput = page.getByRole("textbox", { name: "Issuer" });
    this.emailAttributeSelect = page.locator('[name="attributeMapping.email"]');
    this.nameAttributeSelect = page.locator('[name="attributeMapping.name"]');
    this.autoProvisionCheckbox = page.getByRole("checkbox", {
      name: "Enable automatic user provisioning",
    });
    this.saveButton = page.getByRole("button", { name: "Save Configuration" });
    this.testConnectionButton = page.getByRole("button", {
      name: "Test Connection",
    });
    this.pageTitle = page.getByTestId("saml-config-page-title");
  }

  async fillConfiguration(config: {
    entityId: string;
    ssoUrl: string;
    certificate: string;
    issuer?: string;
    emailAttribute?: string;
    nameAttribute?: string;
    autoProvision?: boolean;
  }) {
    await this.entityIdInput.fill(config.entityId);
    await this.ssoUrlInput.fill(config.ssoUrl);
    await this.certificateInput.fill(config.certificate);

    if (config.issuer) {
      await this.issuerInput.fill(config.issuer);
    }

    if (config.emailAttribute) {
      await this.emailAttributeSelect.selectOption(config.emailAttribute);
    }

    if (config.nameAttribute) {
      await this.nameAttributeSelect.selectOption(config.nameAttribute);
    }

    if (config.autoProvision !== undefined) {
      if (config.autoProvision) {
        await this.autoProvisionCheckbox.check();
      } else {
        await this.autoProvisionCheckbox.uncheck();
      }
    }
  }

  async saveConfiguration() {
    await this.saveButton.click();
    await this.page.waitForLoadState("networkidle");
  }

  async testConnection() {
    await this.testConnectionButton.click();
    // Wait for either success or error message
    await Promise.race([
      this.page.waitForSelector('[role="alert"][aria-label*="Success"]', {
        timeout: 10000,
      }),
      this.page.waitForSelector('[role="alert"][aria-label*="Error"]', {
        timeout: 10000,
      }),
    ]);
  }

  async expectConfigurationSaved() {
    await expect(
      this.page.locator('[role="alert"]', { hasText: "Configuration saved" })
    ).toBeVisible();
  }

  async expectConnectionTestSuccess() {
    await expect(
      this.page.locator('[role="alert"]', { hasText: "Connection successful" })
    ).toBeVisible();
  }

  async expectConnectionTestFailure() {
    await expect(
      this.page.locator('[role="alert"]', { hasText: "Connection failed" })
    ).toBeVisible();
  }
}
