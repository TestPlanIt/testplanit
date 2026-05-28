import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignImportedConfigurationsToProjects } from "./configurationImports";

function makeTx(rows: Array<{ projectId: number; configId: number | null }>) {
  return {
    testRuns: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
    projectConfigurationAssignment: {
      createMany: vi.fn().mockResolvedValue({ count: rows.length }),
    },
  } as any;
}

describe("assignImportedConfigurationsToProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits when no projects were imported", async () => {
    const tx = makeTx([]);

    const result = await assignImportedConfigurationsToProjects(tx, []);

    expect(result).toEqual({ created: 0 });
    expect(tx.testRuns.findMany).not.toHaveBeenCalled();
    expect(tx.projectConfigurationAssignment.createMany).not.toHaveBeenCalled();
  });

  it("queries distinct project/config pairs scoped to the imported projects", async () => {
    const tx = makeTx([{ projectId: 1, configId: 10 }]);

    await assignImportedConfigurationsToProjects(tx, [1, 2]);

    expect(tx.testRuns.findMany).toHaveBeenCalledWith({
      where: {
        projectId: { in: [1, 2] },
        configId: { not: null },
        isDeleted: false,
      },
      select: { projectId: true, configId: true },
      distinct: ["projectId", "configId"],
    });
  });

  it("creates one assignment per run-used project/config pair", async () => {
    const tx = makeTx([
      { projectId: 1, configId: 10 },
      { projectId: 1, configId: 11 },
      { projectId: 2, configId: 10 },
    ]);

    const result = await assignImportedConfigurationsToProjects(tx, [1, 2]);

    expect(tx.projectConfigurationAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: 1, configurationId: 10 },
        { projectId: 1, configurationId: 11 },
        { projectId: 2, configurationId: 10 },
      ],
      skipDuplicates: true,
    });
    expect(result).toEqual({ created: 3 });
  });

  it("ignores runs without a configuration", async () => {
    const tx = makeTx([
      { projectId: 1, configId: null },
      { projectId: 1, configId: 10 },
    ]);

    await assignImportedConfigurationsToProjects(tx, [1]);

    expect(tx.projectConfigurationAssignment.createMany).toHaveBeenCalledWith({
      data: [{ projectId: 1, configurationId: 10 }],
      skipDuplicates: true,
    });
  });

  it("does not write when no run uses a configuration", async () => {
    const tx = makeTx([{ projectId: 1, configId: null }]);

    const result = await assignImportedConfigurationsToProjects(tx, [1]);

    expect(result).toEqual({ created: 0 });
    expect(tx.projectConfigurationAssignment.createMany).not.toHaveBeenCalled();
  });
});
