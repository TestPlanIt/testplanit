import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { expect, test } from "../../../fixtures";

/**
 * Qase import
 *
 * The fixture holds the responses the Qase API gave for a seeded project, as
 * the fetch step stores them. The test puts them in place as a fetched import,
 * then maps and imports them through the Data Imports page.
 */
const FIXTURE_CODE = "TPIMIG";
const FIXTURE_TITLE = "TestPlanIt import fixtures";

test.describe("Qase import", () => {
  test("maps a fetched Qase project and imports it", async ({
    api,
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(240_000);

    const code = `E2E${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const projectName = `Qase E2E ${Date.now()}-${code}`;
    const fixture = JSON.parse(
      fs
        .readFileSync(
          path.join(__dirname, "../../../fixtures/qase/tpimig.json"),
          "utf-8"
        )
        .replaceAll(FIXTURE_CODE, code)
        .replaceAll(FIXTURE_TITLE, projectName)
    ) as {
      projects: unknown[];
      staging: {
        entity: string;
        projectCode: string | null;
        sourceId: string;
        rowIndex: number;
        data: unknown;
      }[];
    };

    const findMany = async (model: string, args: unknown) => {
      const response = await request.get(
        `${baseURL}/api/model/${model}/findMany`,
        { params: { q: JSON.stringify(args) } }
      );
      expect(response.ok()).toBeTruthy();
      return (await response.json()).data as any[];
    };

    const fetchProgress: Record<
      string,
      { fetched: number; total: number; done: boolean }
    > = {};
    for (const row of fixture.staging) {
      const entry = (fetchProgress[row.entity] ??= {
        fetched: 0,
        total: 0,
        done: true,
      });
      entry.fetched += 1;
      entry.total += 1;
    }

    const created = await request.post(
      `${baseURL}/api/model/qaseImportJob/create`,
      {
        data: {
          data: {
            createdBy: { connect: { id: await api.getCurrentUserId() } },
            apiHost: "api.qase.io",
            status: "READY",
            phase: "CONFIGURING",
            projects: fixture.projects,
            fetchProgress,
            staging: { createMany: { data: fixture.staging } },
          },
        },
      }
    );
    expect(created.ok(), await created.text()).toBeTruthy();
    const jobId = (await created.json()).data.id as string;

    let projectId = 0;
    try {
      await test.step("Reopen the fetched import", async () => {
        await page.goto("/en-US/admin/imports?source=qase");
        await page.getByTestId("qase-previous-imports").click();
        await page.getByRole("option", { name: new RegExp(code) }).click();
        await expect(page.getByTestId("qase-count-case")).toContainText("6");
        await page.getByTestId("qase-continue-mapping-button").click();
      });

      await test.step("The mapping proposes a new project and has nothing left to choose", async () => {
        await expect(page.getByTestId("qase-mapping")).toBeVisible({
          timeout: 30_000,
        });
        await expect(
          page.getByTestId(`qase-map-project-name-${code}`)
        ).toHaveValue(projectName);
        await expect(
          page.getByTestId("qase-map-issue-tracker-row-qase")
        ).toBeVisible();
        await expect(page.getByTestId("qase-mapping-problems")).toHaveCount(0);
      });

      await test.step("Import and wait for it to finish", async () => {
        await page.getByTestId("qase-start-import-button").click();
        const status = page.getByTestId("qase-import-status");
        await expect(status).toContainText("Completed", { timeout: 180_000 });
        await expect(page.getByTestId("qase-imported-folders")).toContainText(
          "5 of 5"
        );
        await expect(page.getByTestId("qase-imported-cases")).toContainText(
          "6 of 6"
        );
        await expect(page.getByTestId("qase-imported-runs")).toContainText(
          "2 of 2"
        );
        await expect(page.getByTestId("qase-imported-results")).toContainText(
          "7 of 7"
        );
        await expect(page.getByTestId("qase-imported-issues")).toContainText(
          "2 of 2"
        );
      });

      await test.step("The project holds the Qase data", async () => {
        const projects = await findMany("projects", {
          where: { name: projectName, isDeleted: false },
          select: { id: true },
        });
        expect(projects).toHaveLength(1);
        projectId = projects[0].id;

        const folders = await findMany("repositoryFolders", {
          where: { projectId, isDeleted: false },
          select: { id: true, name: true, parentId: true },
        });
        const authentication = folders.find(
          (folder) => folder.name === "Authentication"
        );
        const login = folders.find((folder) => folder.name === "Login");
        expect(authentication).toBeTruthy();
        expect(login?.parentId).toBe(authentication.id);

        const cases = await findMany("repositoryCases", {
          where: { projectId, isDeleted: false },
          select: { name: true, steps: { select: { id: true } } },
        });
        expect(cases).toHaveLength(6);
        expect(
          cases.find((entry) => entry.name === "Sign in with a valid password")
            ?.steps.length
        ).toBeGreaterThan(0);

        const milestones = await findMany("milestones", {
          where: { projectId, isDeleted: false },
          select: { name: true },
        });
        expect(milestones.map((entry) => entry.name).sort()).toEqual([
          "Release 1.0",
          "Release 1.1",
        ]);

        const runs = await findMany("testRuns", {
          where: { projectId, isDeleted: false },
          select: { name: true, isCompleted: true },
        });
        expect(runs.map((entry) => entry.name).sort()).toEqual([
          "Production smoke",
          "Release 1.1 regression",
        ]);

        const results = await findMany("testRunResults", {
          where: { testRun: { projectId }, isDeleted: false },
          select: { id: true },
        });
        expect(results).toHaveLength(7);

        const issues = await findMany("issue", {
          where: { projectId, isDeleted: false },
          select: { name: true, title: true },
        });
        expect(issues.map((entry) => entry.name).sort()).toEqual([
          `${code}-D1`,
          `${code}-D2`,
        ]);
      });

      await test.step("The copied Qase data is gone once the import is done", async () => {
        const staged = await findMany("qaseImportStaging", {
          where: { jobId },
          select: { id: true },
        });
        expect(staged).toHaveLength(0);
      });

      await test.step("The imported test cases are in the repository", async () => {
        await page.goto(`/en-US/projects/repository/${projectId}`);
        // The repository opens on the folder named after the Qase project,
        // which holds the test case that had no suite.
        await expect(
          page.getByRole("link", {
            name: "Invoice totals are rounded to two decimals",
          })
        ).toBeVisible({ timeout: 30_000 });
      });
    } finally {
      await request
        .delete(`${baseURL}/api/imports/qase/jobs/${jobId}`)
        .catch(() => {});
      if (projectId) {
        await api.deleteProject(projectId);
      }
    }
  });
});
