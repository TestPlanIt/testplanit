import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdateMilestone } = vi.hoisted(() => ({
  mockUpdateMilestone: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    milestones: { useUpdate: () => ({ mutateAsync: mockUpdateMilestone }) },
  }),
}));

vi.mock("next-intl", () => ({
  // Echo the key tail plus any interpolation values so ICU-plural keys
  // (childrenWarning's {count}) can be asserted without a full formatter.
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const tail = key.split(".").pop() ?? key;
    return values ? `${tail}:${JSON.stringify(values)}` : tail;
  },
}));

import { DeleteMilestoneModal } from "./DeleteMilestoneModal";

const makeMilestone = (id: number, parentId: number | null = null) =>
  ({
    id,
    parentId,
    name: `Milestone ${id}`,
  }) as any;

describe("DeleteMilestoneModal — descendant warning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMilestone.mockResolvedValue({});
  });

  it("mentions the recursive delete with the full descendant count (children + grandchildren)", () => {
    const parent = makeMilestone(1);
    const milestones = [
      parent,
      makeMilestone(2, 1), // child
      makeMilestone(3, 2), // grandchild
      makeMilestone(4, null), // unrelated root
    ];

    render(
      <DeleteMilestoneModal
        milestone={parent}
        open={true}
        onOpenChange={() => {}}
        milestones={milestones}
      />
    );

    expect(screen.getByText(/childrenWarning:\{"count":2\}/)).toBeTruthy();
  });

  it("shows no descendant warning for a leaf milestone", () => {
    const leaf = makeMilestone(4);
    const milestones = [makeMilestone(1), makeMilestone(2, 1), leaf];

    render(
      <DeleteMilestoneModal
        milestone={leaf}
        open={true}
        onOpenChange={() => {}}
        milestones={milestones}
      />
    );

    expect(screen.queryByText(/childrenWarning/)).toBeNull();
  });
});
