import { describe, expect, it } from "vitest";
import {
  IMPACT_CONFIG_DEFAULTS,
  impactConfig,
  readImpactConfig,
} from "./config";

describe("readImpactConfig", () => {
  it("returns every default for an empty env", () => {
    expect(readImpactConfig({})).toEqual(IMPACT_CONFIG_DEFAULTS);
  });

  it("exposes the documented defaults", () => {
    const cfg = readImpactConfig({});
    expect(cfg.diffTokenBudget).toBe(12000);
    expect(cfg.truncatePatchChars).toBe(4000);
    expect(cfg.maxPatchFiles).toBe(40);
    expect(cfg.maxDiffFiles).toBe(500);
    expect(cfg.truncateCaseName).toBe(80);
    expect(cfg.truncateTextLong).toBe(100);
    expect(cfg.truncateOtherField).toBe(100);
    expect(cfg.aiFullRepoThreshold).toBe(250);
    expect(cfg.maxAiCandidates).toBe(400);
    expect(cfg.aiSampleSize).toBe(150);
    expect(cfg.minSearchScore).toBe(5);
    expect(cfg.maxSearchResults).toBe(500);
    expect(cfg.bm25Saturation).toBe(20);
    expect(cfg.minScore).toBe(20);
    expect(cfg.affectedThreshold).toBe(50);
    expect(cfg.historyLookbackDays).toBe(365);
    expect(cfg.historyMaxAnalyses).toBe(25);
    expect(cfg.maxAnchorFetches).toBe(50);
    expect(cfg.thinkingBudget).toBe(1024);
    expect(cfg.linkedExpansion).toBe(true);
    expect(cfg.reuseHours).toBe(24);
  });

  it("reads overrides from IMPACT_* variables", () => {
    const cfg = readImpactConfig({
      IMPACT_DIFF_TOKEN_BUDGET: "5000",
      IMPACT_MAX_PATCH_FILES: " 12 ",
      IMPACT_MIN_SEARCH_SCORE: "2.5",
      IMPACT_LINKED_EXPANSION: "false",
      IMPACT_REUSE_HOURS: "0",
    });
    expect(cfg.diffTokenBudget).toBe(5000);
    expect(cfg.maxPatchFiles).toBe(12);
    expect(cfg.minSearchScore).toBe(2.5);
    expect(cfg.linkedExpansion).toBe(false);
    expect(cfg.reuseHours).toBe(0);
  });

  it("falls back to defaults for invalid values", () => {
    const cfg = readImpactConfig({
      IMPACT_DIFF_TOKEN_BUDGET: "lots",
      IMPACT_MAX_PATCH_FILES: "-3",
      IMPACT_MAX_DIFF_FILES: "1.5",
      IMPACT_MIN_SEARCH_SCORE: "NaN",
      IMPACT_BM25_SATURATION: "",
      IMPACT_LINKED_EXPANSION: "maybe",
    });
    expect(cfg.diffTokenBudget).toBe(12000);
    expect(cfg.maxPatchFiles).toBe(40);
    expect(cfg.maxDiffFiles).toBe(500);
    expect(cfg.minSearchScore).toBe(5);
    expect(cfg.bm25Saturation).toBe(20);
    expect(cfg.linkedExpansion).toBe(true);
  });

  it("accepts the usual boolean spellings", () => {
    for (const on of ["1", "true", "YES", "on"]) {
      expect(
        readImpactConfig({ IMPACT_LINKED_EXPANSION: on }).linkedExpansion
      ).toBe(true);
    }
    for (const off of ["0", "false", "No", "OFF"]) {
      expect(
        readImpactConfig({ IMPACT_LINKED_EXPANSION: off }).linkedExpansion
      ).toBe(false);
    }
  });

  it("exports a config read from process.env at import time", () => {
    expect(impactConfig).toEqual(readImpactConfig(process.env));
  });

  it("reads the ticket-scan knobs from IMPACT_ISSUE_* variables", () => {
    const cfg = readImpactConfig({
      IMPACT_ISSUE_MAX_COMMIT_FETCHES: "5",
      IMPACT_ISSUE_SCAN_LOOKBACK_DAYS: "30",
      IMPACT_ISSUE_SCAN_MAX_COMMITS: "50",
      IMPACT_ISSUE_SCAN_MAX_COMMIT_FETCHES: "7",
      IMPACT_ISSUE_SCAN_MAX_FILES_PER_COMMIT: "12",
    });
    expect(cfg).toMatchObject({
      issueMaxCommitFetches: 5,
      issueScanLookbackDays: 30,
      issueScanMaxCommits: 50,
      issueScanMaxCommitFetches: 7,
      issueScanMaxFilesPerCommit: 12,
    });
  });
});
