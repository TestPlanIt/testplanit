import { beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted so the mock is available before the vi.mock factory runs
const { mockConfigurations } = vi.hoisted(() => ({
  mockConfigurations: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    configurations: mockConfigurations,
  },
}));

import { searchConfigurations } from "./searchConfigurations";

describe("searchConfigurations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigurations.findMany.mockResolvedValue([{ id: 1, name: "Chrome" }]);
    mockConfigurations.count.mockResolvedValue(1);
  });

  it("scopes the query to the project when projectId is provided", async () => {
    await searchConfigurations("", 0, 20, 42);

    const where = mockConfigurations.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      isDeleted: false,
      isEnabled: true,
      projects: { some: { projectId: 42 } },
    });
    // count uses the same where clause
    expect(mockConfigurations.count.mock.calls[0][0].where).toEqual(where);
  });

  it("does not scope to a project when projectId is omitted (global)", async () => {
    await searchConfigurations("", 0, 20);

    const where = mockConfigurations.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("projects");
  });

  it("adds a case-insensitive name filter when a query is given", async () => {
    await searchConfigurations("  edge  ", 1, 10, 7);

    const where = mockConfigurations.findMany.mock.calls[0][0].where;
    expect(where.name).toEqual({ contains: "edge", mode: "insensitive" });
    expect(where.projects).toEqual({ some: { projectId: 7 } });
  });

  it("paginates with skip/take derived from page and pageSize", async () => {
    await searchConfigurations("", 2, 25, 7);

    const args = mockConfigurations.findMany.mock.calls[0][0];
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
  });

  it("returns empty results when the query throws", async () => {
    mockConfigurations.findMany.mockRejectedValue(new Error("boom"));

    const result = await searchConfigurations("", 0, 20, 7);

    expect(result).toEqual({ results: [], total: 0 });
  });
});
