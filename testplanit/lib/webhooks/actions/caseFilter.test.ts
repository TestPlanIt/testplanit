import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRegistry, mockPending } = vi.hoisted(() => ({
  mockRegistry: vi.fn(),
  mockPending: vi.fn(),
}));
vi.mock("~/lib/repository/projectFilterRegistry", () => ({
  loadProjectFilterRegistry: (...a: unknown[]) => mockRegistry(...a),
  loadPendingReviewCaseIds: (...a: unknown[]) => mockPending(...a),
}));

import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import { applyCaseFilter, describeCaseFilter } from "./caseFilter";

const registry = buildFilterDimensions({
  dynamicFields: [
    { fieldId: 12, type: "Dropdown" },
    { fieldId: 13, type: "Text String" },
    { fieldId: 14, type: "Steps" },
    { fieldId: 15, type: "Checkbox" },
    { fieldId: 16, type: "Date" },
  ],
  includeInReview: true,
});

function makeDb(rows: Array<Record<string, unknown>> = []) {
  return {
    repositoryCases: { findMany: vi.fn().mockResolvedValue(rows) },
    templates: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 4, templateName: "Functional" }]),
    },
    workflows: {
      findMany: vi.fn().mockResolvedValue([{ id: 8, name: "Active" }]),
    },
    tags: { findMany: vi.fn().mockResolvedValue([{ id: 2, name: "smoke" }]) },
    issue: { findMany: vi.fn().mockResolvedValue([{ id: 9, name: "DEMO-9" }]) },
    user: { findMany: vi.fn().mockResolvedValue([{ id: "u1", name: "Ada" }]) },
    fieldOptions: {
      findMany: vi.fn().mockResolvedValue([
        { id: 31, name: "High" },
        { id: 32, name: "Critical" },
      ]),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRegistry.mockResolvedValue({
    registry,
    fieldLabels: {
      field_12: "Priority",
      field_13: "Component",
      field_14: "Steps",
      field_15: "Regression",
      field_16: "Due",
    },
  });
  mockPending.mockResolvedValue([10]);
});

describe("applyCaseFilter", () => {
  it("keeps the cases the compiled filters match, in the order given", async () => {
    const db = makeDb([{ id: 11 }, { id: 10 }]);

    const kept = await applyCaseFilter(
      db,
      3,
      [12, 10, 11],
      [
        { dimension: "automated", operator: "is", values: [1] },
        { dimension: "tags", operator: "any", values: [2] },
      ]
    );

    expect(kept).toEqual([10, 11]);
    expect(mockRegistry).toHaveBeenCalledWith(db, 3);
    expect(db.repositoryCases.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { id: { in: [12, 10, 11] }, projectId: 3 },
          { automated: true },
          expect.objectContaining({ caseTags: expect.anything() }),
        ],
      },
      select: { id: true },
    });
    expect(mockPending).not.toHaveBeenCalled();
  });

  it("applies the text and steps halves after the fetch", async () => {
    const db = makeDb([
      {
        id: 10,
        caseFieldValues: [{ fieldId: 13, value: "Checkout" }],
        steps: [{ id: 1 }, { id: 2 }, { id: 3 }],
      },
      {
        id: 11,
        caseFieldValues: [{ fieldId: 13, value: "Payments" }],
        steps: [{ id: 4 }, { id: 5 }, { id: 6 }],
      },
      {
        id: 12,
        caseFieldValues: [{ fieldId: 13, value: "Checkout flow" }],
        steps: [{ id: 7 }],
      },
    ]);

    const kept = await applyCaseFilter(
      db,
      3,
      [10, 11, 12],
      [
        { dimension: "field_13", operator: "contains", values: ["check"] },
        { dimension: "field_14", operator: "gte", values: [2] },
      ]
    );

    expect(kept).toEqual([10]);
    expect(db.repositoryCases.findMany.mock.calls[0][0].select).toEqual({
      id: true,
      caseFieldValues: {
        where: { fieldId: { in: [13] } },
        select: { fieldId: true, value: true },
      },
      steps: { where: { isDeleted: false }, select: { id: true } },
    });
  });

  it("resolves the pending-review cases for an In Review filter", async () => {
    const db = makeDb([{ id: 10 }]);

    const kept = await applyCaseFilter(
      db,
      3,
      [10, 11],
      [{ dimension: "inReview", operator: "is", values: [1] }]
    );

    expect(kept).toEqual([10]);
    expect(mockPending).toHaveBeenCalledWith(db, 3);
    expect(db.repositoryCases.findMany.mock.calls[0][0].where.AND[1]).toEqual({
      id: { in: [10] },
    });
  });

  it("leaves the cases alone when no filter applies to the project any more, and answers nothing for nothing", async () => {
    const db = makeDb();
    expect(
      await applyCaseFilter(
        db,
        3,
        [10, 11],
        [
          { dimension: "field_99", operator: "in", values: [1] },
          { dimension: "status", operator: "in", values: [1] },
        ]
      )
    ).toEqual([10, 11]);
    expect(db.repositoryCases.findMany).not.toHaveBeenCalled();
    expect(await applyCaseFilter(db, 3, [], [])).toEqual([]);
    expect(mockRegistry).toHaveBeenCalledTimes(1);
  });
});

