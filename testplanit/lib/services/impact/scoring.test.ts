import { describe, expect, it } from "vitest";
import {
  clampAiScore,
  historyScoreFor,
  linkedScoreFor,
  normalizeBm25,
  pathScoreFor,
  pinSpecificity,
} from "./scoring";
import type { HistoryReason, PathReason } from "./types";

const DAY = 24 * 60 * 60 * 1000;

function pathReason(
  matchedField: PathReason["matchedField"],
  term: string,
  rawScore?: number
): PathReason {
  return { kind: "PATH", matchedField, term, rawScore };
}

function historyHit(
  analysisId: number,
  overrides: Partial<HistoryReason> = {}
): HistoryReason {
  return {
    kind: "HISTORY",
    analysisId,
    testRunId: analysisId * 10,
    overlap: "dir",
    failed: false,
    addedManually: false,
    overlappingPaths: [],
    ...overrides,
  };
}

describe("normalizeBm25", () => {
  it("maps the top result to 60 once the max exceeds saturation", () => {
    expect(normalizeBm25(40, 40, 20)).toBe(60);
    expect(normalizeBm25(20, 40, 20)).toBe(30);
  });

  it("saturates against the saturation floor when results are weak", () => {
    expect(normalizeBm25(5, 5, 20)).toBe(15);
    expect(normalizeBm25(20, 5, 20)).toBe(60);
  });

  it("never exceeds 60 and floors positives at 10", () => {
    expect(normalizeBm25(500, 40, 20)).toBe(60);
    expect(normalizeBm25(0.1, 100, 20)).toBe(10);
    expect(normalizeBm25(0, 100, 20)).toBe(0);
    expect(normalizeBm25(-3, 100, 20)).toBe(0);
  });
});

describe("pathScoreFor", () => {
  it("is 0 with no reasons", () => {
    expect(pathScoreFor([])).toBe(0);
  });

  it("scores tag, folder and name matches", () => {
    expect(pathScoreFor([pathReason("db.tag", "auth")])).toBe(45);
    expect(pathScoreFor([pathReason("db.folder", "auth")])).toBe(35);
    expect(pathScoreFor([pathReason("db.name", "auth")])).toBe(35);
  });

  it("grows db.name with distinct terms and adds the extra-term bonus", () => {
    const reasons = [
      pathReason("db.name", "login"),
      pathReason("db.name", "password"),
    ];
    expect(pathScoreFor(reasons)).toBe(55);
  });

  it("takes the max across reasons plus 5 per extra distinct term", () => {
    const reasons = [
      pathReason("db.folder", "auth"),
      pathReason("db.tag", "login"),
    ];
    expect(pathScoreFor(reasons)).toBe(50);
  });

  it("does not count repeated or empty terms as extra", () => {
    const reasons = [
      pathReason("db.tag", "auth"),
      pathReason("db.folder", "Auth"),
      pathReason("db.folder", ""),
    ];
    expect(pathScoreFor(reasons)).toBe(45);
  });

  it("caps at 60", () => {
    const reasons = [
      pathReason("db.tag", "a"),
      pathReason("db.tag", "b"),
      pathReason("db.tag", "c"),
      pathReason("db.tag", "d"),
      pathReason("db.tag", "e"),
    ];
    expect(pathScoreFor(reasons)).toBe(60);
  });

  it("normalizes ES raw scores against the result-set max", () => {
    const reasons = [pathReason("es.name", "login", 10)];
    expect(pathScoreFor(reasons, { maxInResult: 40, saturation: 20 })).toBe(15);
    expect(pathScoreFor(reasons, { maxInResult: 10, saturation: 20 })).toBe(30);
  });
});

describe("historyScoreFor", () => {
  const now = new Date("2026-09-03T00:00:00Z");

  it("is 0 with no hits", () => {
    expect(historyScoreFor([], now)).toBe(0);
  });

  it("ranks failed > addedManually > file overlap > dir overlap", () => {
    expect(historyScoreFor([historyHit(1, { failed: true })], now)).toBe(70);
    expect(historyScoreFor([historyHit(1, { addedManually: true })], now)).toBe(
      60
    );
    expect(historyScoreFor([historyHit(1, { overlap: "file" })], now)).toBe(40);
    expect(historyScoreFor([historyHit(1, { overlap: "dir" })], now)).toBe(25);
    expect(
      historyScoreFor(
        [historyHit(1, { failed: true, addedManually: true })],
        now
      )
    ).toBe(70);
  });

  it("decays hits from analyses older than the decay window", () => {
    const dates = new Map([
      [1, new Date(now.getTime() - 200 * DAY)],
      [2, new Date(now.getTime() - 10 * DAY)],
    ]);
    expect(
      historyScoreFor([historyHit(1, { addedManually: true })], now, 180, dates)
    ).toBe(42);
    expect(
      historyScoreFor([historyHit(2, { addedManually: true })], now, 180, dates)
    ).toBe(60);
    expect(
      historyScoreFor([historyHit(1, { addedManually: true })], now, 365, dates)
    ).toBe(60);
  });

  it("does not decay when the analysis date is unknown", () => {
    expect(
      historyScoreFor([historyHit(9, { overlap: "file" })], now, 180, new Map())
    ).toBe(40);
  });

  it("adds 5 per extra analysis and caps at 70", () => {
    const hits = [
      historyHit(1, { overlap: "file" }),
      historyHit(2, { overlap: "file" }),
      historyHit(3, { overlap: "dir" }),
    ];
    expect(historyScoreFor(hits, now)).toBe(50);

    const many = [1, 2, 3, 4, 5, 6, 7, 8].map((id) =>
      historyHit(id, { overlap: "file" })
    );
    expect(historyScoreFor(many, now)).toBe(70);
  });

  it("does not count the same analysis twice", () => {
    const hits = [
      historyHit(1, { overlap: "file" }),
      historyHit(1, { overlap: "dir" }),
    ];
    expect(historyScoreFor(hits, now)).toBe(40);
  });

  it("floors at 25 when any hit exists even after decay", () => {
    const dates = new Map([[1, new Date(now.getTime() - 400 * DAY)]]);
    expect(
      historyScoreFor([historyHit(1, { overlap: "dir" })], now, 180, dates)
    ).toBe(25);
  });
});

describe("clampAiScore", () => {
  it("clamps into 0..95 and rounds", () => {
    expect(clampAiScore(100)).toBe(95);
    expect(clampAiScore(95)).toBe(95);
    expect(clampAiScore(72.6)).toBe(73);
    expect(clampAiScore(-4)).toBe(0);
    expect(clampAiScore(Number.NaN)).toBe(0);
  });
});

describe("linkedScoreFor", () => {
  it("halves the parent score and caps at 40", () => {
    expect(linkedScoreFor(60)).toBe(30);
    expect(linkedScoreFor(75)).toBe(38);
    expect(linkedScoreFor(100)).toBe(40);
    expect(linkedScoreFor(0)).toBe(0);
  });
});

describe("pinSpecificity", () => {
  it("orders RANGE/SYMBOL over FILE over GLOB", () => {
    expect(pinSpecificity("RANGE")).toBe(3);
    expect(pinSpecificity("SYMBOL")).toBe(3);
    expect(pinSpecificity("FILE")).toBe(2);
    expect(pinSpecificity("GLOB")).toBe(1);
  });
});
