// Live-DB integration proof for HIER-06 — discrete file attachments on a
// requirement via the new Attachments.issueId FK (landed in 25-01,
// schema.zmodel + tpi_req20/ew). Proves the one-nullable-FK-per-entity
// idiom behaves identically for Issue as it already does for every other
// Attachments consumer (testCaseId, sessionId, ...), and that attachments
// are NOT a locked field on a synced, non-detached requirement.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirement-attachments.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";
import { isRequirementLocked } from "~/lib/services/linkedIssueUpsert";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `att-${Date.now()}`;

describeIntegration(
  "requirement attachments via Attachments.issueId (live DB)",
  () => {
    let adminUserId: string;
    let projectId: number;
    let integrationId: number;
    let nativeRequirementId: number;
    let lockedRequirementId: number;
    // A second requirement, used only to prove the persisted-list read is
    // scoped to its own issueId and doesn't leak a sibling requirement's
    // attachments.
    let secondRequirementId: number;

    const allIssueIds: number[] = [];
    const allAttachmentIds: number[] = [];

    beforeAll(async () => {
      // Refuse to run against anything but a scratch database — the
      // worktree .env DATABASE_URL resolves to `ew`, and this suite writes
      // real Attachments/Issue rows through the raw client.
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
          name: `Attachments Admin ${STAMP}`,
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

      // A real Integration row, so the locked fixture below is bound to an
      // actual tracker the way a synced requirement really would be.
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

      async function createRequirement(
        name: string,
        extra: Record<string, unknown> = {}
      ): Promise<number> {
        const created = await db.issue.create({
          data: {
            name: `${STAMP}-${name}`,
            title: `${STAMP}-${name}`,
            createdById: adminUserId,
            projectId,
            isRequirement: true,
            ...extra,
          },
          select: { id: true },
        });
        allIssueIds.push(created.id);
        return created.id;
      }

      nativeRequirementId = await createRequirement("native-requirement");
      lockedRequirementId = await createRequirement("locked-requirement", {
        integrationId,
      });
      secondRequirementId = await createRequirement("second-requirement");
    });

    afterAll(async () => {
      await db.attachments.deleteMany({
        where: { id: { in: allAttachmentIds } },
      });
      await db.issue.deleteMany({ where: { id: { in: allIssueIds } } });
      await db.integration.delete({ where: { id: integrationId } });
      await db.projects.delete({ where: { id: projectId } });
      await db.user.delete({ where: { id: adminUserId } });

      const remainingAttachments = await db.attachments.count({
        where: { name: { startsWith: STAMP } },
      });
      const remainingIssues = await db.issue.count({
        where: { name: { startsWith: STAMP } },
      });
      const remainingProjects = await db.projects.count({
        where: { name: { startsWith: STAMP } },
      });
      console.log(
        `post-teardown stamp check (${STAMP}): attachments=${remainingAttachments}, issues=${remainingIssues}, projects=${remainingProjects}`
      );
      expect(remainingAttachments).toBe(0);
      expect(remainingIssues).toBe(0);
      expect(remainingProjects).toBe(0);

      await db.$disconnect();
    });

    it("creates an Attachments row bound to a requirement via issueId", async () => {
      const attachment = await db.attachments.create({
        data: {
          issueId: nativeRequirementId,
          url: `https://storage.example.com/${STAMP}-file-1.pdf`,
          name: `${STAMP}-file-1.pdf`,
          note: "",
          mimeType: "application/pdf",
          size: BigInt(1024),
          createdById: adminUserId,
        },
        select: { id: true, issueId: true },
      });
      allAttachmentIds.push(attachment.id);

      expect(attachment.issueId).toBe(nativeRequirementId);

      const readBack = await db.attachments.findUnique({
        where: { id: attachment.id },
      });
      expect(readBack?.issueId).toBe(nativeRequirementId);
    });

    it("reads back only that requirement's attachments, excluding soft-deleted rows", async () => {
      const ownAttachment = await db.attachments.create({
        data: {
          issueId: nativeRequirementId,
          url: `https://storage.example.com/${STAMP}-file-2.pdf`,
          name: `${STAMP}-file-2.pdf`,
          note: "",
          mimeType: "application/pdf",
          size: BigInt(2048),
          createdById: adminUserId,
        },
        select: { id: true },
      });
      allAttachmentIds.push(ownAttachment.id);

      const otherRequirementsAttachment = await db.attachments.create({
        data: {
          issueId: secondRequirementId,
          url: `https://storage.example.com/${STAMP}-file-3.pdf`,
          name: `${STAMP}-file-3.pdf`,
          note: "",
          mimeType: "application/pdf",
          size: BigInt(4096),
          createdById: adminUserId,
        },
        select: { id: true },
      });
      allAttachmentIds.push(otherRequirementsAttachment.id);

      const alreadySoftDeletedAttachment = await db.attachments.create({
        data: {
          issueId: nativeRequirementId,
          url: `https://storage.example.com/${STAMP}-file-4.pdf`,
          name: `${STAMP}-file-4.pdf`,
          note: "",
          mimeType: "application/pdf",
          size: BigInt(512),
          isDeleted: true,
          createdById: adminUserId,
        },
        select: { id: true },
      });
      allAttachmentIds.push(alreadySoftDeletedAttachment.id);

      const list = await db.attachments.findMany({
        where: { issueId: nativeRequirementId, isDeleted: false },
        select: { id: true },
      });
      const listedIds = list.map((row) => row.id);

      expect(listedIds).toContain(ownAttachment.id);
      expect(listedIds).not.toContain(otherRequirementsAttachment.id);
      expect(listedIds).not.toContain(alreadySoftDeletedAttachment.id);
    });

    it("soft-deletes an attachment by setting isDeleted rather than removing the row", async () => {
      const attachment = await db.attachments.create({
        data: {
          issueId: nativeRequirementId,
          url: `https://storage.example.com/${STAMP}-file-5.pdf`,
          name: `${STAMP}-file-5.pdf`,
          note: "",
          mimeType: "application/pdf",
          size: BigInt(256),
          createdById: adminUserId,
        },
        select: { id: true },
      });
      allAttachmentIds.push(attachment.id);

      await db.attachments.update({
        where: { id: attachment.id },
        data: { isDeleted: true },
      });

      // The row survives -- this is a soft-delete, never a real delete.
      const stillExists = await db.attachments.findUnique({
        where: { id: attachment.id },
      });
      expect(stillExists).not.toBeNull();
      expect(stillExists?.isDeleted).toBe(true);

      const excludedFromLiveList = await db.attachments.findMany({
        where: { issueId: nativeRequirementId, isDeleted: false },
        select: { id: true },
      });
      expect(excludedFromLiveList.map((row) => row.id)).not.toContain(
        attachment.id
      );
    });

    it("an attachment can be created on a synced, non-detached requirement — attachments are not a locked field", async () => {
      const lockedRow = await db.issue.findUnique({
        where: { id: lockedRequirementId },
        select: {
          isRequirement: true,
          integrationId: true,
          requirementDetachedAt: true,
        },
      });
      expect(lockedRow).not.toBeNull();
      // Fixture-drift guard: if a future change to this file (or the
      // schema's defaults) accidentally produces an unlocked row, fail
      // loudly here instead of the create/read assertions below silently
      // passing for the wrong reason.
      expect(isRequirementLocked(lockedRow)).toBe(true);

      const attachment = await db.attachments.create({
        data: {
          issueId: lockedRequirementId,
          url: `https://storage.example.com/${STAMP}-file-6.pdf`,
          name: `${STAMP}-file-6.pdf`,
          note: "",
          mimeType: "application/pdf",
          size: BigInt(128),
          createdById: adminUserId,
        },
        select: { id: true, issueId: true },
      });
      allAttachmentIds.push(attachment.id);

      expect(attachment.issueId).toBe(lockedRequirementId);

      const readBack = await db.attachments.findUnique({
        where: { id: attachment.id },
      });
      expect(readBack).not.toBeNull();
      expect(readBack?.isDeleted).toBe(false);
    });
  }
);
