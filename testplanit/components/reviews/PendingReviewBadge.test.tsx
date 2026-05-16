import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PendingReviewBadge } from "./PendingReviewBadge";

// ─────────────────────────────────────────────────────────────────────────────
// Spies on `~/lib/hooks` — used to assert the badge does NOT fetch per row
// (per D-06 + RESEARCH §"Pitfall 6"; bulk-fetch is the parent's job).
// ─────────────────────────────────────────────────────────────────────────────

const mockUseFindFirstReviewRequest = vi.fn(() => ({ data: null }));
const mockUseFindManyReviewRequest = vi.fn(() => ({ data: [] }));

vi.mock("~/lib/hooks", () => ({
  useFindFirstReviewRequest: () => mockUseFindFirstReviewRequest(),
  useFindManyReviewRequest: () => mockUseFindManyReviewRequest(),
}));

function pending(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "rev-1",
    status: "PENDING",
    entityType: "CASE",
    entityId: 100,
    assigneeUserId: "user-1",
    assigneeRoleId: null,
    assigneeUser: { id: "user-1", name: "Alice", image: null },
    assigneeRole: null,
    ...overrides,
  };
}

describe("PendingReviewBadge", () => {
  beforeEach(() => {
    mockUseFindFirstReviewRequest.mockClear();
    mockUseFindManyReviewRequest.mockClear();
  });

  it("(a) renders null when pendingRequest is undefined", () => {
    const { container } = render(
      <PendingReviewBadge pendingRequest={undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("(b) renders null when pendingRequest.status !== PENDING", () => {
    const { container } = render(
      <PendingReviewBadge pendingRequest={pending({ status: "APPROVED" }) as any} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("(c) renders Badge + tooltip when PENDING", () => {
    render(<PendingReviewBadge pendingRequest={pending() as any} />);

    expect(screen.getByTestId("pending-review-badge")).toBeInTheDocument();
  });

  it("(d) assigneeUser name appears in the tooltip text when assigneeUserId is set", () => {
    render(<PendingReviewBadge pendingRequest={pending() as any} />);

    // The TooltipTrigger stub (vitest.setup.tsx) wraps children but its
    // content is portaled and stubbed to null. Surface the assignee label
    // via aria-label on the trigger so the tooltip text is asserted
    // regardless of the portal stub.
    const badge = screen.getByTestId("pending-review-badge");
    expect(badge.getAttribute("aria-label")).toContain("Alice");
  });

  it("(e) role name is used when assigneeRoleId is set instead of assigneeUserId", () => {
    render(
      <PendingReviewBadge
        pendingRequest={
          pending({
            assigneeUserId: null,
            assigneeUser: null,
            assigneeRoleId: 7,
            assigneeRole: { id: 7, name: "QA Lead" },
          }) as any
        }
      />,
    );

    const badge = screen.getByTestId("pending-review-badge");
    expect(badge.getAttribute("aria-label")).toContain("QA Lead");
  });

  it("(f) component does NOT call useFindFirstReviewRequest / useFindManyReviewRequest", () => {
    render(<PendingReviewBadge pendingRequest={pending() as any} />);

    expect(mockUseFindFirstReviewRequest).not.toHaveBeenCalled();
    expect(mockUseFindManyReviewRequest).not.toHaveBeenCalled();
  });
});
