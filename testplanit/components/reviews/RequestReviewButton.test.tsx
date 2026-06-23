import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RequestReviewButton,
  type RequestReviewButtonProps,
} from "./RequestReviewButton";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

// Stub the ZenStack-generated hook used by the single-entity auto-fetch
// fallback. Default returns `{ data: undefined }` (no PENDING request). Tests
// that need to exercise the auto-hide branch can override per-test by
// reassigning `mockAutoFetchedPendingData`.
let mockAutoFetchedPendingData: { id: string; status: "PENDING" } | undefined =
  undefined;
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    reviewRequest: { useFindFirst: () => ({ data: mockAutoFetchedPendingData }) },
  }),
}));

// Stub RequestReviewSheet so we don't re-test its internals here. The stub
// exposes its current `open` prop as a data attribute the parent test can
// assert on.
vi.mock("./RequestReviewSheet", () => ({
  RequestReviewSheet: ({
    open,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div data-testid="request-review-sheet-stub" data-open={String(open)} />
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const reachableState = (id = 11) => ({
  id,
  name: `State ${id}`,
  icon: { name: "Eye" },
  color: { value: "#888" },
});

function makeProps(
  overrides: Partial<RequestReviewButtonProps> = {}
): RequestReviewButtonProps {
  return {
    entityType: "CASE",
    entityId: 100,
    projectId: 42,
    currentStateId: 10,
    reachableGatedStates: [reachableState()],
    ...overrides,
  };
}

describe("RequestReviewButton", () => {
  beforeEach(() => {
    mockUseReviewFeatureEnabled.mockReset();
    // Default: feature enabled
    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: true,
      isLoading: false,
    });
  });

  it("(a) renders null when feature flag is disabled", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: false,
      isLoading: false,
    });

    const { container } = render(<RequestReviewButton {...makeProps()} />);
    expect(container.firstChild).toBeNull();
  });

  it("(b) renders null when pendingRequest is provided", () => {
    const { container } = render(
      <RequestReviewButton
        {...makeProps({
          pendingRequest: { id: "rev-1", status: "PENDING" },
        })}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("(c) renders null when reachableGatedStates is empty", () => {
    const { container } = render(
      <RequestReviewButton {...makeProps({ reachableGatedStates: [] })} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("(d) renders Button when feature enabled, no pendingRequest, and reachable states exist", () => {
    render(<RequestReviewButton {...makeProps()} />);
    expect(screen.getByTestId("request-review-button")).toBeInTheDocument();
  });

  it("(e) clicking the Button opens the Sheet (mocked sheet receives open=true)", () => {
    render(<RequestReviewButton {...makeProps()} />);
    const sheet = screen.getByTestId("request-review-sheet-stub");
    expect(sheet.getAttribute("data-open")).toBe("false");

    fireEvent.click(screen.getByTestId("request-review-button"));

    expect(sheet.getAttribute("data-open")).toBe("true");
  });

  it("(f) renders null while the feature-flag fetch is still loading", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      enabled: undefined,
      isLoading: true,
    });

    const { container } = render(<RequestReviewButton {...makeProps()} />);
    expect(container.firstChild).toBeNull();
  });
});
