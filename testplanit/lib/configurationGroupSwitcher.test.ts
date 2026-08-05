import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildConfigurationGroupMemberLabels,
  buildConfigurationGroupWhere,
  isConfigurationGroupQueryEnabled,
  parseProjectIdParam,
  reconcileConfigurationSelection,
  resolveSelectionFromUrl,
  type ConfigurationGroupMember,
} from "./configurationGroupSwitcher";

const FORMAT = {
  noConfiguration: "No configuration",
  withMemberName: ({
    configuration,
    name,
  }: {
    configuration: string;
    name: string;
  }) => `${configuration} — ${name}`,
};

function member(
  id: number,
  name: string,
  configuration: { id: number; name: string } | null = null
): ConfigurationGroupMember {
  return { id, name, configuration };
}

describe("buildConfigurationGroupWhere", () => {
  it("scopes the sibling query to the project", () => {
    expect(
      buildConfigurationGroupWhere({
        configurationGroupId: "group-1",
        projectId: 7,
      })
    ).toEqual({
      configurationGroupId: "group-1",
      projectId: 7,
      isDeleted: false,
    });
  });

  it("always carries a projectId key so the filter cannot silently widen", () => {
    const where = buildConfigurationGroupWhere({
      configurationGroupId: "group-1",
      projectId: null,
    });
    expect(Object.keys(where)).toContain("projectId");
    expect(where.projectId).toBeUndefined();
  });
});

describe("isConfigurationGroupQueryEnabled", () => {
  it("requires both a group id and a project id", () => {
    expect(
      isConfigurationGroupQueryEnabled({
        configurationGroupId: "group-1",
        projectId: 7,
      })
    ).toBe(true);
    expect(
      isConfigurationGroupQueryEnabled({
        configurationGroupId: null,
        projectId: 7,
      })
    ).toBe(false);
    expect(
      isConfigurationGroupQueryEnabled({
        configurationGroupId: "group-1",
        projectId: null,
      })
    ).toBe(false);
    expect(
      isConfigurationGroupQueryEnabled({
        configurationGroupId: "group-1",
        projectId: Number.NaN,
      })
    ).toBe(false);
  });
});

describe("parseProjectIdParam", () => {
  it("parses positive integer route segments only", () => {
    expect(parseProjectIdParam("12")).toBe(12);
    expect(parseProjectIdParam(["12", "13"])).toBe(12);
    expect(parseProjectIdParam("abc")).toBeNull();
    expect(parseProjectIdParam("1.5")).toBeNull();
    expect(parseProjectIdParam("0")).toBeNull();
    expect(parseProjectIdParam("")).toBeNull();
    expect(parseProjectIdParam(undefined)).toBeNull();
  });
});

describe("buildConfigurationGroupMemberLabels", () => {
  it("labels members by configuration when configurations are unique", () => {
    const labels = buildConfigurationGroupMemberLabels(
      [
        member(1, "Regression", { id: 10, name: "Chrome" }),
        member(2, "Regression", { id: 11, name: "Firefox" }),
      ],
      FORMAT
    );
    expect(labels.get(1)).toBe("Chrome");
    expect(labels.get(2)).toBe("Firefox");
  });

  it("appends the member name when two members share a configuration", () => {
    const labels = buildConfigurationGroupMemberLabels(
      [
        member(1, "Regression — Ana", { id: 10, name: "Chrome" }),
        member(2, "Regression — Bo", { id: 10, name: "Chrome" }),
        member(3, "Regression", { id: 11, name: "Firefox" }),
      ],
      FORMAT
    );
    expect(labels.get(1)).toBe("Chrome — Regression — Ana");
    expect(labels.get(2)).toBe("Chrome — Regression — Bo");
    // The unambiguous member stays clean.
    expect(labels.get(3)).toBe("Firefox");
  });

  it("treats configuration names that differ only in case or spacing as duplicates", () => {
    const labels = buildConfigurationGroupMemberLabels(
      [
        member(1, "Run A", { id: 10, name: "Chrome" }),
        member(2, "Run B", { id: 11, name: " chrome " }),
      ],
      FORMAT
    );
    expect(labels.get(1)).toBe("Chrome — Run A");
    expect(labels.get(2)).toBe("chrome — Run B");
  });

  it("identifies members that have no configuration", () => {
    const labels = buildConfigurationGroupMemberLabels(
      [
        member(1, "Run A", null),
        member(2, "Run B", { id: 11, name: "Firefox" }),
      ],
      FORMAT
    );
    expect(labels.get(1)).toBe("No configuration — Run A");
    expect(labels.get(2)).toBe("Firefox");
  });

  it("treats a blank configuration name as no configuration", () => {
    const labels = buildConfigurationGroupMemberLabels(
      [member(1, "Run A", { id: 10, name: "   " })],
      FORMAT
    );
    expect(labels.get(1)).toBe("No configuration — Run A");
  });

  it("keeps several configuration-less members apart", () => {
    const labels = buildConfigurationGroupMemberLabels(
      [member(1, "Run A", null), member(2, "Run B", null)],
      FORMAT
    );
    expect(labels.get(1)).toBe("No configuration — Run A");
    expect(labels.get(2)).toBe("No configuration — Run B");
  });

  it("returns an empty map for an empty group", () => {
    expect(buildConfigurationGroupMemberLabels([], FORMAT).size).toBe(0);
  });
});

