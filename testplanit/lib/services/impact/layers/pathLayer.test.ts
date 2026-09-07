import { beforeEach, describe, expect, it, vi } from "vitest";

import { runPathLayer, type PathLayerInput } from "./pathLayer";

const cfg = {
  minSearchScore: 0.1,
  maxSearchResults: 50,
  bm25Saturation: 12,
};

const input: PathLayerInput = {
  projectId: 374,
  indexName: "testplanit-repository-cases",
  terms: {
    symbolTerms: ["requestDemo"],
    pathTerms: ["request", "demo"],
    exactSegments: [],
  },
  cfg,
};

function makeDb(
  cases: Array<{ id: number; name: string }> = [{ id: 5, name: "Request demo" }]
) {
  return {
    repositoryCases: { findMany: vi.fn().mockResolvedValue(cases) },
    repositoryCaseTag: { findMany: vi.fn().mockResolvedValue([]) },
    repositoryFolders: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

/** `hits` are ES search hits; `indexed` is what a bare project count returns. */
function makeEs(hits: Array<{ _id: string; _score: number }>, indexed = 1) {
  return {
    search: vi.fn().mockResolvedValue({ hits: { hits } }),
    count: vi.fn().mockResolvedValue({ count: indexed }),
  };
}

describe("runPathLayer", () => {
  let db: ReturnType<typeof makeDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = makeDb();
  });

  it("uses Elasticsearch when it returns hits", async () => {
    const es = makeEs([{ _id: "12", _score: 9 }]);

    const out = await runPathLayer(db as any, es, input);

    expect(out.searchMode).toBe("es");
    expect(out.indexEmpty).toBeUndefined();
    expect([...out.layer.keys()]).toEqual([12]);
    expect(db.repositoryCases.findMany).not.toHaveBeenCalled();
    expect(es.count).not.toHaveBeenCalled();
  });

  it("asks the database when the index answers with nothing", async () => {
    // The project is indexed, so this is a real no-match. The database still
    // gets a turn, because a stale index misses cases the name search finds.
    const es = makeEs([], 900);

    const out = await runPathLayer(db as any, es, input);

    expect(out.searchMode).toBe("db");
    expect(out.indexEmpty).toBeUndefined();
    expect(out.searchFailed).toBeUndefined();
    expect([...out.layer.keys()]).toEqual([5]);
    expect(db.repositoryCases.findMany).toHaveBeenCalled();
  });

  it("reports an index holding nothing for this project", async () => {
    const es = makeEs([], 0);

    const out = await runPathLayer(db as any, es, input);

    expect(out.indexEmpty).toBe(true);
    expect(out.searchMode).toBe("db");
    expect([...out.layer.keys()]).toEqual([5]);
    expect(es.count).toHaveBeenCalledTimes(1);
  });

  it("falls back without blaming the index when the search throws", async () => {
    const es = {
      search: vi.fn().mockRejectedValue(new Error("connection refused")),
      count: vi.fn(),
    };
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const out = await runPathLayer(db as any, es, input);

    expect(out.searchMode).toBe("db");
    expect(out.searchFailed).toBe(true);
    expect(out.indexEmpty).toBeUndefined();
    expect(es.count).not.toHaveBeenCalled();
  });

  it("uses the database when there is no search client at all", async () => {
    const out = await runPathLayer(db as any, null, input);

    expect(out.searchMode).toBe("db");
    expect(out.searchFailed).toBe(true);
    expect(out.indexEmpty).toBeUndefined();
    expect(db.repositoryCases.findMany).toHaveBeenCalled();
  });

  it("treats a client without a count method as indexed", async () => {
    const es = { search: vi.fn().mockResolvedValue({ hits: { hits: [] } }) };

    const out = await runPathLayer(db as any, es, input);

    expect(out.indexEmpty).toBeUndefined();
    expect(out.searchMode).toBe("db");
  });

  it("keeps tag and folder matches whichever search ran", async () => {
    db.repositoryCaseTag.findMany.mockResolvedValue([
      { caseId: 77, tag: { name: "demo" } },
    ]);
    const es = makeEs([{ _id: "12", _score: 9 }]);

    const out = await runPathLayer(db as any, es, {
      ...input,
      terms: { ...input.terms, exactSegments: ["demo"] },
    });

    expect([...out.layer.keys()].sort()).toEqual([12, 77]);
    expect(out.layer.get(77)?.reasons[0]).toMatchObject({
      kind: "PATH",
      matchedField: "db.tag",
    });
  });
});
