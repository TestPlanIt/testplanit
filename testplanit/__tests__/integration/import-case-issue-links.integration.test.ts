// Live-DB proof for the CSV importer's `issues` column
// (lib/services/importCaseIssueLinks.ts).
//
// The column carries issue NAMES, and `Issue.name` is unique in neither
// direction — not across projects, not across the requirement/defect kinds
// sharing the table. Both of the resolve's scopes, and the replace's scope,
// only become observable when the fixtures actually contain the collisions
// they defend against, so this suite seeds all three at once against one
// case:
//
//   - two rows named alike in the importing project, one requirement and one
//     defect (the resolve must pick the defect)
//   - a name carried ONLY by a requirement. The pair above cannot carry the
//     defect scope on its own: `findFirst` has no ordering, so an unscoped
//     resolve is free to return either of the two and would sometimes pass.
//     A name with nothing but a requirement behind it fails an unscoped
//     resolve every run.
//   - a row of the same name in a DIFFERENT project (must resolve to nothing)
//   - a requirement already linked to the case, plus a defect already linked
//     to it (the replace must clear the defect and leave the requirement)
//
// Every assertion reads the surviving RepositoryCaseIssue rows.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/import-case-issue-links.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { replaceImportedCaseIssueLinks } from "~/lib/services/importCaseIssueLinks";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `imp-${Date.now()}`;

// One name, two rows in the importing project: the collision the resolve
// has to survive. REQUIREMENT_ONLY_NAME is carried by a requirement and
// nothing else.
const COLLIDING_NAME = `${STAMP}-DUP`;
const REQUIREMENT_ONLY_NAME = `${STAMP}-REQONLY`;

