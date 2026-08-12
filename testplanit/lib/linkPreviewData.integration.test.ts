/**
 * Live-DB integration tests for the link-preview record loader
 * (lib/linkPreviewData.ts).
 *
 * Execution model (readWriteDialect.integration.test.ts convention):
 *   - Skipped by default. Opt in with RUN_DB_INTEGRATION=1.
 *   - DB SAFETY: connects ONLY to the tpi_test scratch database, whose URL is
 *     read from .env.e2e directly. The active .env DATABASE_URL points at a
 *     production-ish database and is never consulted — the suite hard-refuses
 *     any URL that is not the tpi_test database.
 *   - All fixtures are created with unique names inside one throwaway project
 *     and hard-deleted in afterAll, leaving the DB as it was found.
 *
 * Covered against real rows:
 *   1. Each entity kind resolves its name and owning project name.
 *   2. Counts (run case count, project case/run counts) match the fixtures and
 *      exclude soft-deleted children.
 *   3. Soft-deleted and missing records return null so callers fall back to the
 *      generic card instead of naming a deleted record.
 *   4. Record keys are derived only when the admin feature is enabled, matching
 *      what the app's own UI shows.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ZenStackClient } from "@zenstackhq/orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDialect } from "~/lib/db/readWriteDialect";
import { schema } from "~/zenstack/schema";
import {
  RECORD_KEY_ENABLED_KEY,
  RECORD_KEY_TOKENS_KEY,
} from "~/lib/services/recordKeyConfig";
import { loadEntityPreview } from "./linkPreviewData";

/**
 * Reads the scratch database URL from .env.e2e (project root = vitest cwd).
 * Returns null unless the URL unambiguously targets the tpi_test scratch
 * database — the safety gate this suite refuses to run without.
 */
