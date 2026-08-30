// Live-DB integration proof for CFG-03 — the requirements-config
// recompute pass (both-direction isRequirement flip, one audited
// transaction, project-scoped, no stale rows).
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-config-recompute.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { recomputeRequirementClassification } from "~/lib/services/requirementHierarchy";
import { upsertLinkedIssueShell } from "~/lib/services/linkedIssueUpsert";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `rc-${Date.now()}`;

const TYPE_A = "10001";
const TYPE_B = "10002";

type IssueSnapshot = {
  id: number;
  isRequirement: boolean;
  isDeleted: boolean;
  requirementDetachedAt: Date | null;
  parentId: number | null;
  title: string;
};

describeIntegration("requirements-config recompute (live DB)", () => {
  let adminUserId: string;
  let p1Id: number;
  let p2Id: number;

  // P1 — the recompute's target project.
  let p1UnclassifiedAId: number;
  let p1ClassifiedAId: number;
  let p1ClassifiedBId: number;
  let p1SoftDeletedAId: number;
  let p1DetachedBId: number;

  // P2 — the control project. Every row here must come out byte-identical.
  let p2UnclassifiedAId: number;
  let p2ClassifiedAId: number;
  let p2ClassifiedBId: number;
  let p2SoftDeletedAId: number;
  let p2DetachedBId: number;

  const allIssueIds: number[] = [];
  const p2IssueIds: number[] = [];

  let p2RowsBefore: IssueSnapshot[];
  let p1DetachedBBefore: {
    requirementDetachedAt: Date | null;
    parentId: number | null;
    title: string;
  } | null;

  let recomputeResult: { classified: number; declassified: number };

  const issueSelect = {
    id: true,
    isRequirement: true,
    isDeleted: true,
    requirementDetachedAt: true,
    parentId: true,
    title: true,
  } as const;

  beforeAll(async () => {
    // Refuse to run against anything but a scratch database — the
    // worktree .env DATABASE_URL resolves to `ew`, and this suite runs a
    // real bulk isRequirement flip.
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

    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Requirements Config Recompute Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const p1 = await db.projects.create({
      data: { name: `${STAMP}-p1`, createdBy: adminUserId },
      select: { id: true },
    });
    p1Id = p1.id;
    const p2 = await db.projects.create({
      data: { name: `${STAMP}-p2`, createdBy: adminUserId },
      select: { id: true },
    });
    p2Id = p2.id;

    async function createIssue(
      projectId: number,
      name: string,
      overrides: Record<string, unknown> = {}
    ) {
      const issue = await db.issue.create({
        data: {
          name: `${STAMP}-${name}`,
          title: `${STAMP}-${name}`,
          createdById: adminUserId,
          projectId,
          ...overrides,
        },
        select: { id: true },
      });
      allIssueIds.push(issue.id);
      return issue.id;
    }

    // P1 fixtures — one row per state the recompute must handle correctly.
    p1UnclassifiedAId = await createIssue(p1Id, "p1-unclassified-a", {
      issueTypeId: TYPE_A,
      isRequirement: false,
    });
    p1ClassifiedAId = await createIssue(p1Id, "p1-classified-a", {
      issueTypeId: TYPE_A,
      isRequirement: true,
    });
    p1ClassifiedBId = await createIssue(p1Id, "p1-classified-b", {
      issueTypeId: TYPE_B,
      isRequirement: true,
    });
    // Matches TYPE_A + isRequirement=false in every predicate the classify
    // statement checks EXCEPT isDeleted — the only thing keeping this row
    // unchanged is the "isDeleted" = false guard.
    p1SoftDeletedAId = await createIssue(p1Id, "p1-soft-deleted-a", {
      issueTypeId: TYPE_A,
      isRequirement: false,
      isDeleted: true,
    });
    p1DetachedBId = await createIssue(p1Id, "p1-detached-b", {
      issueTypeId: TYPE_B,
      isRequirement: true,
      requirementDetachedAt: new Date(),
      parentId: p1ClassifiedAId,
    });

    // P2 fixtures — the exact same five states, same types, in a different
    // project. None of these should be touched by a P1-scoped recompute.
    p2UnclassifiedAId = await createIssue(p2Id, "p2-unclassified-a", {
      issueTypeId: TYPE_A,
      isRequirement: false,
    });
    p2ClassifiedAId = await createIssue(p2Id, "p2-classified-a", {
      issueTypeId: TYPE_A,
      isRequirement: true,
    });
    p2ClassifiedBId = await createIssue(p2Id, "p2-classified-b", {
      issueTypeId: TYPE_B,
      isRequirement: true,
    });
    p2SoftDeletedAId = await createIssue(p2Id, "p2-soft-deleted-a", {
      issueTypeId: TYPE_A,
      isRequirement: false,
      isDeleted: true,
    });
    p2DetachedBId = await createIssue(p2Id, "p2-detached-b", {
      issueTypeId: TYPE_B,
      isRequirement: true,
      requirementDetachedAt: new Date(),
      parentId: p2ClassifiedAId,
    });
    p2IssueIds.push(
      p2UnclassifiedAId,
      p2ClassifiedAId,
      p2ClassifiedBId,
      p2SoftDeletedAId,
      p2DetachedBId
    );

    p2RowsBefore = await db.issue.findMany({
      where: { id: { in: p2IssueIds } },
      select: issueSelect,
      orderBy: { id: "asc" },
    });

    p1DetachedBBefore = await db.issue.findUnique({
      where: { id: p1DetachedBId },
      select: {
        requirementDetachedAt: true,
        parentId: true,
        title: true,
      },
    });

    // The single call under test — both directions, one project, one
    // transaction. Every `it` below re-reads through the raw client to
    // assert on the state this call actually left behind.
    recomputeResult = await recomputeRequirementClassification(
      p1Id,
      [TYPE_A],
      [TYPE_B]
    );
  });

  afterAll(async () => {
    await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await db.projects.delete({ where: { id: p1Id } });
    await db.projects.delete({ where: { id: p2Id } });
    await db.user.delete({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("classifies issues whose type was added to the config", async () => {
    const row = await db.issue.findUnique({
      where: { id: p1UnclassifiedAId },
      select: { isRequirement: true },
    });
    expect(row?.isRequirement).toBe(true);
    // Only the ONE previously-unclassified type-A row actually flips — the
    // already-classified type-A row doesn't count toward this total, since
    // the classify statement's own "isRequirement = false" predicate never
    // rewrites a row that was already correct.
    expect(recomputeResult.classified).toBe(1);
  });

  it("de-classifies issues whose type was removed from the config", async () => {
    const rows = await db.issue.findMany({
      where: { id: { in: [p1ClassifiedBId, p1DetachedBId] } },
      select: { isRequirement: true },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.isRequirement).toBe(false);
    }
    expect(recomputeResult.declassified).toBe(2);
  });

  it("leaves another project's issues of the same type untouched", async () => {
    const p2RowsAfter = await db.issue.findMany({
      where: { id: { in: p2IssueIds } },
      select: issueSelect,
      orderBy: { id: "asc" },
    });
    // Byte-identical to the pre-call snapshot — this is the assertion that
    // catches a missing or mis-scoped "projectId" predicate, and it is the
    // highest-severity failure this plan can have.
    expect(p2RowsAfter).toEqual(p2RowsBefore);
  });

  it("skips soft-deleted issues in both directions", async () => {
    const row = await db.issue.findUnique({
      where: { id: p1SoftDeletedAId },
      select: { isRequirement: true, isDeleted: true },
    });
    expect(row?.isRequirement).toBe(false);
    expect(row?.isDeleted).toBe(true);
  });

  it("leaves requirementDetachedAt, parentId and title untouched", async () => {
    const row = await db.issue.findUnique({
      where: { id: p1DetachedBId },
      select: {
        requirementDetachedAt: true,
        parentId: true,
        title: true,
        isRequirement: true,
      },
    });
    expect(row?.requirementDetachedAt).toEqual(
      p1DetachedBBefore?.requirementDetachedAt
    );
    expect(row?.parentId).toBe(p1DetachedBBefore?.parentId);
    expect(row?.title).toBe(p1DetachedBBefore?.title);
    // This row's type WAS in removedTypeIds — confirming the columns above
    // survived a de-classification that actually happened, not one the
    // recompute skipped entirely.
    expect(row?.isRequirement).toBe(false);
  });
});

// LINK-03 reference shells never enter the tree (owner 27-08). A
// reference's external branch (plan 27-07's POST route) upserts its
// referenced-issue shell through upsertLinkedIssueShell -- the ONE
// reviewed guarded Issue-write path -- which never sets issueTypeId or
// isRequirement on either its create or update payload (confirmed by a
// direct grep of the route file elsewhere in this plan). This block proves
// that omission survives a REAL requirements-config recompute: the classify
// statement above keys on issueTypeId alone, so a shell with no issueTypeId
// can never match it. A control row seeded WITH the matching issueTypeId
// proves the recompute call actually ran, rather than being a no-op that
// would make the shell's exclusion pass for the wrong reason.
//
// A DEDICATED raw client, independent of the shared module-level `db`
// above: the outer describe block's own `afterAll` calls `db.$disconnect()`
// on that shared pool, and top-level `describe` blocks in this file run
// sequentially — by the time THIS block's `beforeAll` runs, the outer
// block's `afterAll` has already destroyed it.
const linkDb = createRawDbClient();

describeIntegration("LINK-03 reference shells never enter the tree", () => {
  const LINK03_TYPE = "40001";

  let adminUserId: string;
  let projectId: number;
  let integrationId: number;
  let shellIssueId: number;
  let controlIssueId: number;

  const allIssueIds: number[] = [];

  let shellBefore: { isRequirement: boolean; issueTypeId: string | null };
  let controlBefore: { isRequirement: boolean; issueTypeId: string | null };
  let shellAfter: { isRequirement: boolean; issueTypeId: string | null };
  let controlAfter: { isRequirement: boolean; issueTypeId: string | null };
  let treeIdsBefore: number[];
  let treeIdsAfter: number[];
  let recomputeResult: { classified: number; declassified: number };

  beforeAll(async () => {
    const [{ current_database: dbName }] = await linkDb.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }

    const role = await linkDb.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await linkDb.user.create({
      data: {
        email: `${STAMP}-link03-admin@example.com`,
        name: `LINK-03 Tree Recompute Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await linkDb.projects.create({
      data: { name: `${STAMP}-link03-project`, createdBy: adminUserId },
      select: { id: true },
    });
    projectId = project.id;

    const integration = await linkDb.integration.create({
      data: {
        name: `${STAMP}-link03-jira`,
        provider: "JIRA",
        authType: "OAUTH2",
        status: "ACTIVE",
        credentials: {},
        settings: {},
      },
      select: { id: true },
    });
    integrationId = integration.id;

    // The shell, created through the EXACT function the references POST
    // route's external branch calls — never a hand-rolled issue.create.
    // Its create payload mirrors the route's own trackerFields
    // (name/title/description/externalId/integrationId/projectId/
    // createdById), which carries no issueTypeId.
    const shell = await upsertLinkedIssueShell(linkDb, {
      externalId: `${STAMP}-link03-shell-ext`,
      integrationId,
      create: {
        name: `${STAMP}-link03-shell`,
        title: `${STAMP}-link03-shell`,
        description: "",
        externalId: `${STAMP}-link03-shell-ext`,
        integrationId,
        projectId,
        createdById: adminUserId,
      },
      update: {
        title: `${STAMP}-link03-shell-updated`,
      },
      select: { id: true },
    });
    shellIssueId = shell.id;
    allIssueIds.push(shellIssueId);

    // Control row: an ordinary Issue seeded WITH the exact type id the
    // recompute below adds — the load-bearing half. Without it, a
    // recompute that silently did nothing would make the shell's
    // exclusion below pass for the wrong reason.
    const control = await linkDb.issue.create({
      data: {
        name: `${STAMP}-link03-control`,
        title: `${STAMP}-link03-control`,
        createdById: adminUserId,
        projectId,
        issueTypeId: LINK03_TYPE,
        isRequirement: false,
      },
      select: { id: true },
    });
    controlIssueId = control.id;
    allIssueIds.push(controlIssueId);

    // Raw select, read back BEFORE the recompute — a client-side default
    // must never be able to satisfy the assertions below.
    async function readBack(id: number) {
      const rows = await linkDb.$queryRaw<
        Array<{ isRequirement: boolean; issueTypeId: string | null }>
      >`SELECT "isRequirement", "issueTypeId" FROM "Issue" WHERE id = ${id}`;
      return rows[0];
    }
    shellBefore = await readBack(shellIssueId);
    controlBefore = await readBack(controlIssueId);

    // The exact query the requirements list uses — a findMany over Issue
    // for the project spreading REQUIREMENT_SCOPE_WHERE and excluding
    // soft-deleted rows.
    async function treeIds() {
      const rows = await linkDb.issue.findMany({
        where: { projectId, isDeleted: false, ...REQUIREMENT_SCOPE_WHERE },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    }
    treeIdsBefore = await treeIds();

    recomputeResult = await recomputeRequirementClassification(
      projectId,
      [LINK03_TYPE],
      []
    );

    shellAfter = await readBack(shellIssueId);
    controlAfter = await readBack(controlIssueId);
    treeIdsAfter = await treeIds();
  });

  afterAll(async () => {
    await linkDb.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await linkDb.integration.delete({ where: { id: integrationId } });
    await linkDb.projects.delete({ where: { id: projectId } });
    await linkDb.user.delete({ where: { id: adminUserId } });
    await linkDb.$disconnect();
  });

  it("a reference-created shell has isRequirement false and issueTypeId NULL immediately after attach", () => {
    expect(shellBefore.isRequirement).toBe(false);
    expect(shellBefore.issueTypeId).toBeNull();
  });

  it("running the recompute with the referenced tracker issue's type id in the added list classifies the control row while leaving the reference shell unclassified in the same call", () => {
    // Confirms the "classify" flip below is a real state change, not a
    // no-op on a row that was already true.
    expect(controlBefore.isRequirement).toBe(false);
    // Only the control row's type matches — exactly one row classified,
    // proving the call was real rather than a no-op that happened to
    // touch zero rows.
    expect(recomputeResult.classified).toBe(1);
    expect(
      shellAfter.isRequirement,
      "a reference shell with no issueTypeId must never be swept into the tree by a project-wide recompute"
    ).toBe(false);
    expect(shellAfter.issueTypeId).toBeNull();
    expect(
      controlAfter.isRequirement,
      "the control row (seeded WITH the matching issueTypeId) must be classified by the same recompute call — otherwise the shell's exclusion above would be unprovable"
    ).toBe(true);
  });

  it("a query spreading REQUIREMENT_SCOPE_WHERE never returns the shell, before or after the recompute", () => {
    expect(treeIdsBefore).not.toContain(shellIssueId);
    expect(treeIdsAfter).not.toContain(shellIssueId);
    // The control row DOES appear post-recompute — confirms this project
    // actually changed, not merely one where nothing was ever eligible to
    // appear.
    expect(treeIdsBefore).not.toContain(controlIssueId);
    expect(treeIdsAfter).toContain(controlIssueId);
  });
});

// ---------------------------------------------------------------------------
// Label-mode recompute — the typeless-tracker twin statements. GitHub rows
// carry no issueTypeId; their designation vocabulary is label names stored
// at Issue.data->'labels' by buildSyncedIssueData. This block proves the
// four semantics the SQL pair must hold, against real jsonb:
//   1. classify-by-label reaches only synced, typeless, live rows;
//   2. a typed row is NEVER classified through a label/type-id collision;
//   3. a native row (no integrationId) is never scanned;
//   4. removing one label keeps a row classified while ANOTHER configured
//      label remains (nextEffectiveTypeIds), and declassifies it when
//      nothing remains.
//
// A DEDICATED raw client, same reasoning as linkDb above: the earlier
// blocks' afterAll hooks disconnect their own pools before this block runs.
const labelDb = createRawDbClient();

describeIntegration("label-mode recompute (typeless trackers, live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let integrationId: number;

  let labeledUnclassifiedId: number;
  let multiLabelClassifiedId: number;
  let singleLabelClassifiedId: number;
  let typedCollisionId: number;
  let nativeWithLabelsId: number;
  let nullDataId: number;

  const allIssueIds: number[] = [];

  let firstResult: { classified: number; declassified: number };
  let secondResult: { classified: number; declassified: number };
  let afterClassify: Map<number, boolean>;
  let afterRemoval: Map<number, boolean>;

  async function snapshot(): Promise<Map<number, boolean>> {
    const rows = await labelDb.issue.findMany({
      where: { id: { in: allIssueIds } },
      select: { id: true, isRequirement: true },
    });
    return new Map(rows.map((row) => [row.id, row.isRequirement]));
  }

  beforeAll(async () => {
    const [{ current_database: dbName }] = await labelDb.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_req20" && dbName !== "tpi_test") {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite only runs against the tpi_req20 scratch DB (or tpi_test in CI)`
      );
    }

    const role = await labelDb.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");

    const admin = await labelDb.user.create({
      data: {
        email: `${STAMP}-label-admin@example.com`,
        name: `Label Recompute Admin ${STAMP}`,
        authMethod: "INTERNAL",
        access: "ADMIN",
        accessSource: "MANUAL",
        roleId: role.id,
        password: "$2a$10$placeholderplaceholderplaceholderplaceholder",
      },
      select: { id: true },
    });
    adminUserId = admin.id;

    const project = await labelDb.projects.create({
      data: { name: `${STAMP}-label-project`, createdBy: adminUserId },
      select: { id: true },
    });
    projectId = project.id;

    const integration = await labelDb.integration.create({
      data: {
        name: `${STAMP}-label-github`,
        provider: "GITHUB",
        authType: "API_KEY",
        status: "ACTIVE",
        credentials: {},
        settings: {},
      },
      select: { id: true },
    });
    integrationId = integration.id;

    async function createIssue(
      name: string,
      overrides: Record<string, unknown> = {}
    ) {
      const issue = await labelDb.issue.create({
        data: {
          name: `${STAMP}-${name}`,
          title: `${STAMP}-${name}`,
          createdById: adminUserId,
          projectId,
          ...overrides,
        },
        select: { id: true },
      });
      allIssueIds.push(issue.id);
      return issue.id;
    }

    labeledUnclassifiedId = await createIssue("label-unclassified", {
      integrationId,
      externalId: `${STAMP}-lbl-1`,
      data: { labels: ["epic", "misc"] },
      isRequirement: false,
    });
    multiLabelClassifiedId = await createIssue("label-multi-classified", {
      integrationId,
      externalId: `${STAMP}-lbl-2`,
      data: { labels: ["epic", "requirement"] },
      isRequirement: true,
    });
    singleLabelClassifiedId = await createIssue("label-single-classified", {
      integrationId,
      externalId: `${STAMP}-lbl-3`,
      data: { labels: ["epic"] },
      isRequirement: true,
    });
    // A TYPED row whose label collides with the configured entry — the
    // precedence contract says the type column governs, so the label
    // statements must exclude it (issueTypeId IS NULL).
    typedCollisionId = await createIssue("label-typed-collision", {
      integrationId,
      externalId: `${STAMP}-lbl-4`,
      issueTypeId: "30001",
      data: { labels: ["epic"] },
      isRequirement: false,
    });
    // Native row (no integrationId). A real native row never has labels;
    // seeding some anyway proves the integrationId guard alone keeps it
    // out of the scan.
    nativeWithLabelsId = await createIssue("label-native", {
      data: { labels: ["epic"] },
      isRequirement: false,
    });
    nullDataId = await createIssue("label-null-data", {
      integrationId,
      externalId: `${STAMP}-lbl-6`,
      isRequirement: false,
    });

    // Call 1 — the admin configures ["epic", "requirement"]; "epic" is the
    // newly-added entry.
    firstResult = await recomputeRequirementClassification(
      projectId,
      ["epic"],
      [],
      { nextEffectiveTypeIds: ["epic", "requirement"] }
    );
    afterClassify = await snapshot();

    // Call 2 — the admin removes "epic"; "requirement" remains configured.
    secondResult = await recomputeRequirementClassification(
      projectId,
      [],
      ["epic"],
      { nextEffectiveTypeIds: ["requirement"] }
    );
    afterRemoval = await snapshot();
  });

  afterAll(async () => {
    await labelDb.issue.deleteMany({ where: { id: { in: allIssueIds } } });
    await labelDb.projects.delete({ where: { id: projectId } });
    await labelDb.integration.delete({ where: { id: integrationId } });
    await labelDb.user.delete({ where: { id: adminUserId } });
    await labelDb.$disconnect();
  });

  it("classifies a synced typeless row carrying an added label, and only that row", () => {
    expect(firstResult).toEqual({ classified: 1, declassified: 0 });
    expect(afterClassify.get(labeledUnclassifiedId)).toBe(true);
  });

  it("never classifies a typed row through a label/type-id collision", () => {
    expect(afterClassify.get(typedCollisionId)).toBe(false);
    expect(afterRemoval.get(typedCollisionId)).toBe(false);
  });

  it("never scans native rows or rows with no stored labels", () => {
    expect(afterClassify.get(nativeWithLabelsId)).toBe(false);
    expect(afterClassify.get(nullDataId)).toBe(false);
  });

  it("keeps a multi-label row classified while another configured label remains, declassifies the rest", () => {
    expect(secondResult).toEqual({ classified: 0, declassified: 2 });
    // Still carries "requirement", which stayed configured.
    expect(afterRemoval.get(multiLabelClassifiedId)).toBe(true);
    // Their only configured label was removed.
    expect(afterRemoval.get(singleLabelClassifiedId)).toBe(false);
    expect(afterRemoval.get(labeledUnclassifiedId)).toBe(false);
  });
});
