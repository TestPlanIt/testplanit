import { describe, expect, it } from "vitest";
import {
  countFlips,
  formatVerdicts,
  groupByFingerprint,
  isFlakyCandidate,
  signatureTitle,
  type UntriagedFailureRow,
} from "./signatures";

const row = (over: Partial<UntriagedFailureRow>): UntriagedFailureRow => ({
  id: 1,
  message: null,
  content: null,
  systemErr: null,
  repositoryCaseId: 10,
  executedAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  repositoryCase: { name: "Login works" },
  ...over,
});

describe("groupByFingerprint", () => {
  it("groups rows with the same fingerprint and tracks first/last seen", () => {
    const rows = [
      row({
        id: 1,
        message: "Error: boom 1",
        executedAt: new Date("2026-10-02T00:00:00Z"),
      }),
      row({
        id: 2,
        message: "Error: boom 2",
        executedAt: new Date("2026-10-05T00:00:00Z"),
      }),
      row({
        id: 3,
        message: "TimeoutError: slow",
        executedAt: new Date("2026-10-03T00:00:00Z"),
      }),
    ];
    const groups = [...groupByFingerprint(rows).values()];
    expect(groups).toHaveLength(2);
    const boom = groups.find((g) => g.fingerprint.exceptionType === "Error")!;
    expect(boom.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(boom.firstSeenAt.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(boom.lastSeenAt.toISOString()).toBe("2026-10-05T00:00:00.000Z");
  });

  it("falls back to createdAt when executedAt is missing", () => {
    const groups = [
      ...groupByFingerprint([row({ message: "Error: x" })]).values(),
    ];
    expect(groups[0].firstSeenAt.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z"
    );
  });

  it("keeps detail-less failures of different cases apart", () => {
    const groups = groupByFingerprint([
      row({ id: 1, repositoryCaseId: 10 }),
      row({ id: 2, repositoryCaseId: 11 }),
    ]);
    expect(groups.size).toBe(2);
  });
});

describe("signatureTitle", () => {
  it("uses the fingerprint title when there is one", () => {
    const [group] = [
      ...groupByFingerprint([row({ message: "Error: boom" })]).values(),
    ];
    expect(signatureTitle(group.fingerprint, group.rows)).toBe("Error: boom");
  });

  it("names a detail-less signature after its case", () => {
    const [group] = [...groupByFingerprint([row({})]).values()];
    expect(signatureTitle(group.fingerprint, group.rows)).toBe("Login works");
  });
});

describe("flaky heuristic", () => {
  it("counts pass/fail transitions", () => {
    expect(countFlips([])).toBe(0);
    expect(countFlips([false, false, false])).toBe(0);
    expect(countFlips([false, true, false, true])).toBe(3);
  });

  it("needs at least half the sampled cases to flip twice", () => {
    const flaky = [false, true, false, true, true];
    const steady = [false, false, false, false];
    expect(isFlakyCandidate([flaky])).toBe(true);
    expect(isFlakyCandidate([steady])).toBe(false);
    expect(isFlakyCandidate([flaky, steady])).toBe(true);
    expect(isFlakyCandidate([flaky, steady, steady])).toBe(false);
  });

  it("ignores cases with fewer than three verdicts", () => {
    expect(isFlakyCandidate([[false, true]])).toBe(false);
    expect(isFlakyCandidate([])).toBe(false);
  });

  it("renders verdicts newest first", () => {
    expect(formatVerdicts([false, true, true])).toBe("F P P");
  });
});
