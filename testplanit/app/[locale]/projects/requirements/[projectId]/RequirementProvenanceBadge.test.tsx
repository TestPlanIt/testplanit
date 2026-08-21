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
    expect(screen.queryByTestId("requirement-provenance-detached")).toBeNull();
  });

  it("renders the locked badge for a synced, non-detached requirement", () => {
    render(
      <RequirementProvenanceBadge requirement={lockedRow} projectId={7} />
    );
    const badge = screen.getByTestId("requirement-provenance-locked");
    expect(badge).toBeInTheDocument();
    // PROV-01's lock signal is the badge's own state word, not a separate
    // lock glyph — the glyph was removed because it repeated what the word
    // already said. Assert the two states are actually distinguishable.
    expect(badge).toHaveTextContent("syncedLabel");
    expect(badge).not.toHaveTextContent("detachedLabel");
    // The badge names the tracker rather than repeating the issue key — both
    // surfaces that render it already lead with the shared "KEY: Title"
    // label, so the key was printing twice on one row. This mirrors a synced
    // milestone's badge.
    expect(badge).toHaveTextContent("Jira");
  });

  it("renders the detached badge, keeping the tracker reference, for a detached requirement", () => {
    render(
      <RequirementProvenanceBadge requirement={detachedRow} projectId={7} />
    );
    const badge = screen.getByTestId("requirement-provenance-detached");
    expect(badge).toBeInTheDocument();
    // PROV-02's "keeps a Jira reference badge" after detaching. The proof is
    // the reference still being REACHABLE, not the key being printed inside
    // the badge: the tracker is named, and the link out is rendered. A
    // clickable way back to Jira is a stronger guarantee than a string.
    expect(badge).toHaveTextContent("Jira");
    expect(
      screen.getByTestId("requirement-open-in-tracker")
    ).toBeInTheDocument();
    // The counterpart of the locked assertion above: a detached row reads
    // "Detached", never "Synced".
    expect(badge).toHaveTextContent("detachedLabel");
    expect(badge).not.toHaveTextContent("syncedLabel");
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
