import { describe, expect, it } from "vitest";

import { normalizeRecordKeyPath } from "./recordKeyRoutes";

describe("normalizeRecordKeyPath", () => {
  it("collapses a prefixed key on project detail routes to the numeric id", () => {
    expect(
      normalizeRecordKeyPath("/projects/repository/5/PROJECT-TC-1234")
    ).toBe("/projects/repository/5/1234");
    expect(normalizeRecordKeyPath("/projects/runs/5/PROJECT-TR-88")).toBe(
      "/projects/runs/5/88"
    );
    expect(normalizeRecordKeyPath("/projects/sessions/5/PROJECT-SN-9")).toBe(
      "/projects/sessions/5/9"
    );
    expect(normalizeRecordKeyPath("/projects/milestones/5/PROJECT-MS-3")).toBe(
      "/projects/milestones/5/3"
    );
    expect(normalizeRecordKeyPath("/projects/tags/5/PROJECT-TG-7")).toBe(
      "/projects/tags/5/7"
    );
    expect(
      normalizeRecordKeyPath("/projects/settings/5/datasets/PROJECT-DS-2")
    ).toBe("/projects/settings/5/datasets/2");
  });

  it("handles the global stubs", () => {
    expect(normalizeRecordKeyPath("/case/PROJECT-TC-1234")).toBe("/case/1234");
    expect(normalizeRecordKeyPath("/milestone/PROJECT-MS-3")).toBe(
      "/milestone/3"
    );
    expect(normalizeRecordKeyPath("/tags/PROJECT-TG-7")).toBe("/tags/7");
  });

  it("preserves trailing segments like /{version}", () => {
    expect(
      normalizeRecordKeyPath("/projects/repository/5/PROJECT-TC-1234/2")
    ).toBe("/projects/repository/5/1234/2");
    expect(normalizeRecordKeyPath("/projects/sessions/5/PROJECT-SN-9/3")).toBe(
      "/projects/sessions/5/9/3"
    );
  });

  it("accepts a lone token prefix and mixed case", () => {
    expect(normalizeRecordKeyPath("/case/TC-1234")).toBe("/case/1234");
    expect(normalizeRecordKeyPath("/case/project-tc-1234")).toBe("/case/1234");
  });

  it("returns null when the id segment is already a bare number", () => {
    expect(normalizeRecordKeyPath("/projects/repository/5/1234")).toBeNull();
    expect(normalizeRecordKeyPath("/case/1234")).toBeNull();
    expect(normalizeRecordKeyPath("/projects/runs/5/88/edit")).toBeNull();
  });

  it("returns null for unparseable id segments (route 404s naturally)", () => {
    expect(normalizeRecordKeyPath("/case/not-an-id")).toBeNull();
    expect(normalizeRecordKeyPath("/projects/repository/5/abc")).toBeNull();
  });

  it("does not touch non-record routes or slug ids", () => {
    expect(normalizeRecordKeyPath("/admin/app-config")).toBeNull();
    expect(
      normalizeRecordKeyPath("/admin/sso/saml/my-provider-123")
    ).toBeNull();
    expect(normalizeRecordKeyPath("/projects/overview/5")).toBeNull();
    expect(normalizeRecordKeyPath("/trial-expired")).toBeNull();
    expect(normalizeRecordKeyPath("/link-sso")).toBeNull();
  });
});
