/**
 * The import's `issues` column used to drop anything it couldn't match by
 * name, without a word. This module is what turns those cells into either a
 * resolved tracker ticket or a stated reason, and it has two contracts worth
 * pinning: it must not spend a tracker call on a name a local row already
 * answers to, and it must keep the column's defects-only scope even when a key
 * resolves perfectly well — a requirement link this column writes is one no
 * later import can clear.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveIssueKeys = vi.fn();

class FakeIssueKeyResolutionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

vi.mock("~/lib/services/resolveIssueKeys", () => ({
  resolveIssueKeys: (...args: unknown[]) => resolveIssueKeys(...args),
  IssueKeyResolutionError: FakeIssueKeyResolutionError,
}));

const { resolveImportIssueKeys } = await import("./importIssueKeyResolution");

const findFirst = vi.fn();
const db = { issue: { findFirst: (...args: unknown[]) => findFirst(...args) } };

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null);
  resolveIssueKeys.mockResolvedValue(new Map());
});

describe("resolveImportIssueKeys", () => {
  it("leaves names an existing row answers to alone", async () => {
    findFirst.mockResolvedValue({ id: 4 });

    const out = await resolveImportIssueKeys(db, {
      projectId: 1,
      names: ["Login bug"],
    });

    expect(resolveIssueKeys).not.toHaveBeenCalled();
    expect(out.idsByName.size).toBe(0);
    expect(out.errorsByName.size).toBe(0);
  });

  it("resolves a name no local row answers to as a tracker key", async () => {
    // Name lookup misses; the post-resolution defect re-read finds the row.
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 88 });
    resolveIssueKeys.mockResolvedValue(
      new Map([["PROJ-3", { key: "PROJ-3", issueId: 88, created: true }]])
    );

    const out = await resolveImportIssueKeys(db, {
      projectId: 1,
      names: ["PROJ-3"],
    });

    expect(out.idsByName.get("PROJ-3")).toBe(88);
    expect(out.errorsByName.size).toBe(0);
  });

  it("deduplicates the file's cells before resolving", async () => {
    await resolveImportIssueKeys(db, {
      projectId: 1,
      names: ["PROJ-3", " PROJ-3 ", "PROJ-3", ""],
    });

    expect(resolveIssueKeys).toHaveBeenCalledTimes(1);
    expect(resolveIssueKeys.mock.calls[0][0].keys).toEqual(["PROJ-3"]);
  });

  it("refuses to link a key that resolves to a requirement, and says why", async () => {
    // Name lookup misses, and the defect-scoped re-read misses too — the
    // resolved row exists but is classified as a requirement.
    findFirst.mockResolvedValue(null);
    resolveIssueKeys.mockResolvedValue(
      new Map([["REQ-1", { key: "REQ-1", issueId: 12 }]])
    );

    const out = await resolveImportIssueKeys(db, {
      projectId: 1,
      names: ["REQ-1"],
    });

    expect(out.idsByName.has("REQ-1")).toBe(false);
    expect(out.errorsByName.get("REQ-1")).toMatch(/tracked as a requirement/);
  });

  it("explains an unresolvable key instead of dropping it", async () => {
    resolveIssueKeys.mockResolvedValue(
      new Map([["NOPE-1", { key: "NOPE-1", error: "Issue does not exist" }]])
    );

    const out = await resolveImportIssueKeys(db, {
      projectId: 1,
      names: ["NOPE-1"],
    });

    expect(out.errorsByName.get("NOPE-1")).toMatch(/Issue does not exist/);
  });

  it("survives a project with no tracker configured", async () => {
    resolveIssueKeys.mockRejectedValue(
      new FakeIssueKeyResolutionError("no integration", 400)
    );

    const out = await resolveImportIssueKeys(db, {
      projectId: 1,
      names: ["Whatever"],
    });

    expect(out.idsByName.size).toBe(0);
    expect(out.errorsByName.get("Whatever")).toMatch(
      /No issue named "Whatever" in this project\. no integration/
    );
  });

  it("does nothing for a file with no issue cells", async () => {
    const out = await resolveImportIssueKeys(db, { projectId: 1, names: [] });

    expect(findFirst).not.toHaveBeenCalled();
    expect(resolveIssueKeys).not.toHaveBeenCalled();
    expect(out.idsByName.size).toBe(0);
  });
});
