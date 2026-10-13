// Mocked-client proof for HYG-02's Elasticsearch indexer fix. Both
// indexIssue (single-row, index-on-write) and syncProjectIssuesToElasticsearch
// (bulk reindex) build near-identical document literals in this directory's
// issueSearch module, and a discarded 2026-04 attempt at this exact fix
// updated one writer without the other — shipping a search index whose
// contents silently depended on which code path last touched a row. The
// fourth test below is the structural defence against that: it compares
// the two writers' own field-set shape rather than trusting a human re-read.
//
// No live cluster is touched: getElasticsearchClient is mocked at the
// module boundary and every assertion runs against call arguments captured
// on the mock spies.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getElasticsearchClient } from "./unifiedElasticsearchService";

// Mock Elasticsearch at the module boundary issueSearch.ts actually imports
// from (unifiedElasticsearchService.ts re-exports getElasticsearchClient
// and owns getEntityIndexName) — never elasticsearchService.ts directly.
vi.mock("./unifiedElasticsearchService", () => ({
  getElasticsearchClient: vi.fn(),
  getEntityIndexName: vi.fn(() => "test-issues"),
}));

import { indexIssue, syncProjectIssuesToElasticsearch } from "./issueSearch";

describe("issueSearch document construction", () => {
  let mockClient: any;

  const baseIssue = (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    name: "ISSUE-1",
    title: "Sample issue",
    description: "A description",
    externalId: "EXT-1",
    note: null,
    data: {},
    integration: { name: "Jira" },
    isDeleted: false,
    isRequirement: false,
    createdAt: new Date("2024-01-01"),
    createdById: "user-1",
    createdBy: { name: "Test User", image: null },
    project: { id: 100, name: "Test Project", iconUrl: null },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = {
      index: vi.fn(),
      bulk: vi.fn(),
    };
    vi.mocked(getElasticsearchClient).mockReturnValue(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("indexIssue writes the requirement role onto the document", async () => {
    mockClient.index.mockResolvedValue({ _id: "1" });

    await indexIssue(baseIssue({ id: 1, isRequirement: true }) as any);
    await indexIssue(baseIssue({ id: 2, isRequirement: false }) as any);

    expect(mockClient.index).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        document: expect.objectContaining({ isRequirement: true }),
      })
    );
    expect(mockClient.index).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        document: expect.objectContaining({ isRequirement: false }),
      })
    );
  });

  it("indexIssue throws when the search client is unavailable", async () => {
    vi.mocked(getElasticsearchClient).mockReturnValue(null);

    await expect(indexIssue(baseIssue() as any)).rejects.toThrow();
    expect(mockClient.index).not.toHaveBeenCalled();
  });

  it("syncProjectIssuesToElasticsearch writes the requirement role on every bulk document", async () => {
    mockClient.bulk.mockResolvedValue({ errors: false, items: [] });

    const db = {
      issue: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            baseIssue({ id: 10, isRequirement: true }),
            baseIssue({ id: 11, isRequirement: false }),
          ]),
      },
    };

    await syncProjectIssuesToElasticsearch(100, db);

    expect(mockClient.bulk).toHaveBeenCalledTimes(1);
    const bulkBody = mockClient.bulk.mock.calls[0][0].body;
    // Even indices are the { index: { _index, _id } } action headers; odd
    // indices are the document bodies themselves.
    const documents = bulkBody.filter((_: unknown, i: number) => i % 2 === 1);

    expect(documents).toHaveLength(2);
    expect(documents[0]).toEqual(
      expect.objectContaining({ id: 10, isRequirement: true })
    );
    expect(documents[1]).toEqual(
      expect.objectContaining({ id: 11, isRequirement: false })
    );
  });

  it("both indexer call sites emit the identical document field set", async () => {
    mockClient.index.mockResolvedValue({ _id: "1" });
    mockClient.bulk.mockResolvedValue({ errors: false, items: [] });

    await indexIssue(baseIssue({ id: 1 }) as any);
    const singleDocument = mockClient.index.mock.calls[0][0].document;

    const db = {
      issue: {
        findMany: vi.fn().mockResolvedValue([baseIssue({ id: 1 })]),
      },
    };
    await syncProjectIssuesToElasticsearch(100, db);
    const bulkDocument = mockClient.bulk.mock.calls[0][0].body[1];

    // Compare the FIELD SET, not the values — the two writers legitimately
    // produce different content for the same row (e.g. different query
    // shapes resolve relations differently); it is the key set that must
    // never drift between the two writers.
    expect(Object.keys(singleDocument).sort()).toEqual(
      Object.keys(bulkDocument).sort()
    );
  });
});
