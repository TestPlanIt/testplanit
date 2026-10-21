import { describe, expect, it, vi } from "vitest";
import {
  findProjectDefaultTemplateId,
  resolveDefaultTemplate,
} from "./defaultTemplate";

const TEMPLATES = [
  { id: 1, isDefault: false },
  { id: 2, isDefault: true },
  { id: 3, isDefault: false },
];

describe("resolveDefaultTemplate", () => {
  it("prefers the project default when it is one of the templates", () => {
    expect(resolveDefaultTemplate(TEMPLATES, 3)).toEqual({
      template: TEMPLATES[2],
      source: "project",
    });
  });

  it("uses the system default when the project has none", () => {
    expect(resolveDefaultTemplate(TEMPLATES, null)).toEqual({
      template: TEMPLATES[1],
      source: "system",
    });
  });

  it("falls back to the system default when the project default is unavailable", () => {
    expect(resolveDefaultTemplate(TEMPLATES, 99)).toEqual({
      template: TEMPLATES[1],
      source: "system",
    });
  });

  it("takes the first template when neither default applies", () => {
    const templates = [
      { id: 4, isDefault: false },
      { id: 5, isDefault: false },
    ];
    expect(resolveDefaultTemplate(templates, 99)).toEqual({
      template: templates[0],
      source: null,
    });
  });

  it("returns nothing for an empty or missing list", () => {
    expect(resolveDefaultTemplate([], 1)).toEqual({
      template: undefined,
      source: null,
    });
    expect(resolveDefaultTemplate(undefined, 1)).toEqual({
      template: undefined,
      source: null,
    });
  });
});

describe("findProjectDefaultTemplateId", () => {
  function clientWith(
    defaultTemplateId: number | null,
    templates: { id: number; isDefault: boolean }[]
  ) {
    return {
      projects: {
        findUnique: vi.fn().mockResolvedValue({ defaultTemplateId }),
      },
      templates: { findMany: vi.fn().mockResolvedValue(templates) },
    };
  }

  it("returns the project default when it is usable", async () => {
    const client = clientWith(3, TEMPLATES);
    await expect(findProjectDefaultTemplateId(client as any, 7)).resolves.toBe(
      3
    );
    expect(client.templates.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isDeleted: false,
          isEnabled: true,
          projects: { some: { projectId: 7 } },
        },
      })
    );
  });

  it("falls back to the system default", async () => {
    await expect(
      findProjectDefaultTemplateId(clientWith(99, TEMPLATES) as any, 7)
    ).resolves.toBe(2);
  });

  it("returns null when the project has no usable template", async () => {
    await expect(
      findProjectDefaultTemplateId(clientWith(3, []) as any, 7)
    ).resolves.toBeNull();
  });
});