describeIntegration("CSV import issue links (live DB)", () => {
  let caseId: number;
  let importingProjectId: number;
  let otherProjectId: number;
  let creatorId: string;

  let sameNameDefectId: number;
  let sameNameRequirementId: number;
  let requirementOnlyNameId: number;
  let otherProjectDefectId: number;
  let alreadyLinkedRequirementId: number;
  let alreadyLinkedDefectId: number;

  const createdIssueIds: number[] = [];

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the worktree
    // .env DATABASE_URL resolves to `ew`, and this suite writes join rows.
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }

    // Hang the fixture case off an existing case's FK bundle rather than
    // building a project/repository/folder/template/workflow tower: this
    // suite asserts nothing about any of them, and enumerating their columns
    // would couple it to schema changes it has no stake in.
    const [anchor] = await db.$queryRaw<
      Array<{
        projectId: number;
        repositoryId: number;
        folderId: number;
        templateId: number;
        stateId: number;
        creatorId: string;
      }>
    >`
      SELECT "projectId", "repositoryId", "folderId", "templateId", "stateId", "creatorId"
      FROM "RepositoryCases"
      WHERE "isDeleted" = false
      LIMIT 1
    `;
    if (!anchor) {
      throw new Error(
        "Test prerequisite: no live RepositoryCases row to anchor to"
      );
    }
    importingProjectId = anchor.projectId;
    creatorId = anchor.creatorId;

    const [otherProject] = await db.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM "Projects" WHERE id <> ${importingProjectId} LIMIT 1
    `;
    if (!otherProject) {
      throw new Error(
        "Test prerequisite: needs a second project for the cross-project fixture"
      );
    }
    otherProjectId = otherProject.id;

    const [testCase] = await db.$queryRaw<Array<{ id: number }>>`
      INSERT INTO "RepositoryCases"
        ("projectId", "repositoryId", "folderId", "templateId", "name", "stateId", "creatorId")
      VALUES
        (${importingProjectId}, ${anchor.repositoryId}, ${anchor.folderId},
         ${anchor.templateId}, ${`${STAMP}-case`}, ${anchor.stateId}, ${creatorId})
      RETURNING id
    `;
    caseId = testCase.id;

    // `isRequirement` is explicit on every fixture rather than left to the
    // column default: the role scope is the thing under test, so a fixture
    // that silently defaulted would make it untestable.
    async function createIssue(
      name: string,
      isRequirement: boolean,
      projectId: number
    ) {
      const issue = await db.issue.create({
        data: {
          name,
          title: name,
          createdById: creatorId,
          projectId,
          isRequirement,
        },
        select: { id: true },
      });
      createdIssueIds.push(issue.id);
      return issue.id;
    }

    sameNameDefectId = await createIssue(
      COLLIDING_NAME,
      false,
      importingProjectId
    );
    sameNameRequirementId = await createIssue(
      COLLIDING_NAME,
      true,
      importingProjectId
    );
    requirementOnlyNameId = await createIssue(
      REQUIREMENT_ONLY_NAME,
      true,
      importingProjectId
    );
    otherProjectDefectId = await createIssue(
      `${STAMP}-FOREIGN`,
      false,
      otherProjectId
    );
    alreadyLinkedRequirementId = await createIssue(
      `${STAMP}-REQ`,
      true,
      importingProjectId
    );
    alreadyLinkedDefectId = await createIssue(
      `${STAMP}-OLD`,
      false,
      importingProjectId
    );

    await db.repositoryCaseIssue.createMany({
      data: [
        { caseId, issueId: alreadyLinkedRequirementId },
        { caseId, issueId: alreadyLinkedDefectId },
      ],
    });
  });

  afterAll(async () => {
    await db.repositoryCaseIssue.deleteMany({ where: { caseId } });
    await db.issue.deleteMany({ where: { id: { in: createdIssueIds } } });
    await db.$executeRaw`DELETE FROM "RepositoryCases" WHERE id = ${caseId}`;
    await db.$disconnect();
  });

  async function survivingLinkedIssueIds(): Promise<number[]> {
    const rows = await db.repositoryCaseIssue.findMany({
      where: { caseId },
      select: { issueId: true },
    });
    return rows.map((row) => row.issueId).sort((a, b) => a - b);
  }

  it("replaces only the links the column authored, and resolves names inside the project and the defect scope", async () => {
    await replaceImportedCaseIssueLinks(db, {
      caseId,
      projectId: importingProjectId,
      issueNames: [COLLIDING_NAME, REQUIREMENT_ONLY_NAME, `${STAMP}-FOREIGN`],
      replaceExisting: true,
    });

    const surviving = await survivingLinkedIssueIds();

    // The requirement link the requirements surface authored is still there;
    // the defect link a previous import authored was replaced.
    expect(surviving).toContain(alreadyLinkedRequirementId);
    expect(surviving).not.toContain(alreadyLinkedDefectId);

    // A name behind which there is only a requirement resolves to nothing —
    // an import row cannot author a requirement link.
    expect(surviving).not.toContain(requirementOnlyNameId);

    // The colliding name resolved to the defect, never to the requirement.
    expect(surviving).toContain(sameNameDefectId);
    expect(surviving).not.toContain(sameNameRequirementId);

    // The other project's row of the same name is not reachable from here.
    expect(surviving).not.toContain(otherProjectDefectId);

    expect(surviving).toEqual(
      [alreadyLinkedRequirementId, sameNameDefectId].sort((a, b) => a - b)
    );
  });

  /**
   * A cell may name a tracker key no local row answers to. The batch resolves
   * those upstream before any row is written and hands the ids down; what this
   * proves against a real database is that the linker actually writes the join
   * row for one, and reports — rather than swallows — a name it can place
   * nowhere.
   */
  it("links a name only the batch resolution could place, and reports the rest", async () => {
    const resolvedName = `${STAMP}-RESOLVED-KEY`;
    const hopelessName = `${STAMP}-NOWHERE`;

    const { unmatched } = await replaceImportedCaseIssueLinks(db, {
      caseId,
      projectId: importingProjectId,
      issueNames: [resolvedName, hopelessName],
      replaceExisting: true,
      resolvedKeyIds: new Map([[resolvedName, sameNameDefectId]]),
    });

    expect(await survivingLinkedIssueIds()).toContain(sameNameDefectId);
    // Unplaceable names come back named, so the importer can say which cell
    // failed instead of dropping it silently.
    expect(unmatched).toEqual([hopelessName]);
  });

  it("leaves existing links alone on a create-import", async () => {
    // A fresh row (replaceExisting false) adds links; it never clears any.
    const before = await survivingLinkedIssueIds();

    await replaceImportedCaseIssueLinks(db, {
      caseId,
      projectId: importingProjectId,
      issueNames: [],
      replaceExisting: false,
    });

    expect(await survivingLinkedIssueIds()).toEqual(before);
  });
});
