import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindMany = vi.fn();
const mockCount = vi.fn();
const mockGetServerAuthSession = vi.fn();
const mockGetEnhancedDb = vi.fn();

vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mockGetServerAuthSession(),
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: (...args: any[]) => mockGetEnhancedDb(...args),
}));

import { searchIssues } from "./searchIssues";

describe("searchIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({ user: { id: "user-1" } });
    mockGetEnhancedDb.mockResolvedValue({
      issue: {
        findMany: (...args: any[]) => mockFindMany(...args),
        count: (...args: any[]) => mockCount(...args),
      },
    });
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);
  });

  it("returns nothing when there is no session", async () => {
    mockGetServerAuthSession.mockResolvedValue(null);

    expect(await searchIssues("", 0, 10)).toEqual({ results: [], total: 0 });
    expect(mockGetEnhancedDb).not.toHaveBeenCalled();
  });

  it("pages results and reports the total", async () => {
    const issues = [
      { id: 1, name: "Login fails", title: "Login fails", externalKey: "AB-1" },
    ];
    mockFindMany.mockResolvedValue(issues);
    mockCount.mockResolvedValue(42);

    const result = await searchIssues("", 2, 10);

    expect(result).toEqual({ results: issues, total: 42 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 })
    );
  });

  it("matches the query against name, title, and external key", async () => {
    await searchIssues("  login  ", 0, 10);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: "login", mode: "insensitive" } },
            { title: { contains: "login", mode: "insensitive" } },
            { externalKey: { contains: "login", mode: "insensitive" } },
          ],
        }),
      })
    );
  });

  it("omits the OR clause when the query is blank", async () => {
    await searchIssues("   ", 0, 10);

    const where = mockFindMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("OR");
    expect(where).toEqual({ isDeleted: false });
  });

  it("scopes to a project when one is given", async () => {
    await searchIssues("", 0, 10, 7);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 7 }),
      })
    );
  });

  it("returns empty results when the query throws", async () => {
    mockFindMany.mockRejectedValue(new Error("boom"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(await searchIssues("", 0, 10)).toEqual({ results: [], total: 0 });

    consoleError.mockRestore();
  });
});
