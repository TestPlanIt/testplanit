import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ baseDb: {} }));
vi.mock("./valkey", () => ({ default: null }));

import { type AccessManifest, hasAreaWriteAccess } from "./access-manifest";

const manifest = (
  projects: AccessManifest["projects"],
  isAdmin = false
): AccessManifest => ({
  userId: "u",
  access: isAdmin ? "ADMIN" : "USER",
  isAdmin,
  projects,
  generatedAt: 0,
});

describe("hasAreaWriteAccess", () => {
  const tagsOnly = {
    canRead: true,
    canWrite: true,
    canDelete: false,
    writableAreas: ["Tags"],
  };

  it("grants only the areas the role can add/edit in", () => {
    const m = manifest({ 7: tagsOnly });
    expect(hasAreaWriteAccess(m, 7, "Tags")).toBe(true);
    expect(hasAreaWriteAccess(m, 7, "Sessions")).toBe(false);
  });

  it("grants every area to project-wide and system admins", () => {
    const all = { ...tagsOnly, writableAreas: "all" as const };
    expect(hasAreaWriteAccess(manifest({ 7: all }), 7, "Sessions")).toBe(true);
    expect(hasAreaWriteAccess(manifest({}, true), 7, "Sessions")).toBe(true);
  });

  it("denies a project the user has no access to", () => {
    expect(hasAreaWriteAccess(manifest({}), 7, "Sessions")).toBe(false);
  });

  it("cannot answer for a manifest cached before per-area data", () => {
    const { writableAreas: _unused, ...legacy } = tagsOnly;
    expect(hasAreaWriteAccess(manifest({ 7: legacy }), 7, "Sessions")).toBe(
      undefined
    );
  });
});
