import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    projectIntegration: { findMany: vi.fn() },
    templates: { findFirst: vi.fn() },
    templateProjectAssignment: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  listGenerationProjects,
  loadTemplateData,
  templateBelongsToProject,
} from "./jira-panel-generation";

describe("jira-panel-generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listGenerationProjects", () => {
    const rows = [
      {
        project: { id: 10, name: "Zeta" },
        integrationProjects: [{ externalProjectKey: "ZET", isDefault: true }],
      },
      {
        project: { id: 11, name: "Alpha" },
        integrationProjects: [{ externalProjectKey: "ALP", isDefault: false }],
      },
    ];

    it("flags the issue's mapped project and sorts it first", async () => {
      mockPrisma.projectIntegration.findMany.mockResolvedValue(rows);
      const result = await listGenerationProjects(1, "ALP");
      expect(result).toEqual([
        { id: 11, name: "Alpha", isDefaultForIssue: true },
        { id: 10, name: "Zeta", isDefaultForIssue: false },
      ]);
    });

    it("matches the project key case-insensitively", async () => {
      mockPrisma.projectIntegration.findMany.mockResolvedValue(rows);
      const result = await listGenerationProjects(1, "alp");
      expect(result[0]).toMatchObject({ id: 11, isDefaultForIssue: true });
    });

    it("sorts alphabetically when no issue key is given", async () => {
      mockPrisma.projectIntegration.findMany.mockResolvedValue(rows);
      const result = await listGenerationProjects(1, null);
      expect(result.map((p) => p.name)).toEqual(["Alpha", "Zeta"]);
      expect(result.every((p) => !p.isDefaultForIssue)).toBe(true);
    });
  });

  describe("loadTemplateData", () => {
    it("maps case fields to TemplateData + fieldMappings, excluding Steps", async () => {
      mockPrisma.templates.findFirst.mockResolvedValue({
        id: 3,
        templateName: "Manual",
        caseFields: [
          {
            caseFieldId: 100,
            caseField: {
              displayName: "Description",
              isRequired: true,
              type: { type: "Text Long" },
              fieldOptions: [],
            },
          },
          {
            caseFieldId: 101,
            caseField: {
              displayName: "Priority",
              isRequired: false,
              type: { type: "Dropdown" },
              fieldOptions: [
                { fieldOption: { id: 1, name: "High" } },
                { fieldOption: { id: 2, name: "Low" } },
              ],
            },
          },
          {
            caseFieldId: 102,
            caseField: {
              displayName: "Steps",
              isRequired: false,
              type: { type: "Steps" },
              fieldOptions: [],
            },
          },
        ],
      });

      const loaded = await loadTemplateData(3);
      expect(loaded).not.toBeNull();
      expect(loaded!.template).toEqual({
        id: 3,
        name: "Manual",
        fields: [
          { id: 100, name: "Description", type: "Text Long", required: true },
          {
            id: 101,
            name: "Priority",
            type: "Dropdown",
            required: false,
            options: ["High", "Low"],
          },
          { id: 102, name: "Steps", type: "Steps", required: false },
        ],
      });
      // Steps is excluded from fieldMappings (steps persist separately).
      expect(loaded!.fieldMappings.map((m) => m.fieldName)).toEqual([
        "Description",
        "Priority",
      ]);
      expect(loaded!.fieldMappings[1].fieldOptions).toEqual([
        { id: 1, name: "High" },
        { id: 2, name: "Low" },
      ]);
    });

    it("returns null when the template doesn't exist", async () => {
      mockPrisma.templates.findFirst.mockResolvedValue(null);
      expect(await loadTemplateData(999)).toBeNull();
    });
  });

  describe("templateBelongsToProject", () => {
    it("returns true when an assignment exists", async () => {
      mockPrisma.templateProjectAssignment.findUnique.mockResolvedValue({
        templateId: 3,
      });
      expect(await templateBelongsToProject(3, 10)).toBe(true);
      expect(
        mockPrisma.templateProjectAssignment.findUnique
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { templateId_projectId: { templateId: 3, projectId: 10 } },
        })
      );
    });

    it("returns false when no assignment exists", async () => {
      mockPrisma.templateProjectAssignment.findUnique.mockResolvedValue(null);
      expect(await templateBelongsToProject(3, 99)).toBe(false);
    });
  });
});
