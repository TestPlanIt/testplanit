import { describe, expect, it } from "vitest";

import {
  DEFAULT_REQUIREMENT_TYPE_CONFIG,
  MAX_REQUIREMENT_TYPE_IDS,
  diffRequirementTypeIds,
  effectiveRequirementTypeIds,
  matchesRequirementDesignation,
  mergeRequirementTypeConfig,
  readRequirementTypeConfig,
  resolveEffectiveRequirementFlag,
  sanitizeRequirementTypeIds,
} from "./requirementTypeConfig";

// readRequirementTypeConfig is the contract every other plan in this phase
// reads config.requirements through. It runs on the sync hot path for every
// synced issue, so malformed stored JSON must degrade to the safe default
// instead of throwing.

describe("readRequirementTypeConfig", () => {
  it.each([undefined, null, 42, "x", {}])(
    "returns the default shape and never throws for %p",
    (input) => {
      expect(readRequirementTypeConfig(input)).toEqual(
        DEFAULT_REQUIREMENT_TYPE_CONFIG
      );
    }
  );

  it("de-dupes, drops empty/non-string entries, and preserves order", () => {
    expect(
      readRequirementTypeConfig({
        requirements: {
          enabled: true,
          issueTypeIds: ["10001", "10001", "", 7, null],
        },
      })
    ).toEqual({ enabled: true, issueTypeIds: ["10001"] });
  });

  it("only a literal boolean true enables — a truthy string does not", () => {
    expect(
      readRequirementTypeConfig({
        requirements: { enabled: "yes", issueTypeIds: ["10001"] },
      })
    ).toEqual({ enabled: false, issueTypeIds: ["10001"] });
  });
});

describe("effectiveRequirementTypeIds", () => {
  it("returns [] when disabled", () => {
    expect(
      effectiveRequirementTypeIds({ enabled: false, issueTypeIds: ["10001"] })
    ).toEqual([]);
  });

  it("returns issueTypeIds when enabled", () => {
    expect(
      effectiveRequirementTypeIds({ enabled: true, issueTypeIds: ["10001"] })
    ).toEqual(["10001"]);
  });
});

describe("mergeRequirementTypeConfig", () => {
  it("preserves the sibling milestoneSync namespace deep-equal, plus other keys, while replacing requirements", () => {
    const rawConfig = {
      milestoneSync: { enabled: true, kinds: ["RELEASE"] },
      externalProjectKey: "DEMO",
    };
    const next = { enabled: true, issueTypeIds: ["10001"] };

    const result = mergeRequirementTypeConfig(rawConfig, next);

    expect(result.milestoneSync).toEqual(rawConfig.milestoneSync);
    expect(result.externalProjectKey).toBe("DEMO");
    expect(result.requirements).toEqual(next);
  });

  it("returns { requirements: next } when rawConfig is null", () => {
    const next = { enabled: false, issueTypeIds: [] };
    expect(mergeRequirementTypeConfig(null, next)).toEqual({
      requirements: next,
    });
  });

  it("never mutates the input rawConfig", () => {
    const rawConfig = { milestoneSync: { enabled: true } };
    const snapshot = JSON.parse(JSON.stringify(rawConfig));
    mergeRequirementTypeConfig(rawConfig, {
      enabled: true,
      issueTypeIds: ["1"],
    });
    expect(rawConfig).toEqual(snapshot);
  });
});

describe("diffRequirementTypeIds", () => {
  it("returns added and removed sets", () => {
    expect(diffRequirementTypeIds(["a", "b"], ["b", "c"])).toEqual({
      added: ["c"],
      removed: ["a"],
    });
  });

  it("returns two empty arrays for equal sets", () => {
    expect(diffRequirementTypeIds(["a", "b"], ["a", "b"])).toEqual({
      added: [],
      removed: [],
    });
  });
});

describe("sanitizeRequirementTypeIds", () => {
  it("returns the de-duplicated array for a valid input", () => {
    expect(sanitizeRequirementTypeIds(["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns null for a non-array", () => {
    expect(sanitizeRequirementTypeIds("a")).toBeNull();
  });

  it("returns null when any entry is not a string", () => {
    expect(sanitizeRequirementTypeIds([1, 2])).toBeNull();
  });

  it("returns null when the list exceeds MAX_REQUIREMENT_TYPE_IDS", () => {
    const tooMany = Array.from(
      { length: MAX_REQUIREMENT_TYPE_IDS + 1 },
      (_, i) => `id-${i}`
    );
    expect(sanitizeRequirementTypeIds(tooMany)).toBeNull();
  });
});

// The single type-vs-label precedence contract: a typed issue matches on
// its type id alone; only a TYPELESS issue (GitHub — labels are the
// designation vocabulary its getIssueTypes serves) matches on labels.
// The sync writer, the import filter and the recompute SQL all express
// this rule; these cases pin the pure definition they share.
describe("matchesRequirementDesignation", () => {
  it("matches a typed issue on its type id", () => {
    expect(
      matchesRequirementDesignation(["10001"], { issueTypeId: "10001" })
    ).toBe(true);
    expect(
      matchesRequirementDesignation(["10001"], { issueTypeId: "10002" })
    ).toBe(false);
  });

  it("matches a typeless issue on any configured label", () => {
    expect(
      matchesRequirementDesignation(["epic", "requirement"], {
        labels: ["bug", "epic"],
      })
    ).toBe(true);
    expect(matchesRequirementDesignation(["epic"], { labels: ["bug"] })).toBe(
      false
    );
    expect(matchesRequirementDesignation(["epic"], { labels: [] })).toBe(false);
    expect(matchesRequirementDesignation(["epic"], {})).toBe(false);
  });

  it("never lets a label match override a real type", () => {
    // The issue's label collides with a configured entry, but the issue
    // HAS a type — the type governs, and it isn't configured.
    expect(
      matchesRequirementDesignation(["10001"], {
        issueTypeId: "10002",
        labels: ["10001"],
      })
    ).toBe(false);
  });

  it("treats an empty or missing type id as typeless", () => {
    expect(
      matchesRequirementDesignation(["epic"], {
        issueTypeId: "",
        labels: ["epic"],
      })
    ).toBe(true);
    expect(
      matchesRequirementDesignation(["epic"], {
        issueTypeId: null,
        labels: ["epic"],
      })
    ).toBe(true);
  });

  it("matches nothing against an empty designation list", () => {
    expect(matchesRequirementDesignation([], { issueTypeId: "10001" })).toBe(
      false
    );
    expect(matchesRequirementDesignation([], { labels: ["epic"] })).toBe(false);
  });
});

describe("resolveEffectiveRequirementFlag", () => {
  it("pins the flag in both directions regardless of the config match", () => {
    expect(resolveEffectiveRequirementFlag("FORCE_ON", false)).toBe(true);
    expect(resolveEffectiveRequirementFlag("FORCE_ON", true)).toBe(true);
    expect(resolveEffectiveRequirementFlag("FORCE_OFF", true)).toBe(false);
    expect(resolveEffectiveRequirementFlag("FORCE_OFF", false)).toBe(false);
  });

  it("inherits the config match when no override is set", () => {
    // null and undefined are BOTH the inherit arm — the column is
    // nullable, and a narrow select that omits it must not read as a pin.
    expect(resolveEffectiveRequirementFlag(null, true)).toBe(true);
    expect(resolveEffectiveRequirementFlag(null, false)).toBe(false);
    expect(resolveEffectiveRequirementFlag(undefined, true)).toBe(true);
    expect(resolveEffectiveRequirementFlag(undefined, false)).toBe(false);
  });
});
