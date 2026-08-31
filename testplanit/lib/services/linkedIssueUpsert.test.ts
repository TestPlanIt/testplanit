// Unit-lane proof for the ONE reviewed raw-write shell (PROV-06). Proves the
// shell strips exactly the locked field set from the update payload, and
// only when the existing row is a synced, non-detached requirement — every
// other case (detached, non-requirement, no existing row) and every other
// key (relation connects, name, data, externalKey) must survive untouched.
// The create payload is never stripped, in any case.
//
// Run via:
//   cd testplanit && pnpm exec vitest run lib/services/linkedIssueUpsert.test.ts

import { describe, expect, it, vi } from "vitest";

import {
  LOCKED_ISSUE_FIELDS,
  upsertLinkedIssueShell,
} from "./linkedIssueUpsert";

function makeDb(existingRow: unknown, upsertResult: unknown = { id: 1 }) {
  return {
    issue: {
      findUnique: vi.fn().mockResolvedValue(existingRow),
      upsert: vi.fn().mockResolvedValue(upsertResult),
    },
  };
}

describe("upsertLinkedIssueShell (PROV-06 reviewed raw-write shell)", () => {
  it("strips locked fields from the update payload when the existing row is a synced, non-detached requirement", async () => {
    const db = makeDb({
      id: 1,
      isRequirement: true,
      integrationId: 5,
      requirementDetachedAt: null,
    });

    await upsertLinkedIssueShell(db, {
      externalId: "PROJ-1",
      integrationId: 5,
      create: { title: "irrelevant on the update path", name: "PROJ-1" },
      update: {
        title: "hijacked title",
        description: "hijacked description",
        status: "Done",
        priority: "high",
        parentId: 99,
        name: "PROJ-1",
        externalKey: "PROJ-1",
        data: { jiraKey: "PROJ-1" },
      },
    });

    expect(db.issue.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = db.issue.upsert.mock.calls[0][0];
    for (const field of LOCKED_ISSUE_FIELDS) {
      expect(upsertArgs.update).not.toHaveProperty(field);
    }
    // Everything else survives unchanged.
    expect(upsertArgs.update.name).toBe("PROJ-1");
    expect(upsertArgs.update.externalKey).toBe("PROJ-1");
    expect(upsertArgs.update.data).toEqual({ jiraKey: "PROJ-1" });
  });

  it("passes relation-connect keys through untouched on a locked row", async () => {
    const db = makeDb({
      id: 1,
      isRequirement: true,
      integrationId: 5,
      requirementDetachedAt: null,
    });

    await upsertLinkedIssueShell(db, {
      externalId: "PROJ-2",
      integrationId: 5,
      create: {},
      update: {
        title: "hijacked title",
        testRuns: { connect: { id: 42 } },
      },
    });

    const upsertArgs = db.issue.upsert.mock.calls[0][0];
    expect(upsertArgs.update).not.toHaveProperty("title");
    expect(upsertArgs.update.testRuns).toEqual({ connect: { id: 42 } });
  });

  // Flipped from the original "still writable after detach" pin: once
  // detached the USER owns the locked-field content, so a tracker-sourced
  // shell refresh must not clobber local edits — only the mirror columns
  // pass through.
  it("strips locked fields from the update payload when the existing row is DETACHED — mirrors still pass through", async () => {
    const db = makeDb({
      id: 1,
      isRequirement: true,
      integrationId: 5,
      requirementDetachedAt: new Date("2026-01-01T00:00:00Z"),
    });

    await upsertLinkedIssueShell(db, {
      externalId: "PROJ-3",
      integrationId: 5,
      create: {},
      update: {
        title: "tracker copy of the title",
        priority: "High",
        externalStatus: "In Review",
        externalPriority: "High",
      },
    });

    const upsertArgs = db.issue.upsert.mock.calls[0][0];
    expect(upsertArgs.update).not.toHaveProperty("title");
    expect(upsertArgs.update).not.toHaveProperty("priority");
    expect(upsertArgs.update.externalStatus).toBe("In Review");
    expect(upsertArgs.update.externalPriority).toBe("High");
  });

  it("passes the update payload through with title intact when the existing row is not a requirement", async () => {
    const db = makeDb({
      id: 1,
      isRequirement: false,
      integrationId: 5,
      requirementDetachedAt: null,
    });

    await upsertLinkedIssueShell(db, {
      externalId: "PROJ-4",
      integrationId: 5,
      create: {},
      update: { title: "ordinary defect title" },
    });

    const upsertArgs = db.issue.upsert.mock.calls[0][0];
    expect(upsertArgs.update.title).toBe("ordinary defect title");
  });

  it("passes both create and update through untouched when no existing row is found", async () => {
    const db = makeDb(null);

    await upsertLinkedIssueShell(db, {
      externalId: "PROJ-5",
      integrationId: 5,
      create: { title: "brand new", name: "PROJ-5" },
      update: { title: "brand new update" },
    });

    const upsertArgs = db.issue.upsert.mock.calls[0][0];
    expect(upsertArgs.create).toEqual({ title: "brand new", name: "PROJ-5" });
    expect(upsertArgs.update).toEqual({ title: "brand new update" });
  });

  it("never strips the create payload, even for a locked row", async () => {
    const db = makeDb({
      id: 1,
      isRequirement: true,
      integrationId: 5,
      requirementDetachedAt: null,
    });
    const create = {
      title: "create-branch title",
      description: "create-branch description",
      status: "Open",
      priority: "high",
      parentId: 7,
    };

    await upsertLinkedIssueShell(db, {
      externalId: "PROJ-6",
      integrationId: 5,
      create,
      update: {},
    });

    const upsertArgs = db.issue.upsert.mock.calls[0][0];
    expect(upsertArgs.create).toEqual(create);
  });
});
