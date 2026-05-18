import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewStatusBanner } from "./ReviewStatusBanner";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockUseFindFirstReviewRequest = vi.fn();
const mockUseUpdateReviewRequest = vi.fn(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("~/lib/hooks", () => ({
  useFindFirstReviewRequest: (...args: unknown[]) =>
    mockUseFindFirstReviewRequest(...args),
  useUpdateReviewRequest: () => mockUseUpdateReviewRequest(),
}));

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

const mockUseSession = vi.fn();
vi.mock("next-auth/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("next-auth/react")>();
  return {
    ...original,
    useSession: () => mockUseSession(),
  };
});

// Capture the props passed into the RequestReviewSheet stub so test (j) can
// assert the D-08 pre-fill payload reaches it.
const mockSheetPropsCapture = vi.fn();
vi.mock("./RequestReviewSheet", () => ({
  RequestReviewSheet: (props: Record<string, unknown>) => {
    mockSheetPropsCapture(props);
    return props.open ? (
      <div
        data-testid="request-review-sheet-stub"
        data-initial-target-state-id={
          (props.initialValues as { targetStateId?: number } | undefined)
            ?.targetStateId ?? ""
        }
      />
    ) : null;
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRequest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "rev-1",
    status: "PENDING",
    entityType: "CASE",
    entityId: 100,
    projectId: 42,
    fromStateId: 10,
    toStateId: 11,
    requestedByUserId: "requester-1",
    assigneeUserId: "assignee-1",
    assigneeRoleId: null,
    decisionComment: null,
    isDeleted: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 5), // 5 min ago
    requestedBy: {
      id: "requester-1",
      name: "Alice Requester",
      image: null,
    },
    assigneeUser: { id: "assignee-1", name: "Bob Reviewer", image: null },
    assigneeRole: null,
    ...overrides,
  };
}

function withFeatureEnabled(enabled = true, isLoading = false) {
  mockUseReviewFeatureEnabled.mockReturnValue({
    enabled,
    isLoading,
    systemEnabled: enabled,
    projectEnabled: enabled,
  });
}

function withSession(userId: string, access: string = "MEMBER") {
  mockUseSession.mockReturnValue({
    data: {
      user: { id: userId, name: "Test", email: "t@example.com", access },
    },
    status: "authenticated",
  });
}

function withRequest(request: Record<string, unknown> | null) {
  mockUseFindFirstReviewRequest.mockReturnValue({
    data: request,
    isLoading: false,
  });
}

const props = {
  entityType: "CASE" as const,
  entityId: 100,
  projectId: 42,
  reachableGatedStates: [
    {
      id: 11,
      name: "In Review",
      icon: { name: "Eye" },
      color: { value: "#888888" },
    },
  ],
};

describe("ReviewStatusBanner", () => {
  beforeEach(() => {
    mockUseFindFirstReviewRequest.mockReset();
    mockUseReviewFeatureEnabled.mockReset();
    mockUseSession.mockReset();
    mockSheetPropsCapture.mockReset();
  });

  it("(a) renders null when feature flag disabled", () => {
    withFeatureEnabled(false);
    withSession("any-user");
    withRequest(makeRequest());

    const { container } = render(<ReviewStatusBanner {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("(b) renders null when no request exists", () => {
    withFeatureEnabled(true);
    withSession("any-user");
    withRequest(null);

    const { container } = render(<ReviewStatusBanner {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("(c) renders null when status === APPROVED", () => {
    withFeatureEnabled(true);
    withSession("any-user");
    withRequest(makeRequest({ status: "APPROVED" }));

    const { container } = render(<ReviewStatusBanner {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("(d) renders null when status === CANCELLED", () => {
    withFeatureEnabled(true);
    withSession("any-user");
    withRequest(makeRequest({ status: "CANCELLED" }));

    const { container } = render(<ReviewStatusBanner {...props} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("(e) PENDING + viewer is requester → banner visible + Cancel button visible", () => {
    withFeatureEnabled(true);
    withSession("requester-1");
    withRequest(makeRequest());

    render(<ReviewStatusBanner {...props} />);

    expect(
      screen.getByTestId("review-status-banner-pending"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("cancel-request-button")).toBeInTheDocument();
  });

  it("(f) PENDING + viewer is admin → Cancel visible", () => {
    withFeatureEnabled(true);
    withSession("other-user", "ADMIN");
    withRequest(makeRequest());

    render(<ReviewStatusBanner {...props} />);

    expect(
      screen.getByTestId("review-status-banner-pending"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("cancel-request-button")).toBeInTheDocument();
  });

  it("(g) PENDING + viewer is uninvolved → banner visible but Cancel hidden", () => {
    withFeatureEnabled(true);
    withSession("bystander-user", "MEMBER");
    withRequest(makeRequest());

    render(<ReviewStatusBanner {...props} />);

    expect(
      screen.getByTestId("review-status-banner-pending"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("cancel-request-button"),
    ).not.toBeInTheDocument();
  });

  it("(h) CHANGES_REQUESTED → warning-styled banner with decisionComment + Request-again button", () => {
    withFeatureEnabled(true);
    withSession("requester-1");
    withRequest(
      makeRequest({
        status: "CHANGES_REQUESTED",
        decisionComment: "Please clarify step 3 expectations",
      }),
    );

    render(<ReviewStatusBanner {...props} />);

    expect(
      screen.getByTestId("review-status-banner-changes-requested"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please clarify step 3 expectations"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("request-review-again-button"),
    ).toBeInTheDocument();
  });

  it("(i) REJECTED → destructive variant + Request-again button", () => {
    withFeatureEnabled(true);
    withSession("requester-1");
    withRequest(
      makeRequest({
        status: "REJECTED",
        decisionComment: "Insufficient coverage",
      }),
    );

    render(<ReviewStatusBanner {...props} />);

    expect(
      screen.getByTestId("review-status-banner-rejected"),
    ).toBeInTheDocument();
    expect(screen.getByText("Insufficient coverage")).toBeInTheDocument();
    expect(
      screen.getByTestId("request-review-again-button"),
    ).toBeInTheDocument();
  });

  it("(i.5) WR-09 — decisionComment paragraph applies line-clamp-6 + break-words + whitespace-pre-line", () => {
    withFeatureEnabled(true);
    withSession("requester-1");
    withRequest(
      makeRequest({
        status: "REJECTED",
        // A pathologically long comment with no spaces would otherwise
        // break the banner layout. Verify the truncation utility classes
        // are present so an oversized paste degrades gracefully.
        decisionComment: "x".repeat(5000),
      }),
    );

    render(<ReviewStatusBanner {...props} />);

    const para = screen.getByTestId(
      "review-status-banner-decision-comment",
    );
    expect(para.className).toMatch(/line-clamp-6/);
    expect(para.className).toMatch(/break-words/);
    expect(para.className).toMatch(/whitespace-pre-line/);
  });

  it("(j) Request-again click opens RequestReviewSheet with initialValues prefilling targetStateId", () => {
    withFeatureEnabled(true);
    withSession("requester-1");
    withRequest(
      makeRequest({
        status: "CHANGES_REQUESTED",
        decisionComment: "Try again",
        toStateId: 11,
        assigneeUserId: "assignee-1",
        assigneeUser: { id: "assignee-1", name: "Bob Reviewer", image: null },
      }),
    );

    render(<ReviewStatusBanner {...props} />);

    const requestAgain = screen.getByTestId("request-review-again-button");
    fireEvent.click(requestAgain);

    // The stub captures props on each render — at least one call must have
    // had open=true with the expected initialValues.
    const calls = mockSheetPropsCapture.mock.calls;
    const openedWithPrefill = calls.find(
      (c) =>
        c[0]?.open === true &&
        c[0]?.initialValues?.targetStateId === 11,
    );
    expect(openedWithPrefill).toBeTruthy();
  });
});
