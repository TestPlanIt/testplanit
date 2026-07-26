/**
 * Live-DB integration test for cancelling in-flight reviews when their subject
 * is soft-deleted.
 *
 * Background: nothing in the delete paths touched ReviewRequest, so deleting a
 * case, run, or session left its PENDING reviews sitting in reviewers' queues
 * pointing at work that no longer existed. The `ew` database had 230 such rows
 * when this was written.
 *
 * The rule lives in `sideEffectsPlugin`'s afterEntityMutation hook, which only
 * runs inside the ORM's real mutation pipeline — a mocked client never reaches
 * it, and the whole point is that the flip commits in the same transaction as
 * the delete. So this drives the real `baseDb` against the test DB.
 *
 * Execution model (matches lib/auth/projectDefaultAccess.integration.test.ts):
 *   - Skipped by default. Opt-in with `RUN_DB_INTEGRATION=1`.
 *   - Requires DATABASE_URL pointing at a seeded development/test database
 *     (needs at least one Workflows + Templates row).
 *   - Creates committed fixtures in `beforeAll`, removes them in `afterAll`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);

const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("soft-delete cancels in-flight reviews (live DB)", () => {
  let baseDb: typeof import("~/lib/db").baseDb;

  const created = {
    reviewRequestIds: [] as string[],
    caseIds: [] as number[],
    folderId: 0,
    repositoryId: 0,
    projectId: 0,
    userId: "",
    reviewerId: "",
  };

  let stateA = 0;
  let stateB = 0;

  /** Create a case plus a review request in the given status. */
  async function makeCaseUnderReview(
    label: string,
    status: "PENDING" | "APPROVED"
  ): Promise<{ caseId: number; reviewId: string }> {
    const tpl = await baseDb.templates.findFirst({ select: { id: true } });
    const row = await baseDb.repositoryCases.create({
      data: {
        projectId: created.projectId,
        repositoryId: created.repositoryId,
        folderId: created.folderId,
        templateId: tpl!.id,
        name: `RC-${label}`,
        stateId: stateA,
        creatorId: created.userId,
        hasParameters: false,
      },
      select: { id: true },
    });
    const review = await baseDb.reviewRequest.create({
      data: {
        projectId: created.projectId,
        entityType: "CASE",
        entityId: row.id,
        requestedByUserId: created.userId,
        assigneeUserId: created.reviewerId,
        fromStateId: stateA,
        toStateId: stateB,
        status,
      },
      select: { id: true },
    });
    created.caseIds.push(row.id);
    created.reviewRequestIds.push(review.id);
    return { caseId: row.id, reviewId: review.id };
  }

  const statusOf = async (id: string) =>
    (
      await baseDb.reviewRequest.findUnique({
        where: { id },
        select: { status: true },
      })
    )?.status;

  beforeAll(async () => {
    ({ baseDb } = await import("~/lib/db"));

    const states = await baseDb.workflows.findMany({
      select: { id: true },
      take: 2,
    });
    if (states.length < 2) throw new Error("Seed the DB first (<2 Workflows)");
    stateA = states[0].id;
    stateB = states[1].id;

    const tpl = await baseDb.templates.findFirst({ select: { id: true } });
    if (!tpl) throw new Error("Seed the DB first (no Templates row)");

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const role = await baseDb.roles.findFirst({ select: { id: true } });
    if (!role) throw new Error("Seed the DB first (no Roles row)");

    const owner = await baseDb.user.create({
      data: {
        email: `rc-${stamp}@example.test`,
        name: `RC Owner ${stamp}`,
        access: "ADMIN",
        roleId: role.id,
      },
      select: { id: true },
    });
    created.userId = owner.id;

    // A separate reviewer: the schema forbids the requester being their own
    // direct assignee.
    const reviewer = await baseDb.user.create({
      data: {
        email: `rc-rev-${stamp}@example.test`,
        name: `RC Reviewer ${stamp}`,
        access: "USER",
        roleId: role.id,
      },
      select: { id: true },
    });
    created.reviewerId = reviewer.id;

    const project = await baseDb.projects.create({
      data: {
        name: `RC-Cancel-${stamp}`,
        createdBy: owner.id,
        reviewWorkflowEnabled: true,
      },
      select: { id: true },
    });
    created.projectId = project.id;

    const repo = await baseDb.repositories.create({
      data: { projectId: project.id },
      select: { id: true },
    });
    created.repositoryId = repo.id;

    const folder = await baseDb.repositoryFolders.create({
      data: {
        name: `RC-Folder-${stamp}`,
        repositoryId: repo.id,
        projectId: project.id,
        creatorId: owner.id,
      },
      select: { id: true },
    });
    created.folderId = folder.id;
  }, 60_000);

  afterAll(async () => {
    if (!created.projectId) return;
    // Children first: ReviewRequest cascades on the project, but the cases are
    // removed explicitly so a partial failure leaves no orphans behind.
    await baseDb.reviewRequest.deleteMany({
      where: { id: { in: created.reviewRequestIds } },
    });
    await baseDb.repositoryCases.deleteMany({
      where: { id: { in: created.caseIds } },
    });
    await baseDb.repositoryFolders.deleteMany({
      where: { id: created.folderId },
    });
    await baseDb.repositories.deleteMany({
      where: { id: created.repositoryId },
    });
    await baseDb.projects.deleteMany({ where: { id: created.projectId } });
    await baseDb.user.deleteMany({
      where: { id: { in: [created.userId, created.reviewerId] } },
    });
  }, 60_000);

  it("cancels a PENDING review when its case is soft-deleted", async () => {
    const { caseId, reviewId } = await makeCaseUnderReview(
      "pending",
      "PENDING"
    );
    expect(await statusOf(reviewId)).toBe("PENDING");

    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { isDeleted: true },
    });

    expect(await statusOf(reviewId)).toBe("CANCELLED");
  }, 60_000);

  it("leaves an already-decided review alone", async () => {
    const { caseId, reviewId } = await makeCaseUnderReview(
      "decided",
      "APPROVED"
    );

    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { isDeleted: true },
    });

    expect(await statusOf(reviewId)).toBe("APPROVED");
  }, 60_000);

  it("does not re-cancel when an already-deleted case is saved again", async () => {
    const { caseId, reviewId } = await makeCaseUnderReview("resave", "PENDING");

    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { isDeleted: true },
    });
    expect(await statusOf(reviewId)).toBe("CANCELLED");

    // Put the row back into PENDING by hand, then save the (still-deleted) case
    // again. The rule fires on the false → true edge only, so this must not
    // touch it — proving a repeat save can't re-cancel or re-notify.
    await baseDb.reviewRequest.update({
      where: { id: reviewId },
      data: { status: "PENDING" },
    });
    await baseDb.repositoryCases.update({
      where: { id: caseId },
      data: { isDeleted: true, name: "RC-resave-touched" },
    });

    expect(await statusOf(reviewId)).toBe("PENDING");
  }, 60_000);

  it("cancels every pending review in a bulk soft-delete", async () => {
    const a = await makeCaseUnderReview("bulk-a", "PENDING");
    const b = await makeCaseUnderReview("bulk-b", "PENDING");

    await baseDb.repositoryCases.updateMany({
      where: { id: { in: [a.caseId, b.caseId] } },
      data: { isDeleted: true },
    });

    expect(await statusOf(a.reviewId)).toBe("CANCELLED");
    expect(await statusOf(b.reviewId)).toBe("CANCELLED");
  }, 60_000);
});
