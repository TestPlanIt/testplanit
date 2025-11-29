import { type Page, type Locator, expect } from "@playwright/test";

export class ProjectsPage {
  readonly page: Page;
  readonly projectsContent: Locator;

  constructor(page: Page) {
    this.page = page;
    this.projectsContent = page.getByTestId("project-cards");
  }

  async goto() {
    await this.page.goto("/en-US/projects");
  }

  async expectProjectsContentToBeVisible() {
    await expect(this.projectsContent).toBeVisible();
  }
}