describe("describeCaseFilter", () => {
  it("names each filter as the repository's chips do, with ids replaced by names", async () => {
    const db = makeDb();

    expect(
      await describeCaseFilter(db, 3, [
        { dimension: "field_12", operator: "in", values: [31, "32"] },
        { dimension: "automated", operator: "is", values: [1] },
        { dimension: "field_15", operator: "is", values: [0] },
        { dimension: "templates", operator: "in", values: [4] },
        { dimension: "states", operator: "in", values: [8] },
        { dimension: "creators", operator: "in", values: ["u1"] },
        { dimension: "tags", operator: "none", values: [2] },
        { dimension: "issues", operator: "all", values: [9] },
        { dimension: "field_13", operator: "contains", values: ["pay"] },
        { dimension: "field_14", operator: "between", values: [5, 2] },
        { dimension: "field_16", operator: "last30", values: [] },
        {
          dimension: "field_16",
          operator: "on",
          values: ["2026-10-19T12:00:00"],
        },
        { dimension: "attachments", operator: "is", values: [1] },
      ])
    ).toBe(
      [
        "Priority: Is any of High, Critical",
        "Automation: Is Automated",
        "Regression: Is Unchecked",
        "Template: Is any of Functional",
        "State: Is any of Active",
        "Creator: Is any of Ada",
        "Tag: None of smoke",
        "Issue: All of DEMO-9",
        "Component: Contains pay",
        "Steps: Between 2, 5",
        "Due: Last 30 days",
        "Due: On Oct 19, 2026",
        "Attachments: Is Has Attachments",
      ].join("; ")
    );
    expect(db.fieldOptions.findMany).toHaveBeenCalledWith({
      where: { id: { in: [31, 32] } },
      select: { id: true, name: true },
    });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["u1"] } },
      select: { id: true, name: true },
    });
  });

  it("shows the id when its row is gone, and skips filters the project no longer offers", async () => {
    const db = makeDb();
    db.tags.findMany.mockResolvedValue([]);

    expect(
      await describeCaseFilter(db, 3, [
        { dimension: "tags", operator: "any", values: [2] },
        { dimension: "field_99", operator: "in", values: [1] },
      ])
    ).toBe("Tag: Any of 2");
    expect(
      await describeCaseFilter(db, 3, [
        { dimension: "field_99", operator: "in", values: [1] },
      ])
    ).toBeNull();
    expect(await describeCaseFilter(db, 3, "nonsense")).toBeNull();
  });
});
