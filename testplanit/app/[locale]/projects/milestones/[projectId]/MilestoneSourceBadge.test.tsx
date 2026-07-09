import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

const { mockFindFirstMilestones, mockRouterRefresh } = vi.hoisted(() => ({
  mockFindFirstMilestones: vi.fn(
    (..._args: any[]) => ({ data: undefined }) as any
  ),
  mockRouterRefresh: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    milestones: {
      useFindFirst: (...args: any[]) => mockFindFirstMilestones(...args),
    },
  }),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { MilestoneSourceBadge } from "./MilestoneSourceBadge";

const synced = {
  id: 42,
  integrationId: 9,
  externalKind: "ITERATION",
  externalState: "active",
  externalUrl:
    "https://jira.example.com/secure/RapidBoard.jspa?rapidView=39&sprint=4053",
  detachedAt: null,
  mergedToExternalId: null,
};

/** Opens the Radix DropdownMenu trigger — fireEvent.click alone doesn't
 * dispatch the pointerdown/pointerup sequence Radix listens for in jsdom. */
function openMenu(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, pointerId: 1 });
  fireEvent.pointerUp(trigger, { button: 0, pointerId: 1 });
}

describe("MilestoneSourceBadge", () => {
  beforeEach(() => {
    mockFindFirstMilestones.mockReset();
    mockFindFirstMilestones.mockReturnValue({ data: undefined });
    mockRouterRefresh.mockReset();
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as any;
  });

  it("renders nothing for local milestones", () => {
    render(
      <MilestoneSourceBadge milestone={{ ...synced, integrationId: null }} />
    );
    expect(screen.queryByTestId("milestone-source-badge")).toBeNull();
  });

  it("renders nothing when manually unlinked (externalState manual_unlink), even though detachedAt is set", () => {
    render(
      <MilestoneSourceBadge
        milestone={{
          ...synced,
          externalState: "manual_unlink",
          detachedAt: new Date().toISOString(),
        }}
      />
    );
    expect(screen.queryByTestId("milestone-source-badge")).toBeNull();
  });

  it("renders the permanent removed badge when externalState is deleted (distinct from manual_unlink)", () => {
    render(
      <MilestoneSourceBadge
        milestone={{
          ...synced,
          externalState: "deleted",
          detachedAt: new Date().toISOString(),
        }}
      />
    );
    const badge = screen.getByTestId("milestone-source-badge");
    expect(badge).toBeInTheDocument();
    expect(screen.queryByTestId("milestone-source-menu-unlink")).toBeNull();
  });

  it("renders the permanent merged badge when externalState is merged", () => {
    render(
      <MilestoneSourceBadge
        milestone={{
          ...synced,
          externalState: "merged",
          detachedAt: new Date().toISOString(),
          mergedToExternalId: "10099",
        }}
      />
    );
    const badge = screen.getByTestId("milestone-source-badge");
    expect(badge).toBeInTheDocument();
    expect(screen.queryByTestId("milestone-source-menu-unlink")).toBeNull();
  });

  it("shows a two-item dropdown menu (Open/Unlink) when actively synced", () => {
    render(<MilestoneSourceBadge milestone={synced} />);

    openMenu(screen.getByTestId("milestone-source-badge"));

    expect(
      screen.getByTestId("milestone-source-menu-open")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("milestone-source-menu-unlink")
    ).toBeInTheDocument();
    expect(screen.getByTestId("milestone-open-in-tracker")).toBeInTheDocument();
  });

  it("Open in Jira menu item opens the tracker without an opener when the URL is safe", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<MilestoneSourceBadge milestone={synced} />);

    openMenu(screen.getByTestId("milestone-source-badge"));
    fireEvent.click(screen.getByTestId("milestone-source-menu-open"));

    expect(openSpy).toHaveBeenCalledWith(
      synced.externalUrl,
      "_blank",
      "noopener,noreferrer"
    );
    openSpy.mockRestore();
  });

  it("disables the Open menu item for unsafe or missing URLs", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <MilestoneSourceBadge
        milestone={{ ...synced, externalUrl: "javascript:alert(1)" }}
      />
    );
    openMenu(screen.getByTestId("milestone-source-badge"));

    const openItem = screen.getByTestId("milestone-source-menu-open");
    expect(openItem).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByTestId("milestone-open-in-tracker")).toBeNull();
    fireEvent.click(openItem);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("Unlink from Jira opens a confirmation dialog listing consequences, then POSTs the unlink route on confirm", async () => {
    render(<MilestoneSourceBadge milestone={synced} />);

    openMenu(screen.getByTestId("milestone-source-badge"));
    fireEvent.click(screen.getByTestId("milestone-source-menu-unlink"));
    expect(
      screen.getByTestId("milestone-source-unlink-confirm")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("milestone-source-unlink-confirm"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/milestones/42/unlink",
        expect.objectContaining({ method: "POST" })
      );
    });
    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalled();
    });
  });

  it("cancelling the unlink confirmation does not call the unlink route", () => {
    render(<MilestoneSourceBadge milestone={synced} />);

    openMenu(screen.getByTestId("milestone-source-badge"));
    fireEvent.click(screen.getByTestId("milestone-source-menu-unlink"));
    fireEvent.click(screen.getByTestId("milestone-source-unlink-cancel"));

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
