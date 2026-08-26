import { describe, expect, it } from "vitest";
import {
  formatIssueDisplayText,
  formatRequirementCellText,
  hasDistinctIssueTitle,
} from "./issueDisplayText";

describe("formatIssueDisplayText", () => {
  it("renders 'KEY: Title' for a synced issue with a differing title", () => {
    expect(
      formatIssueDisplayText({
        name: "ADM-3176",
        title: "Designer-Driven Deployment Pipeline",
        externalUrl: "https://tracker.example.com/ADM-3176",
      })
    ).toBe("ADM-3176: Designer-Driven Deployment Pipeline");
  });

  it("renders just the name when there is no externalUrl", () => {
    expect(
      formatIssueDisplayText({
        name: "New Requirement",
        title: "New Requirement",
        externalUrl: null,
      })
    ).toBe("New Requirement");
  });

  it("renders just the name when title equals name", () => {
    expect(
      formatIssueDisplayText({
        name: "ADM-1",
        title: "ADM-1",
        externalUrl: "https://tracker.example.com/ADM-1",
      })
    ).toBe("ADM-1");
  });
});

describe("hasDistinctIssueTitle", () => {
  it("is true for a distinct title with an externalUrl", () => {
    expect(
      hasDistinctIssueTitle({
        name: "ADM-3176",
        title: "Designer-Driven Deployment Pipeline",
        externalUrl: "https://tracker.example.com/ADM-3176",
      })
    ).toBe(true);
  });

  it("is false when title equals name", () => {
    expect(
      hasDistinctIssueTitle({
        name: "ADM-1",
        title: "ADM-1",
        externalUrl: "https://tracker.example.com/ADM-1",
      })
    ).toBe(false);
  });

  it("is false when there is no title", () => {
    expect(
      hasDistinctIssueTitle({
        name: "ADM-1",
        title: null,
        externalUrl: "https://tracker.example.com/ADM-1",
      })
    ).toBe(false);
  });

  it("is false when the title is distinct but there is no externalUrl", () => {
    expect(
      hasDistinctIssueTitle({
        name: "New Requirement",
        title: "Something else entirely",
        externalUrl: null,
      })
    ).toBe(false);
  });
});

describe("formatRequirementCellText", () => {
  // The exact shape a NATIVE requirement produces: CreateRequirementDialog
  // and RequirementsListView's rename handler both write the identical
  // trimmed string to name (requirementKey) and title (requirementTitle).
  it("renders the name ONCE for a native requirement (title === key)", () => {
    expect(
      formatRequirementCellText({
        requirementKey: "New Requirement",
        requirementTitle: "New Requirement",
      })
    ).toBe("New Requirement");
  });

  it("renders 'KEY: Title' for a synced requirement whose title differs from its key", () => {
    expect(
      formatRequirementCellText({
        requirementKey: "REQ-1",
        requirementTitle: "Enrol domestic students",
      })
    ).toBe("REQ-1: Enrol domestic students");
  });

  it("renders just the key when there is no title", () => {
    expect(
      formatRequirementCellText({
        requirementKey: "REQ-2",
        requirementTitle: null,
      })
    ).toBe("REQ-2");
  });

  it("falls back to an empty string when the key is missing", () => {
    expect(formatRequirementCellText({ requirementTitle: null })).toBe("");
  });
});
