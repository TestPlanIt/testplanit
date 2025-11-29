import { type Page, type Locator, expect } from "@playwright/test";

export class SsoAdminPage {
  readonly page: Page;
  readonly pageTitle: Locator;
  readonly addProviderButton: Locator;
  readonly providersTable: Locator;
  readonly googleProviderCard: Locator;
  readonly samlProviderCard: Locator;
  readonly nameInput: Locator;
  readonly saveButton: Locator;
  readonly deleteButton: Locator;
  readonly configureButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageTitle = page.getByTestId("sso-page-title");
    this.addProviderButton = page.getByRole("button", {
      name: "Add SSO Provider",
    });
    this.providersTable = page.getByRole("table");
    this.googleProviderCard = page.locator('[data-provider-type="google"]');
    this.samlProviderCard = page.locator('[data-provider-type="saml"]');
    this.nameInput = page.getByRole("textbox", { name: "Name" });
    this.saveButton = page.getByRole("button", { name: "Save" });
    this.deleteButton = page.getByRole("button", { name: "Delete" });
    this.configureButton = page.getByRole("button", { name: "Configure" });
  }

  async goto() {
    await this.page.goto("/en-US/admin/sso");
    await this.page.waitForLoadState("networkidle");
  }

  async addGoogleProvider(name: string) {
    await this.addProviderButton.click();
    await this.googleProviderCard.click();
    await this.nameInput.fill(name);
    await this.saveButton.click();
    await this.page.waitForLoadState("networkidle");
  }

  async addSamlProvider(name: string) {
    await this.addProviderButton.click();
    await this.samlProviderCard.click();
    await this.nameInput.fill(name);
    await this.saveButton.click();
    await this.page.waitForLoadState("networkidle");
  }

  async configureProvider(providerName: string) {
    const row = this.page.locator("tr", { hasText: providerName });
    await row.locator("button", { hasText: "Configure" }).click();
    await this.page.waitForLoadState("networkidle");
  }

  async deleteProvider(providerName: string) {
    const row = this.page.locator("tr", { hasText: providerName });
    await row.locator("button", { hasText: "Delete" }).click();
    // Handle confirmation dialog
    await this.page.getByRole("button", { name: "Delete" }).click();
    await this.page.waitForLoadState("networkidle");
  }

  async expectProviderToExist(providerName: string) {
    await expect(
      this.page.locator("tr", { hasText: providerName })
    ).toBeVisible();
  }

  async expectProviderNotToExist(providerName: string) {
    await expect(
      this.page.locator("tr", { hasText: providerName })
    ).not.toBeVisible();
  }
}
