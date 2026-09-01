// The report-type picker lists reports alphabetically by their LOCALIZED
// label (operator direction 2026-09-01), whatever order the registry
// arrays declare them in — a new report type slots itself in without
// anyone remembering to keep the array sorted.

import { describe, expect, it } from "vitest";
import { getProjectReportTypes, sortReportTypesByLabel } from "./reportTypes";

describe("sortReportTypesByLabel", () => {
  it("orders by localized label, not by registry position or id", () => {
    const sorted = sortReportTypesByLabel(
      [
        {
          id: "b",
          label: "Zebra",
          description: "",
          icon: (() => null) as any,
          endpoint: "",
        },
        {
          id: "a",
          label: "Ålesund",
          description: "",
          icon: (() => null) as any,
          endpoint: "",
        },
        {
          id: "c",
          label: "apple",
          description: "",
          icon: (() => null) as any,
          endpoint: "",
        },
      ],
      "en-US"
    );
    // localeCompare: case-insensitive-ish ordering with diacritics folded
    // into the base letter — never a raw codepoint sort (which would put
    // "Zebra" before "apple" and "Ålesund" last).
    expect(sorted.map((t) => t.label)).toEqual(["Ålesund", "apple", "Zebra"]);
  });

  it("returns a new array and leaves the registry order untouched", () => {
    const input = [
      {
        id: "b",
        label: "B",
        description: "",
        icon: (() => null) as any,
        endpoint: "",
      },
      {
        id: "a",
        label: "A",
        description: "",
        icon: (() => null) as any,
        endpoint: "",
      },
    ];
    const sorted = sortReportTypesByLabel(input, "en-US");
    expect(sorted).not.toBe(input);
    expect(input.map((t) => t.id)).toEqual(["b", "a"]);
    expect(sorted.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("keeps the full en-US project list label-sorted, with the requirement reports interleaved", () => {
    // Bare-key translator: every label is its own key, so this exercises
    // the REAL registry (all 16 types) without carrying en-US here; the
    // named labels below are the ones whose relative order the ask pinned.
    const t = (key: string) => {
      const labels: Record<string, string> = {
        "reportTypes.requirementCoverageGaps.label":
          "Requirement Coverage Gaps",
        "reportTypes.requirementTraceability.label": "Requirement Traceability",
        "reportTypes.requirementCoverageChanges.label":
          "Requirement Coverage Changes",
        "reportTypes.iterationMatrix.label":
          "Parameterized Test Iteration Matrix",
      };
      return labels[key] ?? key;
    };
    const labels = sortReportTypesByLabel(
      getProjectReportTypes(t),
      "en-US"
    ).map((type) => type.label);
    expect(labels).toEqual(
      [...labels].sort((a, b) => a.localeCompare(b, "en-US"))
    );
    // Changes < Gaps < Traceability, and the iteration matrix does not
    // trail the list just because its id starts with "i".
    const at = (label: string) => labels.indexOf(label);
    expect(at("Requirement Coverage Changes")).toBeGreaterThan(-1);
    expect(at("Requirement Coverage Changes")).toBeLessThan(
      at("Requirement Coverage Gaps")
    );
    expect(at("Requirement Coverage Gaps")).toBeLessThan(
      at("Requirement Traceability")
    );
    expect(at("Parameterized Test Iteration Matrix")).toBeLessThan(
      at("Requirement Coverage Changes")
    );
  });
});
