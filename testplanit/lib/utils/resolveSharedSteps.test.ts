import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSharedSteps, StepWithSharedRef } from "./resolveSharedSteps";

// Mock prisma
vi.mock("~/lib/prisma", () => ({
  prisma: {
    sharedStepItem: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "~/lib/prisma";

const mockFindMany = vi.mocked(prisma.sharedStepItem.findMany);

function makeStep(
  overrides: Partial<StepWithSharedRef> & { id: number; order: number }
): StepWithSharedRef {
  return {
    step: { type: "doc", content: [{ type: "text", text: `Step ${overrides.id}` }] },
    expectedResult: { type: "doc", content: [{ type: "text", text: `ER ${overrides.id}` }] },
    isDeleted: false,
    sharedStepGroupId: null,
    ...overrides,
  };
}

function makeSharedItem(id: number, groupId: number, order: number) {
  return {
    id,
    sharedStepGroupId: groupId,
    order,
    step: { type: "doc", content: [{ type: "text", text: `Shared step ${id}` }] },
    expectedResult: { type: "doc", content: [{ type: "text", text: `Shared ER ${id}` }] },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSharedSteps", () => {
  it("returns cases unchanged when no steps have sharedStepGroupId", async () => {
    const cases = [
      {
        id: 1,
        steps: [
          makeStep({ id: 10, order: 0 }),
          makeStep({ id: 11, order: 1 }),
        ],
      },
    ];

    const result = await resolveSharedSteps(cases);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(result).toEqual(cases);
  });

  it("returns cases unchanged when steps array is empty", async () => {
    const cases = [{ id: 1, steps: [] }];

    const result = await resolveSharedSteps(cases);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(result).toEqual(cases);
  });

  it("returns cases unchanged when steps is undefined", async () => {
    const cases: { id: number; steps?: StepWithSharedRef[] }[] = [{ id: 1 }];

    const result = await resolveSharedSteps(cases);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(result).toEqual(cases);
  });

  it("expands a shared step reference into its items", async () => {
    const cases = [
      {
        id: 1,
        steps: [makeStep({ id: 10, order: 0, sharedStepGroupId: 100 })],
      },
    ];

    mockFindMany.mockResolvedValue([
      makeSharedItem(201, 100, 0),
      makeSharedItem(202, 100, 1),
    ] as any);

    const result = await resolveSharedSteps(cases);

    expect(result[0].steps).toHaveLength(2);
    expect(result[0].steps![0].step).toEqual(makeSharedItem(201, 100, 0).step);
    expect(result[0].steps![1].step).toEqual(makeSharedItem(202, 100, 1).step);
    // Shared step references should be cleared
    expect(result[0].steps![0].sharedStepGroupId).toBeNull();
    expect(result[0].steps![1].sharedStepGroupId).toBeNull();
  });

  it("maintains order with mixed regular and shared steps", async () => {
    const cases = [
      {
        id: 1,
        steps: [
          makeStep({ id: 10, order: 0 }), // regular
          makeStep({ id: 11, order: 1, sharedStepGroupId: 100 }), // shared (2 items)
          makeStep({ id: 12, order: 2 }), // regular
        ],
      },
    ];

    mockFindMany.mockResolvedValue([
      makeSharedItem(201, 100, 0),
      makeSharedItem(202, 100, 1),
    ] as any);

    const result = await resolveSharedSteps(cases);

    expect(result[0].steps).toHaveLength(4);
    // First: regular step
    expect(result[0].steps![0].id).toBe(10);
    // Second & third: expanded shared items
    expect(result[0].steps![1].id).toBe(201);
    expect(result[0].steps![2].id).toBe(202);
    // Fourth: regular step
    expect(result[0].steps![3].id).toBe(12);
  });

  it("removes placeholder when shared group is deleted (no items returned)", async () => {
    const cases = [
      {
        id: 1,
        steps: [
          makeStep({ id: 10, order: 0 }), // regular
          makeStep({ id: 11, order: 1, sharedStepGroupId: 999 }), // deleted group
          makeStep({ id: 12, order: 2 }), // regular
        ],
      },
    ];

    // findMany returns empty for deleted group
    mockFindMany.mockResolvedValue([] as any);

    const result = await resolveSharedSteps(cases);

    expect(result[0].steps).toHaveLength(2);
    expect(result[0].steps![0].id).toBe(10);
    expect(result[0].steps![1].id).toBe(12);
  });

  it("batch-fetches shared items across multiple cases", async () => {
    const cases = [
      {
        id: 1,
        steps: [makeStep({ id: 10, order: 0, sharedStepGroupId: 100 })],
      },
      {
        id: 2,
        steps: [makeStep({ id: 20, order: 0, sharedStepGroupId: 200 })],
      },
    ];

    mockFindMany.mockResolvedValue([
      makeSharedItem(301, 100, 0),
      makeSharedItem(302, 200, 0),
      makeSharedItem(303, 200, 1),
    ] as any);

    const result = await resolveSharedSteps(cases);

    // Only one findMany call (batch)
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sharedStepGroupId: { in: expect.arrayContaining([100, 200]) },
        }),
      })
    );

    // Case 1: 1 shared item
    expect(result[0].steps).toHaveLength(1);
    expect(result[0].steps![0].id).toBe(301);

    // Case 2: 2 shared items
    expect(result[1].steps).toHaveLength(2);
    expect(result[1].steps![0].id).toBe(302);
    expect(result[1].steps![1].id).toBe(303);
  });

  it("deduplicates shared group IDs when same group is used in multiple steps", async () => {
    const cases = [
      {
        id: 1,
        steps: [
          makeStep({ id: 10, order: 0, sharedStepGroupId: 100 }),
          makeStep({ id: 11, order: 1 }),
          makeStep({ id: 12, order: 2, sharedStepGroupId: 100 }), // same group again
        ],
      },
    ];

    mockFindMany.mockResolvedValue([
      makeSharedItem(201, 100, 0),
    ] as any);

    const result = await resolveSharedSteps(cases);

    // Both shared references expand to the same items
    expect(result[0].steps).toHaveLength(3);
    expect(result[0].steps![0].id).toBe(201); // first shared ref expanded
    expect(result[0].steps![1].id).toBe(11);  // regular step
    expect(result[0].steps![2].id).toBe(201); // second shared ref expanded
  });

  it("does not mutate the original cases array", async () => {
    const originalStep = makeStep({ id: 10, order: 0, sharedStepGroupId: 100 });
    const cases = [{ id: 1, steps: [originalStep] }];

    mockFindMany.mockResolvedValue([makeSharedItem(201, 100, 0)] as any);

    const result = await resolveSharedSteps(cases);

    // Original should still have the shared ref
    expect(cases[0].steps[0].sharedStepGroupId).toBe(100);
    // Result should have expanded items
    expect(result[0].steps![0].sharedStepGroupId).toBeNull();
  });
});
