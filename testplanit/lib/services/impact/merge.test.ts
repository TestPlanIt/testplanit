import { describe, expect, it } from "vitest";
import { readImpactConfig, type ImpactConfig } from "./config";
import { mergeLayers, type CaseLink } from "./merge";
import type {
  AiReason,
  HistoryReason,
  IssueReason,
  LayerCandidate,
  LayerResult,
  PathReason,
  PinReason,
  SelectionReason,
} from "./types";

const cfg = readImpactConfig({});

function layer(...candidates: LayerCandidate[]): LayerResult {
  return new Map(candidates.map((c) => [c.caseId, c]));
}

function cand(
  caseId: number,
  score: number,
  ...reasons: SelectionReason[]
): LayerCandidate {
  return { caseId, score, reasons };
}

function pin(
  filePath: string,
  pinKind: PinReason["pinKind"] = "FILE"
): PinReason {
  return {
    kind: "PIN",
    pinId: 1,
    filePath,
    pinKind,
    source: "MANUAL",
    confidence: "file",
  };
}

function path(term: string, filePath?: string): PathReason {
  return { kind: "PATH", term, matchedField: "db.name", filePath };
}

function history(overlappingPaths: string[]): HistoryReason {
  return {
    kind: "HISTORY",
    analysisId: 1,
    testRunId: 1,
    overlap: "file",
    failed: false,
    addedManually: false,
    overlappingPaths,
  };
}

function ai(score: number, files?: string[]): AiReason {
  return { kind: "AI", rationale: "r", score, files, batchIndex: 0 };
}

function issue(key: string, files?: string[]): IssueReason {
  return {
    kind: "ISSUE",
    issueId: 1,
    issueKey: key,
    commits: [{ sha: "a".repeat(40), shortSha: "aaaaaaa" }],
    ...(files ? { files } : {}),
  };
}

function merge(
  layers: Partial<{
    pin: LayerResult;
    issue: LayerResult;
    path: LayerResult;
    history: LayerResult;
    ai: LayerResult;
  }>,
  opts: {
    links?: Map<number, CaseLink[]>;
    changedPaths?: string[];
    cfg?: ImpactConfig;
  } = {}
) {
  return mergeLayers({
    pin: layers.pin ?? new Map(),
    issue: layers.issue ?? new Map(),
    path: layers.path ?? new Map(),
    history: layers.history ?? new Map(),
    ai: layers.ai ?? new Map(),
    links: opts.links ?? new Map(),
    changedPaths: opts.changedPaths ?? [],
    cfg: opts.cfg ?? cfg,
  });
}

