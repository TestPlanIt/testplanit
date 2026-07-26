import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture the args each render passes into the zenstack hook so the
// where-clause contract can be asserted directly.
const { mockUseFindMany, mockFeature } = vi.hoisted(() => ({
  mockUseFindMany: vi.fn(),
  mockFeature: { enabled: true as boolean | undefined },
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    reviewRequest: { useFindMany: mockUseFindMany },
  }),
}));

vi.mock("./useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: () => mockFeature,
}));

import { usePendingReviewsByEntity } from "./usePendingReviewsByEntity";

beforeEach(() => {
  vi.clearAllMocks();
  mockFeature.enabled = true;
  mockUseFindMany.mockReturnValue({ data: undefined });
});

describe("usePendingReviewsByEntity", () => {
  it("scopes the query to PENDING reviews of the given entities in review-enabled projects", () => {
    renderHook(() => usePendingReviewsByEntity("RUN", [11, 22]));

    const [args] = mockUseFindMany.mock.calls[0];
    expect(args.where).toMatchObject({
      entityType: "RUN",
      entityId: { in: [11, 22] },
      status: "PENDING",
      isDeleted: false,
      // The guard that keeps cross-project surfaces (dashboard, profile
      // assignments) from badging entities in projects with the review
      // workflow switched off.
      project: { reviewWorkflowEnabled: true },
    });
  });

  it("keeps the query disabled until the feature flag resolves to true", () => {
    mockFeature.enabled = undefined;
    renderHook(() => usePendingReviewsByEntity("CASE", [1]));
    expect(mockUseFindMany.mock.calls[0][1]).toMatchObject({ enabled: false });

    mockFeature.enabled = false;
    renderHook(() => usePendingReviewsByEntity("CASE", [1]));
    expect(mockUseFindMany.mock.calls[1][1]).toMatchObject({ enabled: false });
  });

  it("keeps the query disabled for an empty id page", () => {
    renderHook(() => usePendingReviewsByEntity("SESSION", []));
    expect(mockUseFindMany.mock.calls[0][1]).toMatchObject({ enabled: false });
  });

  it("keys the returned map by entityId", () => {
    mockUseFindMany.mockReturnValue({
      data: [
        { id: 1, status: "PENDING", entityId: 11, assigneeUserId: "u1" },
        { id: 2, status: "PENDING", entityId: 22, assigneeUserId: null },
      ],
    });

    const { result } = renderHook(() =>
      usePendingReviewsByEntity("RUN", [11, 22, 33])
    );

    expect(result.current.get(11)?.id).toBe(1);
    expect(result.current.get(22)?.id).toBe(2);
    expect(result.current.has(33)).toBe(false);
  });

  it("returns an empty map while the data is loading", () => {
    const { result } = renderHook(() => usePendingReviewsByEntity("RUN", [11]));
    expect(result.current.size).toBe(0);
  });
});
