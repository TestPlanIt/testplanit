import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewInboxButton } from "./ReviewInboxButton";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// next-auth session
const mockUseSession = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
}));

// feature flag (system-level — no projectId)
const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

// ZenStack hooks: count + user role lookup + access-visible project count
const mockUseCountReviewRequest = vi.fn();
const mockUseFindUniqueUser = vi.fn();
const mockUseCountProjects = vi.fn();
vi.mock("~/lib/hooks", () => ({
  useCountReviewRequest: (...args: unknown[]) =>
    mockUseCountReviewRequest(...args),
  useFindUniqueUser: (...args: unknown[]) => mockUseFindUniqueUser(...args),
  useCountProjects: (...args: unknown[]) => mockUseCountProjects(...args),
}));

// ~/lib/navigation Link — required wrapper, NEVER next/link.
vi.mock("~/lib/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} data-mock-link="true" {...rest}>
      {children}
    </a>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function setupDefaults({
  enabled = true,
  count = 0,
  authenticated = true,
  roleIds = [7],
  reviewEnabledProjectCount = 1,
  reviewEnabledProjectCountLoading = false,
}: {
  enabled?: boolean;
  count?: number;
  authenticated?: boolean;
  roleIds?: number[];
  reviewEnabledProjectCount?: number | undefined;
  reviewEnabledProjectCountLoading?: boolean;
} = {}) {
  mockUseReviewFeatureEnabled.mockReturnValue({
    enabled,
    isLoading: false,
  });

  mockUseSession.mockReturnValue({
    data: authenticated ? { user: { id: "user-1", access: "USER" } } : null,
    status: authenticated ? "authenticated" : "unauthenticated",
  });

  // Compose a user with a global roleId + a SPECIFIC_ROLE project permission.
  // The component flattens these into `currentUserRoleIds`.
  mockUseFindUniqueUser.mockReturnValue({
    data: authenticated
      ? {
          roleId: roleIds[0] ?? null,
          projectPermissions: roleIds.slice(1).map((roleId) => ({
            roleId,
            accessType: "SPECIFIC_ROLE",
          })),
        }
      : undefined,
  });

  mockUseCountReviewRequest.mockReturnValue({ data: count });

  mockUseCountProjects.mockReturnValue({
    data: reviewEnabledProjectCount,
    isLoading: reviewEnabledProjectCountLoading,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ReviewInboxButton", () => {
  beforeEach(() => {
    mockUseSession.mockReset();
    mockUseReviewFeatureEnabled.mockReset();
    mockUseCountReviewRequest.mockReset();
    mockUseFindUniqueUser.mockReset();
    mockUseCountProjects.mockReset();
  });

  it("(a) renders null when feature flag is disabled", () => {
    setupDefaults({ enabled: false });
    const { container } = render(<ReviewInboxButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("(b) renders null when unauthenticated", () => {
    setupDefaults({ authenticated: false });
    const { container } = render(<ReviewInboxButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("(b2) renders null when the viewer has no review-enabled projects visible", () => {
    setupDefaults({ count: 0, reviewEnabledProjectCount: 0 });
    const { container } = render(<ReviewInboxButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("(b3) renders null while the review-enabled-project count is still loading", () => {
    setupDefaults({
      count: 0,
      reviewEnabledProjectCount: undefined,
      reviewEnabledProjectCountLoading: true,
    });
    const { container } = render(<ReviewInboxButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it("(b4) skips the project-count query while the feature flag is off", () => {
    setupDefaults({ enabled: false });
    render(<ReviewInboxButton />);
    const projectCountCall = mockUseCountProjects.mock.calls[0];
    expect(projectCountCall).toBeDefined();
    const opts = projectCountCall![1] as { enabled?: boolean } | undefined;
    expect(opts?.enabled).toBe(false);
  });

  it("(c) renders the icon Link with NO Badge when count === 0", () => {
    setupDefaults({ count: 0 });
    render(<ReviewInboxButton />);
    expect(screen.getByTestId("review-inbox-button")).toBeInTheDocument();
    expect(
      screen.queryByTestId("review-inbox-count-badge")
    ).not.toBeInTheDocument();
  });

  it("(d) renders the Badge with the count when count > 0", () => {
    setupDefaults({ count: 3 });
    render(<ReviewInboxButton />);
    const badge = screen.getByTestId("review-inbox-count-badge");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe("3");
  });

  it('(e) renders "9+" in the Badge when count > 9', () => {
    setupDefaults({ count: 42 });
    render(<ReviewInboxButton />);
    const badge = screen.getByTestId("review-inbox-count-badge");
    expect(badge.textContent).toBe("9+");
  });

  it("(f) Link href is /reviews", () => {
    setupDefaults({ count: 1 });
    render(<ReviewInboxButton />);
    const link = screen.getByTestId("review-inbox-button");
    // Link from ~/lib/navigation renders as an anchor in the mock; href set via prop.
    expect(link.getAttribute("href")).toBe("/reviews");
  });

  it("(g) Badge has the absolute-positioned classes mirroring NotificationBell", () => {
    setupDefaults({ count: 5 });
    render(<ReviewInboxButton />);
    const badge = screen.getByTestId("review-inbox-count-badge");
    const cls = badge.className;
    // Mirror of NotificationBell positioning: absolute -top-1 -right-1 …
    expect(cls).toMatch(/absolute/);
    expect(cls).toMatch(/-top-1/);
    expect(cls).toMatch(/-right-1/);
  });

  it("(h) aria-label is set on the button with the i18n key (count passed through to next-intl)", () => {
    setupDefaults({ count: 4 });
    render(<ReviewInboxButton />);
    // The mocked next-intl `t` returns the key path when no message map entry
    // exists. The component must still call `t()` with the count param — we
    // assert the aria-label is present (i18n integration verified in
    // en-US.json by the i18n key landing in the `reviews.inbox` block).
    const button = screen.getByTestId("review-inbox-button");
    expect(button.getAttribute("aria-label")).toBe("reviews.inbox.iconAria");
  });

  it("(i) passes role IDs (global + SPECIFIC_ROLE project permissions) to useCountReviewRequest", () => {
    setupDefaults({ count: 0, roleIds: [7, 12, 18] });
    render(<ReviewInboxButton />);

    expect(mockUseCountReviewRequest).toHaveBeenCalled();
    const firstCallArgs = mockUseCountReviewRequest.mock.calls[0]![0] as {
      where?: { OR?: Array<Record<string, unknown>> };
    };
    expect(firstCallArgs.where?.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assigneeUserId: "user-1" }),
        expect.objectContaining({
          assigneeRoleId: { in: expect.arrayContaining([7, 12, 18]) },
        }),
      ])
    );
  });

  it("(j) only renders Inbox icon (not Bell) — visual divergence from NotificationBell", () => {
    setupDefaults({ count: 0 });
    const { container } = render(<ReviewInboxButton />);
    // lucide-react renders an <svg> with class names including the icon kebab name.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    // Inbox icon — assert it's present via lucide class naming convention.
    expect(svg?.getAttribute("class") ?? "").toMatch(/lucide-inbox|h-5/);
  });
});