function readScratchDbUrl(): string | null {
  try {
    const envPath = resolve(process.cwd(), ".env.e2e");
    const content = readFileSync(envPath, "utf8");
    const match = content.match(/^DATABASE_URL="?([^"\r\n]+)"?/m);
    const url = match?.[1] ?? null;
    if (!url || !/\/tpi_test(\?|$)/.test(new URL(url).pathname + "?")) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const SCRATCH_URL = RUN_INTEGRATION ? readScratchDbUrl() : null;
const describeIntegration =
  RUN_INTEGRATION && SCRATCH_URL ? describe : describe.skip;

describeIntegration("loadEntityPreview (live scratch DB)", () => {
  const suffix = `linkprev_${Date.now().toString(36)}`;
  const PROJECT_KEY = "LPIT";

  let client: any;
  let db: any;

  let user: { id: string };
  let project: { id: number };
  let testCase: { id: number };
  let deletedCase: { id: number };
  let run: { id: number };
  let session: { id: number };
  let milestone: { id: number };

  /** AppConfig rows this suite creates and must remove again. */
  const createdConfigKeys: string[] = [];

  beforeAll(async () => {
    client = new ZenStackClient(schema, {
      dialect: createDialect(SCRATCH_URL!, []),
    });
    db = client;

    const role = await client.roles.findFirst({ select: { id: true } });
    expect(role).not.toBeNull();

    user = await client.user.create({
      data: {
        name: `Link Preview IT ${suffix}`,
        email: `${suffix}@example.test`,
        roleId: role!.id,
      },
      select: { id: true },
    });

    project = await client.projects.create({
      data: {
        name: `Link Preview IT ${suffix}`,
        key: PROJECT_KEY,
        createdBy: user.id,
      },
      select: { id: true },
    });

    const repository = await client.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    const folder = await client.repositoryFolders.create({
      data: {
        projectId: project.id,
        repositoryId: repository.id,
        name: `root ${suffix}`,
        creatorId: user.id,
      },
      select: { id: true },
    });

    // Reuse seeded reference data — this suite is about the loader, not setup.
    const template = await client.templates.findFirst({ select: { id: true } });
    const workflow = await client.workflows.findFirst({
      where: { isDeleted: false },
      select: { id: true },
    });
    const milestoneType = await client.milestoneTypes.findFirst({
      select: { id: true },
    });
    expect(template).not.toBeNull();
    expect(workflow).not.toBeNull();
    expect(milestoneType).not.toBeNull();

    const makeCase = async (name: string, isDeleted = false) =>
      await client.repositoryCases.create({
        data: {
          projectId: project.id,
          repositoryId: repository.id,
          folderId: folder.id,
          templateId: template!.id,
          stateId: workflow!.id,
          name,
          creatorId: user.id,
          isDeleted,
        },
        select: { id: true },
      });

    testCase = await makeCase(`Login with SSO ${suffix}`);
    const secondCase = await makeCase(`Second case ${suffix}`);
    deletedCase = await makeCase(`Deleted case ${suffix}`, true);

    run = await client.testRuns.create({
      data: {
        projectId: project.id,
        name: `Regression ${suffix}`,
        stateId: workflow!.id,
        createdById: user.id,
        testCases: {
          create: [
            { repositoryCaseId: testCase.id },
            { repositoryCaseId: secondCase.id },
          ],
        },
      },
      select: { id: true },
    });

    session = await client.sessions.create({
      data: {
        projectId: project.id,
        templateId: template!.id,
        stateId: workflow!.id,
        name: `Charter ${suffix}`,
        createdById: user.id,
      },
      select: { id: true },
    });

    milestone = await client.milestones.create({
      data: {
        projectId: project.id,
        milestoneTypesId: milestoneType!.id,
        name: `Release ${suffix}`,
        createdBy: user.id,
      },
      select: { id: true },
    });
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      if (createdConfigKeys.length > 0) {
        await client.appConfig.deleteMany({
          where: { key: { in: createdConfigKeys } },
        });
      }
      if (project) {
        await client.testRunCases.deleteMany({
          where: { testRun: { projectId: project.id } },
        });
        await client.testRuns.deleteMany({ where: { projectId: project.id } });
        await client.milestones.deleteMany({
          where: { projectId: project.id },
        });
        await client.sessions.deleteMany({ where: { projectId: project.id } });
        await client.repositoryCases.deleteMany({
          where: { projectId: project.id },
        });
        await client.repositoryFolders.deleteMany({
          where: { projectId: project.id },
        });
        await client.repositories.deleteMany({
          where: { projectId: project.id },
        });
        await client.projects.delete({ where: { id: project.id } });
      }
      if (user) {
        await client.user.delete({ where: { id: user.id } });
      }
    } finally {
      await client.$disconnect?.();
    }
  }, 60_000);

  it("names a test case and its project", async () => {
    const preview = await loadEntityPreview(db, "test-case", testCase.id);

    expect(preview).not.toBeNull();
    expect(preview!.name).toBe(`Login with SSO ${suffix}`);
    expect(preview!.projectName).toBe(`Link Preview IT ${suffix}`);
  });

  it("counts a run's live test cases", async () => {
    const preview = await loadEntityPreview(db, "test-run", run.id);

    expect(preview).not.toBeNull();
    expect(preview!.name).toBe(`Regression ${suffix}`);
    expect(preview!.projectName).toBe(`Link Preview IT ${suffix}`);
    expect(preview!.caseCount).toBe(2);
  });

  it("names a session and a milestone", async () => {
    const sessionPreview = await loadEntityPreview(db, "session", session.id);
    expect(sessionPreview?.name).toBe(`Charter ${suffix}`);
    expect(sessionPreview?.projectName).toBe(`Link Preview IT ${suffix}`);

    const milestonePreview = await loadEntityPreview(
      db,
      "milestone",
      milestone.id
    );
    expect(milestonePreview?.name).toBe(`Release ${suffix}`);
    expect(milestonePreview?.projectName).toBe(`Link Preview IT ${suffix}`);
  });

  it("counts a project's live cases and runs, excluding soft-deleted ones", async () => {
    const preview = await loadEntityPreview(db, "project", project.id);

    expect(preview).not.toBeNull();
    expect(preview!.name).toBe(`Link Preview IT ${suffix}`);
    // Three cases exist; one is soft-deleted.
    expect(preview!.caseCount).toBe(2);
    expect(preview!.runCount).toBe(1);
    // A project preview *is* the project, so there is no parent to name.
    expect(preview!.projectName).toBeNull();
  });

  it("returns null for a soft-deleted record", async () => {
    expect(await loadEntityPreview(db, "test-case", deletedCase.id)).toBeNull();
  });

  it("returns null for a record that does not exist", async () => {
    expect(await loadEntityPreview(db, "test-run", 2_000_000_000)).toBeNull();
  });

  it("omits the record key while the admin feature is disabled", async () => {
    const preview = await loadEntityPreview(db, "test-case", testCase.id);
    expect(preview?.recordKey).toBeNull();
  });

  it("derives the record key once the admin feature is enabled", async () => {
    await client.appConfig.upsert({
      where: { key: RECORD_KEY_ENABLED_KEY },
      create: { key: RECORD_KEY_ENABLED_KEY, value: true },
      update: { value: true },
    });
    createdConfigKeys.push(RECORD_KEY_ENABLED_KEY, RECORD_KEY_TOKENS_KEY);

    const preview = await loadEntityPreview(db, "test-case", testCase.id);
    expect(preview?.recordKey).toBe(`${PROJECT_KEY}-TC-${testCase.id}`);

    const runPreview = await loadEntityPreview(db, "test-run", run.id);
    expect(runPreview?.recordKey).toBe(`${PROJECT_KEY}-TR-${run.id}`);

    // A project has no record key of its own.
    const projectPreview = await loadEntityPreview(db, "project", project.id);
    expect(projectPreview?.recordKey).toBeNull();
  });
});
