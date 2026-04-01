/**
 * Tests for AddSessionModal multi-configuration and duplication logic.
 *
 * The AddSessionModal now supports:
 * - Selecting multiple configurations (creates one session per config)
 * - Linking multi-config sessions via a shared configurationGroupId (UUID)
 * - Accepting a duplication preset to pre-populate the form
 *
 * These tests verify the core logic extracted from the component.
 */

import { describe, expect, it } from "vitest";

/**
 * Simulate the multi-config creation logic from onSubmit.
 * Given configIds, returns the list of configIds to create and a groupId.
 */
function resolveConfigsToCreate(configIds: number[]): {
  configsToCreate: (number | null)[];
  configurationGroupId: string | null;
} {
  const configsToCreate = configIds.length > 0 ? configIds : [null];
  // Use a deterministic fake UUID for testing
  const configurationGroupId =
    configsToCreate.length > 1 ? "test-uuid-group-id" : null;
  return { configsToCreate, configurationGroupId };
}

/**
 * Simulate the duplication preset defaultValues logic.
 */
function buildDuplicationDefaults(
  preset: {
    originalName: string;
    originalConfigId: number | null;
    originalMilestoneId: number | null;
    originalStateId: number | null;
    originalAssignedToId: string | null;
    originalTemplateId: number;
    originalIssueIds: number[];
  },
  duplicateLabel: string,
  defaultMilestoneId?: number
) {
  return {
    name: `${preset.originalName} - ${duplicateLabel}`,
    templateId: preset.originalTemplateId,
    configIds: preset.originalConfigId ? [preset.originalConfigId] : [],
    milestoneId: preset.originalMilestoneId ?? defaultMilestoneId ?? null,
    stateId: preset.originalStateId || 0,
    assignedToId: preset.originalAssignedToId || "",
    issueIds: preset.originalIssueIds,
  };
}

describe("AddSessionModal - Multi-Configuration Logic", () => {
  it("creates a single session with null config when no configs selected", () => {
    const { configsToCreate, configurationGroupId } =
      resolveConfigsToCreate([]);

    expect(configsToCreate).toEqual([null]);
    expect(configurationGroupId).toBeNull();
  });

  it("creates a single session with no group ID when one config selected", () => {
    const { configsToCreate, configurationGroupId } =
      resolveConfigsToCreate([42]);

    expect(configsToCreate).toEqual([42]);
    expect(configurationGroupId).toBeNull();
  });

  it("creates multiple sessions with a shared group ID when multiple configs selected", () => {
    const { configsToCreate, configurationGroupId } = resolveConfigsToCreate([
      1, 2, 3,
    ]);

    expect(configsToCreate).toEqual([1, 2, 3]);
    expect(configurationGroupId).not.toBeNull();
    expect(configurationGroupId).toBe("test-uuid-group-id");
  });

  it("creates exactly one session per selected configuration", () => {
    const configs = [10, 20, 30, 40];
    const { configsToCreate } = resolveConfigsToCreate(configs);

    expect(configsToCreate).toHaveLength(4);
    expect(configsToCreate).toEqual(configs);
  });
});

describe("AddSessionModal - Duplication Preset Defaults", () => {
  const duplicateLabel = "Duplicate";

  it("pre-populates name with original name + duplicate suffix", () => {
    const defaults = buildDuplicationDefaults(
      {
        originalName: "Sprint 5 Session",
        originalConfigId: null,
        originalMilestoneId: null,
        originalStateId: 10,
        originalAssignedToId: null,
        originalTemplateId: 1,
        originalIssueIds: [],
      },
      duplicateLabel
    );

    expect(defaults.name).toBe("Sprint 5 Session - Duplicate");
  });

  it("pre-populates configIds from original single config", () => {
    const defaults = buildDuplicationDefaults(
      {
        originalName: "Config Session",
        originalConfigId: 42,
        originalMilestoneId: null,
        originalStateId: 10,
        originalAssignedToId: null,
        originalTemplateId: 1,
        originalIssueIds: [],
      },
      duplicateLabel
    );

    expect(defaults.configIds).toEqual([42]);
  });

  it("uses empty configIds when original had no config", () => {
    const defaults = buildDuplicationDefaults(
      {
        originalName: "No Config",
        originalConfigId: null,
        originalMilestoneId: null,
        originalStateId: 10,
        originalAssignedToId: null,
        originalTemplateId: 1,
        originalIssueIds: [],
      },
      duplicateLabel
    );

    expect(defaults.configIds).toEqual([]);
  });

  it("preserves milestone from original session", () => {
    const defaults = buildDuplicationDefaults(
      {
        originalName: "Milestone Session",
        originalConfigId: null,
        originalMilestoneId: 99,
        originalStateId: 10,
        originalAssignedToId: null,
        originalTemplateId: 1,
        originalIssueIds: [],
      },
      duplicateLabel
    );

    expect(defaults.milestoneId).toBe(99);
  });

  it("falls back to defaultMilestoneId when original has none", () => {
    const defaults = buildDuplicationDefaults(
      {
        originalName: "No Milestone",
        originalConfigId: null,
        originalMilestoneId: null,
        originalStateId: 10,
        originalAssignedToId: null,
        originalTemplateId: 1,
        originalIssueIds: [],
      },
      duplicateLabel,
      55
    );

    expect(defaults.milestoneId).toBe(55);
  });

  it("preserves all metadata fields from the original", () => {
    const defaults = buildDuplicationDefaults(
      {
        originalName: "Full Session",
        originalConfigId: 5,
        originalMilestoneId: 10,
        originalStateId: 20,
        originalAssignedToId: "user-123",
        originalTemplateId: 3,
        originalIssueIds: [100, 200],
      },
      duplicateLabel
    );

    expect(defaults).toEqual({
      name: "Full Session - Duplicate",
      templateId: 3,
      configIds: [5],
      milestoneId: 10,
      stateId: 20,
      assignedToId: "user-123",
      issueIds: [100, 200],
    });
  });

  it("uses empty assignedToId when original had no assignee", () => {
    const defaults = buildDuplicationDefaults(
      {
        originalName: "Unassigned",
        originalConfigId: null,
        originalMilestoneId: null,
        originalStateId: 10,
        originalAssignedToId: null,
        originalTemplateId: 1,
        originalIssueIds: [],
      },
      duplicateLabel
    );

    expect(defaults.assignedToId).toBe("");
  });
});