describe("mergeLayers", () => {
  it("puts an ISSUE-selected case in the affected tier covering its commits' files", () => {
    const { cases, uncoveredFiles } = merge(
      { issue: layer(cand(5, 90, issue("PROJ-1", ["src/a.ts"]))) },
      { changedPaths: ["src/a.ts", "src/b.ts"] }
    );
    expect(cases).toEqual([
      expect.objectContaining({
        caseId: 5,
        score: 90,
        tier: "affected",
        layers: ["ISSUE"],
        coveredFiles: ["src/a.ts"],
      }),
    ]);
    expect(uncoveredFiles).toEqual(["src/b.ts"]);
  });

  it("keeps an ISSUE reason without files from covering anything, and lets a pin outrank it", () => {
    const { cases } = merge(
      {
        pin: layer(cand(5, 100, pin("src/a.ts"))),
        issue: layer(cand(5, 90, issue("PROJ-1"))),
      },
      { changedPaths: ["src/a.ts"] }
    );
    expect(cases[0]).toMatchObject({
      caseId: 5,
      score: 100,
      tier: "pinned",
      layers: ["PIN", "ISSUE"],
      coveredFiles: ["src/a.ts"],
    });
  });

  it("max-merges a pinned case that AI also selected, keeping both reasons", () => {
    const { cases } = merge({
      pin: layer(cand(1, 100, pin("src/a.ts"))),
      ai: layer(cand(1, 100, ai(100, ["src/a.ts"]))),
    });
    expect(cases).toHaveLength(1);
    expect(cases[0].score).toBe(100);
    expect(cases[0].tier).toBe("pinned");
    expect(cases[0].layers).toEqual(["PIN", "AI"]);
    expect(cases[0].reasons.map((r) => r.kind)).toEqual(["PIN", "AI"]);
  });

  it("takes the max score across layers and keeps layers unique", () => {
    const { cases } = merge({
      path: layer(cand(7, 35, path("login"), path("auth"))),
      history: layer(cand(7, 60, history(["src/login.ts"]))),
      ai: layer(cand(7, 55, ai(55))),
    });
    expect(cases[0].score).toBe(60);
    expect(cases[0].layers).toEqual(["PATH", "HISTORY", "AI"]);
    expect(cases[0].reasons).toHaveLength(4);
  });

  it("assigns tiers from pins and the affected threshold", () => {
    const { cases } = merge({
      pin: layer(cand(1, 100, pin("a"))),
      ai: layer(cand(2, 50, ai(50)), cand(3, 49, ai(49))),
    });
    const byId = new Map(cases.map((c) => [c.caseId, c]));
    expect(byId.get(1)?.tier).toBe("pinned");
    expect(byId.get(2)?.tier).toBe("affected");
    expect(byId.get(3)?.tier).toBe("related");
  });

  it("drops cases below minScore unless they carry a pin", () => {
    const { cases } = merge({
      pin: layer(cand(1, 5, pin("a"))),
      path: layer(cand(2, 19, path("x")), cand(3, 20, path("y"))),
    });
    expect(cases.map((c) => c.caseId)).toEqual([3, 1]);
    expect(cases.find((c) => c.caseId === 1)?.tier).toBe("pinned");
  });

  it("expands links only from parents scoring at least 60", () => {
    const links = new Map<number, CaseLink[]>([
      [1, [{ otherId: 10, type: "related" }]],
      [2, [{ otherId: 20, type: "related" }]],
    ]);
    const { cases } = merge(
      {
        ai: layer(cand(1, 60, ai(60)), cand(2, 59, ai(59))),
      },
      { links }
    );
    const ids = cases.map((c) => c.caseId);
    expect(ids).toContain(10);
    expect(ids).not.toContain(20);
    const linked = cases.find((c) => c.caseId === 10)!;
    expect(linked.score).toBe(30);
    expect(linked.tier).toBe("related");
    expect(linked.layers).toEqual(["LINKED"]);
    expect(linked.reasons).toEqual([
      { kind: "LINKED", viaCaseId: 1, linkType: "related" },
    ]);
  });

  it("never lowers or relabels a case that already has evidence", () => {
    const links = new Map<number, CaseLink[]>([
      [1, [{ otherId: 2, type: "blocks" }]],
    ]);
    const { cases } = merge(
      {
        ai: layer(cand(1, 90, ai(90)), cand(2, 25, ai(25))),
      },
      { links }
    );
    const two = cases.find((c) => c.caseId === 2)!;
    expect(two.score).toBe(25);
    expect(two.layers).toEqual(["AI"]);
  });

  it("keeps the best linked score when several parents link the same case", () => {
    const links = new Map<number, CaseLink[]>([
      [1, [{ otherId: 9, type: "related" }]],
      [2, [{ otherId: 9, type: "related" }]],
    ]);
    const { cases } = merge(
      { ai: layer(cand(1, 60, ai(60)), cand(2, 90, ai(90))) },
      { links }
    );
    const nine = cases.find((c) => c.caseId === 9)!;
    expect(nine.score).toBe(40);
    expect(nine.reasons).toHaveLength(2);
  });

  it("does not chain link expansion through linked cases", () => {
    const links = new Map<number, CaseLink[]>([
      [1, [{ otherId: 2, type: "related" }]],
      [2, [{ otherId: 3, type: "related" }]],
    ]);
    const { cases } = merge({ ai: layer(cand(1, 100, ai(95))) }, { links });
    expect(cases.map((c) => c.caseId)).toEqual([1, 2]);
  });

  it("skips link expansion when disabled", () => {
    const links = new Map<number, CaseLink[]>([
      [1, [{ otherId: 10, type: "related" }]],
    ]);
    const { cases } = merge(
      { ai: layer(cand(1, 95, ai(95))) },
      { links, cfg: { ...cfg, linkedExpansion: false } }
    );
    expect(cases.map((c) => c.caseId)).toEqual([1]);
  });

  it("sorts by score, then pin specificity, then layer count, then caseId", () => {
    const { cases } = merge({
      pin: layer(
        cand(5, 100, pin("a", "GLOB")),
        cand(4, 100, pin("a", "RANGE")),
        cand(3, 100, pin("a", "FILE"))
      ),
      path: layer(cand(9, 40, path("x")), cand(8, 40, path("x"))),
      ai: layer(cand(9, 40, ai(40)), cand(7, 40, ai(40)), cand(6, 90, ai(90))),
    });
    expect(cases.map((c) => c.caseId)).toEqual([4, 3, 5, 6, 9, 7, 8]);
  });

  it("collects covered files from every reason kind and reports the rest", () => {
    const { cases, uncoveredFiles } = merge(
      {
        pin: layer(cand(1, 100, pin("src/a.ts"))),
        path: layer(cand(2, 40, path("b", "src/b.ts"))),
        history: layer(cand(3, 40, history(["src/c.ts", "src/a.ts"]))),
        ai: layer(cand(4, 60, ai(60, ["src/d.ts"]))),
      },
      {
        changedPaths: [
          "src/e.ts",
          "src/a.ts",
          "src/b.ts",
          "src/c.ts",
          "src/d.ts",
          "src/f.ts",
        ],
      }
    );
    expect(cases.find((c) => c.caseId === 3)?.coveredFiles).toEqual([
      "src/a.ts",
      "src/c.ts",
    ]);
    expect(uncoveredFiles).toEqual(["src/e.ts", "src/f.ts"]);
  });

  it("ignores coverage from cases filtered out by minScore", () => {
    const { uncoveredFiles } = merge(
      { ai: layer(cand(1, 10, ai(10, ["src/a.ts"]))) },
      { changedPaths: ["src/a.ts"] }
    );
    expect(uncoveredFiles).toEqual(["src/a.ts"]);
  });

  it("returns nothing for empty layers", () => {
    const { cases, uncoveredFiles } = merge({}, { changedPaths: ["x"] });
    expect(cases).toEqual([]);
    expect(uncoveredFiles).toEqual(["x"]);
  });
});
