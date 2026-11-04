import type { DbClient } from "~/lib/zenstack";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getElasticsearchClient: vi.fn(),
  search: vi.fn(),
}));

vi.mock("~/services/elasticsearchService", () => ({
  getElasticsearchClient: mocks.getElasticsearchClient,
  getRepositoryCaseIndexName: (tenantId?: string) =>
    tenantId
      ? `testplanit-${tenantId}-repository-cases`
      : "testplanit-repository-cases",
}));

import {
  findRecentTemplateCaseIds,
  findRelatedCaseIds,
  makeRelatedCaseFinder,
} from "./related-cases";

describe("findRelatedCaseIds", () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.getElasticsearchClient.mockReturnValue({ search: mocks.search });
  });

  it("returns null when Elasticsearch is not configured", async () => {
    mocks.getElasticsearchClient.mockReturnValue(null);
    const ids = await findRelatedCaseIds({ projectId: 7, title: "Login" });
    expect(ids).toBeNull();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("returns null when there is no text to match on", async () => {
    const ids = await findRelatedCaseIds({ projectId: 7, title: "   " });
    expect(ids).toBeNull();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("ranks the project's live cases by similarity to the issue text", async () => {
    mocks.search.mockResolvedValue({
      hits: { hits: [{ _id: "12" }, { _id: "3" }, { _id: "not-a-number" }] },
    });

    const ids = await findRelatedCaseIds({
      projectId: 7,
      title: "Reset password",
      description: "Users can reset via email link",
      notes: "focus on expiry",
      templateId: 2,
      excludeCaseIds: new Set([5, 6]),
      tenantId: "acme",
      limit: 9,
    });

    expect(ids).toEqual([12, 3]);
    expect(mocks.search).toHaveBeenCalledTimes(1);
    const req = mocks.search.mock.calls[0][0];
    expect(req.index).toBe("testplanit-acme-repository-cases");
    expect(req.size).toBe(9);
    expect(req._source).toBe(false);
    const bool = req.query.bool;
    expect(bool.must[0].more_like_this).toMatchObject({
      fields: ["name", "searchableContent"],
      like: [
        "Reset password",
        "Users can reset via email link",
        "focus on expiry",
      ],
    });
    expect(bool.filter).toEqual([
      { term: { projectId: 7 } },
      { term: { isDeleted: false } },
      { term: { isArchived: false } },
    ]);
    expect(bool.should).toEqual([
      { term: { templateId: { value: 2, boost: 2 } } },
    ]);
    expect(bool.must_not).toEqual([{ ids: { values: ["5", "6"] } }]);
  });

  it("uses the single-tenant index and no template boost when neither is given", async () => {
    mocks.search.mockResolvedValue({ hits: { hits: [] } });
    const ids = await findRelatedCaseIds({ projectId: 7, title: "Login" });
    expect(ids).toEqual([]);
    const req = mocks.search.mock.calls[0][0];
    expect(req.index).toBe("testplanit-repository-cases");
    expect(req.query.bool.should).toEqual([]);
    expect(req.query.bool.must_not).toEqual([]);
  });

  it("degrades to null when the search throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.search.mockRejectedValue(new Error("index_not_found_exception"));
    const ids = await findRelatedCaseIds({ projectId: 7, title: "Login" });
    expect(ids).toBeNull();
    errorSpy.mockRestore();
  });
});

describe("makeRelatedCaseFinder", () => {
  beforeEach(() => {
    mocks.search.mockReset();
  });

  it("returns the Elasticsearch ranking when the search is available", async () => {
    mocks.getElasticsearchClient.mockReturnValue({ search: mocks.search });
    mocks.search.mockResolvedValue({ hits: { hits: [{ _id: "8" }] } });
    const findMany = vi.fn(async () => [{ id: 1 }]);
    const db = { repositoryCases: { findMany } } as unknown as DbClient;

    const ids = await makeRelatedCaseFinder(db)({
      projectId: 7,
      title: "Login",
    });

    expect(ids).toEqual([8]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("falls back to the newest same-template cases without Elasticsearch", async () => {
    mocks.getElasticsearchClient.mockReturnValue(null);
    const findMany = vi.fn(async () => [{ id: 1 }, { id: 2 }]);
    const db = { repositoryCases: { findMany } } as unknown as DbClient;

    const ids = await makeRelatedCaseFinder(db)({
      projectId: 7,
      title: "Login",
      templateId: 3,
    });

    expect(ids).toEqual([1, 2]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 7, templateId: 3 }),
      })
    );
  });
});

describe("findRecentTemplateCaseIds", () => {
  it("samples the newest live cases on the template, skipping cases already shown", async () => {
    const findMany = vi.fn(async () => [{ id: 9 }, { id: 4 }]);
    const db = { repositoryCases: { findMany } } as unknown as DbClient;

    const ids = await findRecentTemplateCaseIds(db, {
      projectId: 7,
      templateId: 2,
      excludeCaseIds: new Set([4, 8]),
      limit: 5,
    });

    expect(ids).toEqual([9, 4]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        projectId: 7,
        isDeleted: false,
        isArchived: false,
        templateId: 2,
        id: { notIn: [4, 8] },
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  });

  it("samples across templates when none is known", async () => {
    const findMany = vi.fn(async () => []);
    const db = { repositoryCases: { findMany } } as unknown as DbClient;

    await findRecentTemplateCaseIds(db, { projectId: 7 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 7, isDeleted: false, isArchived: false },
        take: 10,
      })
    );
  });
});
