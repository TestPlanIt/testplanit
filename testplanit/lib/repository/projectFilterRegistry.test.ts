import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSystemReview } = vi.hoisted(() => ({ mockSystemReview: vi.fn() }));
vi.mock("~/lib/services/reviewFeatureFlag", () => ({
  isReviewFeatureSystemEnabled: (...a: unknown[]) => mockSystemReview(...a),
}));

import {
  loadPendingReviewCaseIds,
  loadProjectFilterRegistry,
} from "./projectFilterRegistry";

const field = (id: number, displayName: string, type: string) => ({
  caseField: { id, displayName, type: { type } },
});

function makeDb(
  opts: {
    project?: { reviewWorkflowEnabled: boolean; impactEnabled: boolean } | null;
    templates?: unknown[];
  } = {}
) {
  return {
    projects: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts.project === undefined
            ? { reviewWorkflowEnabled: true, impactEnabled: true }
            : opts.project
        ),
    },
    templates: {
      findMany: vi.fn().mockResolvedValue(
        opts.templates ?? [
          {
            caseFields: [
              field(12, "Priority", "Dropdown"),
              field(13, "Notes", "Text Long"),
              field(14, "Owner", "User"),
            ],
          },
          { caseFields: [field(12, "Priority", "Dropdown")] },
        ]
      ),
    },
    reviewRequest: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { entityId: 10 },
          { entityId: 11 },
          { entityId: 10 },
        ]),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSystemReview.mockResolvedValue(true);
});

describe("loadProjectFilterRegistry", () => {
  it("builds the repository's dimensions from the project's templates and flags, without run dimensions", async () => {
    const db = makeDb();

    const { registry, fieldLabels } = await loadProjectFilterRegistry(db, 3);

    expect([...registry.keys()]).toEqual([
      "templates",
      "states",
      "creators",
      "automated",
      "parameterized",
      "attachments",
      "tags",
      "issues",
      "inReview",
      "codePins",
      "field_12",
      "field_13",
    ]);
    expect(registry.get("field_12")).toMatchObject({
      fieldId: 12,
      fieldType: "Dropdown",
    });
    expect(fieldLabels).toEqual({ field_12: "Priority", field_13: "Notes" });
    expect(db.templates.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isDeleted: false, projects: { some: { projectId: 3 } } },
      })
    );
    expect(
      db.templates.findMany.mock.calls[0][0].select.caseFields.where
    ).toEqual({ caseField: { isEnabled: true, isDeleted: false } });
  });

  it("leaves In Review out unless both the system and the project run reviews, and Code Pins out without Impact", async () => {
    mockSystemReview.mockResolvedValue(false);
    const { registry } = await loadProjectFilterRegistry(
      makeDb({
        project: { reviewWorkflowEnabled: true, impactEnabled: false },
      }),
      3
    );
    expect(registry.has("inReview")).toBe(false);
    expect(registry.has("codePins")).toBe(false);

    mockSystemReview.mockResolvedValue(true);
    const { registry: projectOff } = await loadProjectFilterRegistry(
      makeDb({
        project: { reviewWorkflowEnabled: false, impactEnabled: true },
      }),
      3
    );
    expect(projectOff.has("inReview")).toBe(false);
    expect(projectOff.has("codePins")).toBe(true);

    const { registry: noProject } = await loadProjectFilterRegistry(
      makeDb({ project: null, templates: [] }),
      3
    );
    expect(noProject.has("inReview")).toBe(false);
    expect(noProject.has("field_12")).toBe(false);
  });
});

describe("loadPendingReviewCaseIds", () => {
  it("returns the distinct cases with a pending review request", async () => {
    const db = makeDb();
    expect(await loadPendingReviewCaseIds(db, 3)).toEqual([10, 11]);
    expect(db.reviewRequest.findMany).toHaveBeenCalledWith({
      where: {
        projectId: 3,
        entityType: "CASE",
        status: "PENDING",
        isDeleted: false,
      },
      select: { entityId: true },
    });
  });
});
