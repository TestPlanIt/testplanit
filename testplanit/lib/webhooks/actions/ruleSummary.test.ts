import { describe, expect, it, vi } from "vitest";
import { describeCreateRunRule } from "./ruleSummary";

const db = {
  executionTarget: {
    findUnique: vi.fn().mockResolvedValue({ name: "Nightly CI" }),
  },
};

describe("describeCreateRunRule", () => {
  it("names the trigger, the action, the score and the target", async () => {
    expect(
      await describeCreateRunRule(db, {
        trigger: "CODE_PULL_REQUEST",
        minScore: 90,
        autoExecute: { targetId: 4 },
      })
    ).toBe(
      "Pull requests → Create Test Run · Minimum score: 90 · Target: Nightly CI"
    );
  });

  it("names the pushed branch, or the default branch when it isn't known", async () => {
    expect(
      await describeCreateRunRule(db, { trigger: "CODE_PUSH", branch: "main" })
    ).toBe("Pushes to main → Create Test Run");
    expect(await describeCreateRunRule(db, { trigger: "CODE_PUSH" })).toBe(
      "Pushes to the default branch → Create Test Run"
    );
  });

  it("falls back to the target id when the target is gone", async () => {
    db.executionTarget.findUnique.mockResolvedValueOnce(null);
    expect(
      await describeCreateRunRule(db, {
        trigger: "CODE_BRANCH_PUSH",
        autoExecute: { targetId: 9 },
      })
    ).toBe("Pushes to other branches → Create Test Run · Target: 9");
  });

  it("says nothing for a job queued before rules carried their trigger", async () => {
    expect(await describeCreateRunRule(db, {})).toBeNull();
  });
});
