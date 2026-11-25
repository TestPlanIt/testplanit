import { describe, expect, it, vi } from "vitest";
import { aiDraftState, markAiWritten } from "./aiDrafts";

describe("aiDraftState", () => {
  it("asks for the first enabled flagged case state the project uses", async () => {
    const db = {
      workflows: {
        findFirst: vi.fn().mockResolvedValue({ id: 21, name: "AI-Generated" }),
      },
    };
    expect(await aiDraftState(db, 7)).toEqual({ id: 21, name: "AI-Generated" });
    expect(db.workflows.findFirst).toHaveBeenCalledWith({
      where: {
        scope: "CASES",
        isAiDraft: true,
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId: 7 } },
      },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    });
  });

  it("returns null when the project has none", async () => {
    const db = { workflows: { findFirst: vi.fn().mockResolvedValue(null) } };
    expect(await aiDraftState(db, 7)).toBeNull();
  });
});

describe("markAiWritten", () => {
  const makeDb = () => ({
    repositoryCases: {
      findMany: vi.fn().mockResolvedValue([
        { id: 1, currentVersion: 1 },
        { id: 2, currentVersion: 4 },
      ]),
      update: vi.fn().mockResolvedValue({}),
    },
    repositoryCaseIssue: { updateMany: vi.fn().mockResolvedValue({}) },
  });

  it("records each case's own current version and stamps the links", async () => {
    const db = makeDb();
    const at = new Date("2026-11-24T10:00:00Z");
    await markAiWritten(db, [1, 2], 100, at);
    expect(db.repositoryCases.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 1 }, data: { aiWrittenVersion: 1 } },
      { where: { id: 2 }, data: { aiWrittenVersion: 4 } },
    ]);
    expect(db.repositoryCaseIssue.updateMany).toHaveBeenCalledWith({
      where: { issueId: 100, caseId: { in: [1, 2] } },
      data: { alignedAt: at },
    });
  });

  it("does nothing for no cases", async () => {
    const db = makeDb();
    await markAiWritten(db, [], 100);
    expect(db.repositoryCases.findMany).not.toHaveBeenCalled();
    expect(db.repositoryCaseIssue.updateMany).not.toHaveBeenCalled();
  });
});
