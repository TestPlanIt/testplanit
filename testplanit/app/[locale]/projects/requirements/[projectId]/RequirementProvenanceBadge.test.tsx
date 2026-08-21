import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

const { mockRouterRefresh } = vi.hoisted(() => ({
  mockRouterRefresh: vi.fn(),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let mockIsProjectAdmin = true;
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: null,
    isProjectAdmin: mockIsProjectAdmin,
    isLoading: false,
  }),
}));

import { RequirementProvenanceBadge } from "./RequirementProvenanceBadge";

const nativeRow = {
  id: 1,
  isRequirement: true,
  integrationId: null,
  requirementDetachedAt: null,
  externalKey: null,
  externalUrl: null,
  issueTypeIconUrl: null,
};

const lockedRow = {
  id: 2,
  isRequirement: true,
  integrationId: 9,
  requirementDetachedAt: null,
  externalKey: "REQ-100",
  externalUrl: "https://jira.example.com/browse/REQ-100",
  issueTypeIconUrl: null,
};

const detachedRow = {
  ...lockedRow,
  id: 3,
  requirementDetachedAt: new Date().toISOString(),
};

/** Opens the Radix DropdownMenu trigger — fireEvent.click alone doesn't
 * dispatch the pointerdown/pointerup sequence Radix listens for in jsdom. */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(trigger, { button: 0, pointerId: 1 });
}

describe("RequirementProvenanceBadge", () => {
  beforeEach(() => {
    mockRouterRefresh.mockReset();
    mockIsProjectAdmin = true;
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
  });

  it("renders no synced badge for a native requirement with no integrationId", () => {
    render(
      <RequirementProvenanceBadge requirement={nativeRow} projectId={7} />
    );
    expect(screen.queryByTestId("requirement-provenance-locked")).toBeNull();
    expect(
      screen.queryByTestId("requirement-provenance-detached")
    ).toBeNull();
    expect(
      screen.queryByTestId("requirement-provenance-lock-icon")
    ).toBeNull();
  });

  it("renders the locked badge for a synced, non-detached requirement", () => {
    render(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );
    const badge = screen.getByTestId("requirement-provenance-locked");
    expect(badge).toBeInTheDocument();
    expect(
      screen.getByTestId("requirement-provenance-lock-icon")
    ).toBeInTheDocument();
    expect(badge).toHaveTextContent("REQ-100");
  });

  it("renders the detached badge, keeping the tracker reference, for a detached requirement", () => {
    render(
      <RequirementProvenanceBadge requirement={detachedRow} projectId={7} />
    );
    const badge = screen.getByTestId("requirement-provenance-detached");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("REQ-100");
    expect(
      screen.queryByTestId("requirement-provenance-lock-icon")
    ).toBeNull();
  });

  it("offers the detach action only to a project admin", () => {
    const { rerender } = render(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );
    openMenu(screen.getByTestId("requirement-provenance-locked"));
    expect(
      screen.getByTestId("requirement-provenance-menu-detach")
    ).toBeInTheDocument();

    mockIsProjectAdmin = false;
    rerender(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );
    expect(
      screen.queryByTestId("requirement-provenance-menu-detach")
    ).toBeNull();
  });

  it("posts to the detach route and never uses a native confirm dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );

    openMenu(screen.getByTestId("requirement-provenance-locked"));
    fireEvent.click(screen.getByTestId("requirement-provenance-menu-detach"));
    expect(
      screen.getByTestId("requirement-provenance-detach-confirm")
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("requirement-provenance-detach-confirm")
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects/7/requirements/2/detach",
        { method: "POST" }
      );
    });
    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalled();
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
