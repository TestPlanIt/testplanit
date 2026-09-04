// Live-DB behavioral scaffold for PROV-06 raw-write containment. Entry 3 is
// the end-to-end proof of the actual vulnerability this phase closes:
// linking a test case to a Jira issue key is an ordinary, already-shipped
// user action whose upsert update branch writes `title` with no policy
// check, so a requirement classified from that same Jira key was silently
// overwritable by any tester before this phase.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-raw-write-containment.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { JiraLinkService } from "~/lib/services/jira-link-service";
import { upsertLinkedIssueShell } from "~/lib/services/linkedIssueUpsert";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rwc-${Date.now()}`;

describeIntegration("Issue raw-write containment (PROV-06, behavioral)", () => {
  let adminUserId: string;
  let projectId: number;
  let integrationId: number;
  let repositoryId: number;
  let folderId: number;
  let testCaseId: number;
  let lockedRequirementId: number;
  let detachedRequirementId: number;
  let syncedDefectId: number;

  const lockedExternalId = `${STAMP}-ext-locked`;
  const lockedExternalKey = `${STAMP}-KEY-1`;
  const detachedExternalId = `${STAMP}-ext-detached`;
  const defectExternalId = `${STAMP}-ext-defect`;

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database. This suite
    // calls the real JiraLinkService, which resolves its own module-level
    // baseDb client from the ambient DATABASE_URL at import time — the
    // inline env prefix on the vitest invocation is the only thing that
    // makes that safe, so this guard is the last line of defense against
    // a missing or wrong prefix.
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    // ADMIN-tier acting user, mirroring issue-requirement-lock.test.ts —
    // not strictly required here (both call paths under test use the
    // raw/base client tier, which carries no policy plugin), but keeps
    // the fixture consistent with the sibling live-DB suites.
    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Raw Write Containment Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await db.projects.create({
      data: { name: `${STAMP}-project`, createdBy: adminUserId },
      select: { id: true },
    });
    projectId = project.id;

    const integration = await db.integration.create({
      data: {
        name: `${STAMP}-jira`,
        provider: "JIRA",
        authType: "OAUTH2",
        status: "ACTIVE",
        credentials: {},
        settings: {},
      },
      select: { id: true },
    });
    integrationId = integration.id;

    const repository = await db.repositories.create({
      data: { projectId },
      select: { id: true },
    });
    repositoryId = repository.id;

    const folder = await db.repositoryFolders.create({
      data: {
        name: `${STAMP}-folder`,
        repositoryId,
        projectId,
        creatorId: adminUserId,
      },
      select: { id: true },
    });
    folderId = folder.id;

    // Templates and Workflows are global catalogs (no projectId FK), so
    // reusing any existing row matches compositionLock.integration.test's
    // seedFixture convention rather than creating a redundant one.
    const template = await db.templates.findFirst({ select: { id: true } });
    if (!template)
      throw new Error("Test prerequisite: no Templates row available");
    const state = await db.workflows.findFirst({ select: { id: true } });
    if (!state)
      throw new Error("Test prerequisite: no Workflows row available");

    const testCase = await db.repositoryCases.create({
      data: {
        projectId,
        repositoryId,
        folderId,
        templateId: template.id,
        name: `${STAMP}-case`,
        stateId: state.id,
        creatorId: adminUserId,
      },
      select: { id: true },
    });
    testCaseId = testCase.id;

    const lockedRequirement = await db.issue.create({
      data: {
        name: `${STAMP}-locked-requirement`,
        title: `${STAMP}-locked-requirement`,
        createdById: adminUserId,
        projectId,
        integrationId,
        externalId: lockedExternalId,
        externalKey: lockedExternalKey,
        isRequirement: true,
      },
      select: { id: true },
    });
    lockedRequirementId = lockedRequirement.id;

    const detachedRequirement = await db.issue.create({
      data: {
        name: `${STAMP}-detached-requirement`,
        title: `${STAMP}-detached-requirement`,
        createdById: adminUserId,
        projectId,
        integrationId,
        externalId: detachedExternalId,
        isRequirement: true,
        requirementDetachedAt: new Date(),
      },
      select: { id: true },
    });
    detachedRequirementId = detachedRequirement.id;

    const syncedDefect = await db.issue.create({
      data: {
        name: `${STAMP}-synced-defect`,
        title: `${STAMP}-synced-defect`,
        createdById: adminUserId,
        projectId,
        integrationId,
        externalId: defectExternalId,
        isRequirement: false,
      },
      select: { id: true },
    });
    syncedDefectId = syncedDefect.id;
  });

  afterAll(async () => {
    await db.repositoryCaseIssue.deleteMany({
      where: { caseId: testCaseId },
    });
    await db.issue.deleteMany({
      where: {
        id: {
          in: [lockedRequirementId, detachedRequirementId, syncedDefectId],
        },
      },
    });
    await db.repositoryCases.delete({ where: { id: testCaseId } });
    await db.repositoryFolders.delete({ where: { id: folderId } });
    await db.repositories.delete({ where: { id: repositoryId } });
    await db.integration.delete({ where: { id: integrationId } });
    await db.projects.delete({ where: { id: projectId } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("a locked requirement keeps its title when written through the shell", async () => {
    await upsertLinkedIssueShell(db, {
      externalId: lockedExternalId,
      integrationId,
      create: {
        name: `${STAMP}-should-not-create`,
        title: "should-not-create",
        createdById: adminUserId,
        projectId,
        externalId: lockedExternalId,
        integrationId,
      },
      update: {
        title: `${STAMP}-locked-title-overwrite-attempt`,
        externalUrl: `https://jira.example.com/${STAMP}-new-url`,
      },
    });

    const row = await db.issue.findUnique({
      where: { id: lockedRequirementId },
      select: { title: true, externalUrl: true },
    });
    // Both halves matter: the title staying put proves the lock; the
    // externalUrl landing proves the shell did not degrade into a no-op.
    expect(row?.title).toBe(`${STAMP}-locked-requirement`);
    expect(row?.externalUrl).toBe(`https://jira.example.com/${STAMP}-new-url`);
  });

  // The two ownership states strip the same five fields for opposite reasons,
  // and this is the second one. While a requirement is LOCKED the tracker owns
  // its content and a local writer must not land a stale copy; once DETACHED
  // the USER owns it, and every caller of this shell is tracker-sourced, so a
  // refresh must not clobber what they wrote.
  //
  // This assertion used to read the other way, because until 8722b2606 ("keep
  // a detached requirement's local edits across sync polls") the shell stripped
  // only for the locked state. That commit extended the strip to detached rows
  // and updated the unit test beside the implementation, but not this live-DB
  // one — which nothing ran, because the job that runs it did not watch the
  // branch it lives on.
  it("a detached requirement keeps its title when written through the shell", async () => {
    await upsertLinkedIssueShell(db, {
      externalId: detachedExternalId,
      integrationId,
      create: {
        name: `${STAMP}-should-not-create`,
        title: "should-not-create",
        createdById: adminUserId,
        projectId,
        externalId: detachedExternalId,
        integrationId,
      },
      update: {
        title: `${STAMP}-detached-title-overwrite-attempt`,
        externalUrl: `https://jira.example.com/${STAMP}-detached-new-url`,
      },
    });

    const row = await db.issue.findUnique({
      where: { id: detachedRequirementId },
      select: { title: true, externalUrl: true },
    });
    // Both halves matter, exactly as in the locked case above: the title
    // staying put proves the user's edit survived, and the externalUrl landing
    // proves the shell refreshed the mirror columns rather than degrading into
    // a no-op.
    expect(row?.title).toBe(`${STAMP}-detached-requirement`);
    expect(row?.externalUrl).toBe(
      `https://jira.example.com/${STAMP}-detached-new-url`
    );
  });

  it("a locked requirement keeps its title when linked through JiraLinkService.linkTestCaseToJiraIssue", async () => {
    await JiraLinkService.linkTestCaseToJiraIssue(
      testCaseId,
      lockedExternalKey,
      lockedExternalId,
      integrationId,
      `${STAMP}-link-title-overwrite-attempt`
    );

    const row = await db.issue.findUnique({
      where: { id: lockedRequirementId },
      select: { title: true },
    });
    expect(row?.title).toBe(`${STAMP}-locked-requirement`);

    // The join assertion is the point of the whole plan's design:
    // containment must protect the locked content without breaking the
    // linking feature.
    const joinRow = await db.repositoryCaseIssue.findUnique({
      where: {
        caseId_issueId: { caseId: testCaseId, issueId: lockedRequirementId },
      },
    });
    expect(joinRow).not.toBeNull();
  });
});
