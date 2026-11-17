// Live-DB proof of the relation writes the session and test-run save paths
// send. Both pages replace a record's tags and attachments in one update. The
// shape `{ set: [], connect: [...] }` reads as "clear, then add" but ZenStack
// applies `connect` before `set`, so it cleared the relation on every save; a
// lone `set` carrying the full list is the shape that works.
//
// Run via (scratch DB only — never the .env DATABASE_URL, which is `ew`):
//   DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 pnpm exec vitest run \
//     __tests__/integration/session-relation-set.integration.test.ts

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRawDbClient } from "~/lib/rawDbClient";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const STAMP = `srs-${Date.now().toString(36)}`;

describeIntegration("session tag and attachment writes (live DB)", () => {
  let adminUserId: string;
  let projectId: number;
  let sessionId: number;
  let tagA: number;
  let tagB: number;
  let tagC: number;
  let attachmentKept: number;
  let attachmentDropped: number;

  const sessionTagIds = async () => {
    const row = await db.sessions.findUniqueOrThrow({
      where: { id: sessionId },
      select: { tags: { select: { id: true } } },
    });
    return row.tags.map((tag) => tag.id).sort((a, b) => a - b);
  };

  const sessionAttachmentIds = async () => {
    const rows = await db.attachments.findMany({
      where: { sessionId },
      select: { id: true },
    });
    return rows.map((row) => row.id).sort((a, b) => a - b);
  };

  beforeAll(async () => {
    const [{ current_database: dbName }] = await db.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (dbName !== "tpi_test" && !dbName.startsWith("tpi_")) {
      throw new Error(
        `refusing to run against database "${dbName}" — this suite hard-deletes fixtures and only runs against a tpi_* scratch DB (or tpi_test in CI)`
      );
    }

    const role = await db.roles.findFirst({
      where: { isDefault: true, isDeleted: false },
      select: { id: true },
    });
    if (!role) throw new Error("Test prerequisite: no default role row");
    const template = await db.templates.findFirst({
      where: { isDeleted: false },
      select: { id: true },
    });
    if (!template) throw new Error("Test prerequisite: no Templates row");
    const sessionState = await db.workflows.findFirst({
      where: { scope: "SESSIONS", isDeleted: false, isEnabled: true },
      select: { id: true },
    });
    if (!sessionState)
      throw new Error("Test prerequisite: no SESSIONS-scoped Workflows row");

    const admin = await db.user.create({
      data: {
        email: `${STAMP}-admin@example.com`,
        name: `Session Relation Admin ${STAMP}`,
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

    [tagA, tagB, tagC] = await Promise.all(
      ["a", "b", "c"].map(async (label) => {
        const tag = await db.tags.create({
          data: { name: `${STAMP}-${label}` },
          select: { id: true },
        });
        return tag.id;
      })
    );

    const session = await db.sessions.create({
      data: {
        name: `${STAMP}-session`,
        projectId,
        templateId: template.id,
        stateId: sessionState.id,
        createdById: adminUserId,
      },
      select: { id: true },
    });
    sessionId = session.id;

    [attachmentKept, attachmentDropped] = await Promise.all(
      ["kept", "dropped"].map(async (label) => {
        const attachment = await db.attachments.create({
          data: {
            name: `${STAMP}-${label}.txt`,
            url: `https://example.com/${STAMP}-${label}.txt`,
            mimeType: "text/plain",
            size: BigInt(1),
            createdById: adminUserId,
            sessionId,
          },
          select: { id: true },
        });
        return attachment.id;
      })
    );
  });

  afterAll(async () => {
    await db.attachments.deleteMany({
      where: { id: { in: [attachmentKept, attachmentDropped] } },
    });
    await db.sessions.deleteMany({ where: { id: sessionId } });
    await db.tags.deleteMany({ where: { id: { in: [tagA, tagB, tagC] } } });
    await db.projects.deleteMany({ where: { id: projectId } });
    await db.user.deleteMany({ where: { id: adminUserId } });
    await db.$disconnect();
  });

  it("a lone `set` leaves the session with exactly the listed tags", async () => {
    await db.sessions.update({
      where: { id: sessionId },
      data: { tags: { set: [{ id: tagA }, { id: tagB }] } },
    });
    expect(await sessionTagIds()).toEqual([tagA, tagB].sort((a, b) => a - b));

    // An unchanged save: the same list again keeps every tag
    await db.sessions.update({
      where: { id: sessionId },
      data: { tags: { set: [{ id: tagA }, { id: tagB }] } },
    });
    expect(await sessionTagIds()).toEqual([tagA, tagB].sort((a, b) => a - b));

    await db.sessions.update({
      where: { id: sessionId },
      data: { tags: { set: [{ id: tagB }, { id: tagC }] } },
    });
    expect(await sessionTagIds()).toEqual([tagB, tagC].sort((a, b) => a - b));
  });

  it("a lone `set` keeps the listed attachments and unlinks the rest", async () => {
    await db.sessions.update({
      where: { id: sessionId },
      data: {
        attachments: {
          set: [{ id: attachmentKept }, { id: attachmentDropped }],
        },
      },
    });
    expect(await sessionAttachmentIds()).toEqual(
      [attachmentKept, attachmentDropped].sort((a, b) => a - b)
    );

    await db.sessions.update({
      where: { id: sessionId },
      data: { attachments: { set: [{ id: attachmentKept }] } },
    });
    expect(await sessionAttachmentIds()).toEqual([attachmentKept]);
  });

  // Why eslint bans this shape. If ZenStack ever applies `set` first this
  // fails, and the lint rule can go.
  it("`set: []` beside `connect` clears the relation", async () => {
    await db.sessions.update({
      where: { id: sessionId },
      data: { tags: { set: [{ id: tagA }] } },
    });

    await db.sessions.update({
      where: { id: sessionId },
      data: { tags: { set: [], connect: [{ id: tagA }] } },
    });

    expect(await sessionTagIds()).toEqual([]);
  });
});
