import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted so the mock is available before the vi.mock factory runs
const { mockProjects } = vi.hoisted(() => ({
  mockProjects: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    projects: mockProjects,
  },
}));

import { searchProjects } from "./searchProjects";

describe("searchProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjects.findMany.mockResolvedValue([{ id: 1, name: "Demo Project" }]);
    mockProjects.count.mockResolvedValue(1);
  });

  it("excludes soft-deleted projects", async () => {
    await searchProjects("", 0, 20);

    const where = mockProjects.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isDeleted: false });
    expect(where).not.toHaveProperty("name");
    expect(mockProjects.count.mock.calls[0][0].where).toEqual(where);
  });

  it("adds a case-insensitive name filter when a query is given", async () => {
    await searchProjects("  demo  ", 0, 20);

    const where = mockProjects.findMany.mock.calls[0][0].where;
    expect(where.name).toEqual({ contains: "demo", mode: "insensitive" });
  });

  it("paginates with skip/take derived from page and pageSize", async () => {
    await searchProjects("", 3, 15);

    const args = mockProjects.findMany.mock.calls[0][0];
    expect(args.skip).toBe(45);
    expect(args.take).toBe(15);
  });

  it("returns the paginated results and total", async () => {
    mockProjects.findMany.mockResolvedValue([
      { id: 1, name: "Demo Project" },
      { id: 2, name: "Other" },
    ]);
    mockProjects.count.mockResolvedValue(2);

    const result = await searchProjects("", 0, 20);

    expect(result).toEqual({
      results: [
        { id: 1, name: "Demo Project" },
        { id: 2, name: "Other" },
      ],
      total: 2,
    });
  });

  it("returns empty results when the query throws", async () => {
    mockProjects.findMany.mockRejectedValue(new Error("boom"));

    const result = await searchProjects("", 0, 20);

    expect(result).toEqual({ results: [], total: 0 });
  });
});