describe("reconcileConfigurationSelection", () => {
  it("returns the same reference when nothing changed", () => {
    const a = member(1, "Run A");
    const b = member(2, "Run B");
    const selection = [a, b];
    expect(reconcileConfigurationSelection(selection, [a, b])).toBe(selection);
  });

  it("drops a member that left the group while it was selected", () => {
    const a = member(1, "Run A");
    const b = member(2, "Run B");
    const next = reconcileConfigurationSelection([a, b], [a]);
    expect(next).toEqual([a]);
    expect(next).toHaveLength(1);
  });

  it("empties the selection when the group is dissolved", () => {
    const a = member(1, "Run A");
    expect(reconcileConfigurationSelection([a], [])).toEqual([]);
  });

  it("never adds members that joined the group", () => {
    const a = member(1, "Run A");
    const b = member(2, "Run B");
    expect(reconcileConfigurationSelection([a], [a, b])).toEqual([a]);
  });

  it("refreshes survivors with the latest member data", () => {
    const stale = { id: 1, name: "Run A", configuration: null };
    const fresh = { id: 1, name: "Run A renamed", configuration: null };
    const next = reconcileConfigurationSelection([stale], [fresh]);
    expect(next[0]).toBe(fresh);
  });

  it("is stable across repeated application (no update loop)", () => {
    const a = member(1, "Run A");
    const b = member(2, "Run B");
    const first = reconcileConfigurationSelection([a, b], [a]);
    const second = reconcileConfigurationSelection(first, [a]);
    expect(second).toBe(first);
  });
});

describe("resolveSelectionFromUrl", () => {
  it("keeps only ids that are actual group members", () => {
    const a = member(1, "Run A");
    const b = member(2, "Run B");
    expect(resolveSelectionFromUrl([a, b], [2, 999])).toEqual([b]);
  });

  it("returns an empty selection when the URL carries no usable ids", () => {
    const a = member(1, "Run A");
    expect(resolveSelectionFromUrl([a], null)).toEqual([]);
    expect(resolveSelectionFromUrl([a], [])).toEqual([]);
    expect(resolveSelectionFromUrl([a], [42])).toEqual([]);
  });

  it("preserves member order rather than URL order", () => {
    const a = member(1, "Run A");
    const b = member(2, "Run B");
    expect(resolveSelectionFromUrl([a, b], [2, 1])).toEqual([a, b]);
  });
});

describe("configuration switcher call sites", () => {
  const APP = path.join(process.cwd(), "app", "[locale]", "projects");
  const files = [
    path.join(APP, "runs", "[projectId]", "[runId]", "TestCasesSection.tsx"),
    path.join(
      APP,
      "runs",
      "[projectId]",
      "[runId]",
      "DistributeAssignmentsModal.tsx"
    ),
    path.join(APP, "sessions", "[projectId]", "[sessionId]", "page.tsx"),
  ];

  it.each(files)("scopes the sibling query in %s to a project", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("buildConfigurationGroupWhere");
    expect(source).toContain("isConfigurationGroupQueryEnabled");
    // A bare group-id filter would cross project boundaries.
    expect(source).not.toMatch(
      /where:\s*\{\s*configurationGroupId:[^}]*isDeleted:\s*false\s*,?\s*\}/
    );
  });
});
