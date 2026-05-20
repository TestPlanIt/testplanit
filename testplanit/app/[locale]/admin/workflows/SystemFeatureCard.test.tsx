import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

import { SystemFeatureCard } from "./SystemFeatureCard";

describe("SystemFeatureCard", () => {
  beforeEach(() => {
    mockUseReviewFeatureEnabled.mockReset();
  });

  it("(a) renders 'Enabled' copy when systemEnabled is true", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    const card = screen.getByTestId("system-feature-card");
    expect(card).toBeInTheDocument();

    const state = screen.getByTestId("system-feature-state");
    expect(state).toHaveAttribute("data-state", "enabled");
    expect(state.textContent).toMatch(/enabled/i);
  });

  it("(b) renders 'Disabled' copy when systemEnabled is false", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: false,
      enabled: false,
      isLoading: false,
    });

    render(<SystemFeatureCard />);

    const state = screen.getByTestId("system-feature-state");
    expect(state).toHaveAttribute("data-state", "disabled");
    expect(state.textContent).toMatch(/disabled/i);
  });

  it("(c) operator note referencing the env var is always visible", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    const { container } = render(<SystemFeatureCard />);
    // The operator note is rendered via i18n; we assert that the env-var
    // name appears in the rendered DOM so operators can grep for it.
    expect(container.textContent ?? "").toContain(
      "TESTPLANIT_REVIEW_FEATURE_ENABLED"
    );
  });

  it("(c2) operator note still visible when systemEnabled is false", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: false,
      enabled: false,
      isLoading: false,
    });

    const { container } = render(<SystemFeatureCard />);
    expect(container.textContent ?? "").toContain(
      "TESTPLANIT_REVIEW_FEATURE_ENABLED"
    );
  });

  it("(d) does NOT render any buttons that would mutate the flag", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    const { container } = render(<SystemFeatureCard />);
    // The card is intentionally read-only: env-var-backed per D-19.
    // Reject any <button> in the rendered tree.
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(0);
  });
});
