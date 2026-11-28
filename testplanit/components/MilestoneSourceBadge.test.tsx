import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

const { mockFindFirstMilestones, mockRouterRefresh, mockRouterPush } =
  vi.hoisted(() => ({
    mockFindFirstMilestones: vi.fn(
      (..._args: any[]) => ({ data: undefined }) as any
    ),
    mockRouterRefresh: vi.fn(),
    mockRouterPush: vi.fn(),
  }));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    milestones: {
      useFindFirst: (...args: any[]) => mockFindFirstMilestones(...args),
    },
  }),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: mockRouterPush }),
}));

const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
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

import { toast } from "sonner";
import {
  MilestoneSourceBadge,
  resolveMilestoneProjectSpace,
} from "./MilestoneSourceBadge";

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
    mockRouterPush.mockReset();
    mockInvalidateQueries.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    mockIsProjectAdmin = true;
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

  it("REGRESSION (WR-02): clicking a merged badge with a tracked target navigates ABSOLUTELY to the target's own project detail page via the i18n router", () => {
    // Absolute navigation is required — the badge renders on both the
    // milestones LIST (/projects/milestones/7) and the milestone DETAIL
    // (/projects/milestones/7/42) pages, so a relative `../${id}` resolves
    // to a different (wrong) route on each.
    mockFindFirstMilestones.mockReturnValue({
      data: { id: 100, name: "v2.0", projectId: 7 },
    });
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

    // The merge-target query must select projectId for the absolute path.
    const queryArgs = mockFindFirstMilestones.mock.calls[0]?.[0];
    expect(queryArgs?.select).toEqual(
      expect.objectContaining({ id: true, projectId: true })
    );

    fireEvent.click(screen.getByTestId("milestone-source-badge"));

    expect(mockRouterPush).toHaveBeenCalledWith("/projects/milestones/7/100");
  });

  it("a merged badge whose target is NOT tracked locally is not clickable", () => {
    mockFindFirstMilestones.mockReturnValue({ data: undefined });
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

    fireEvent.click(screen.getByTestId("milestone-source-badge"));

    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("shows a three-item dropdown menu (Open/Sync now/Unlink) when actively synced", () => {
    render(<MilestoneSourceBadge milestone={synced} />);

    openMenu(screen.getByTestId("milestone-source-badge"));

    expect(
      screen.getByTestId("milestone-source-menu-open")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("milestone-source-menu-sync")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("milestone-source-menu-unlink")
    ).toBeInTheDocument();
    expect(screen.getByTestId("milestone-open-in-tracker")).toBeInTheDocument();
  });

  it("names the milestone's own tracker on the Open item and the badge's title", () => {
    render(
      <MilestoneSourceBadge
        milestone={{
          ...synced,
          externalUrl: "https://github.com/orgs/acme/projects/1",
        }}
        integrationProjects={[
          {
            externalProjectKey: "app",
            externalProjectName: "acme/app",
            projectIntegration: {
              integrationId: 9,
              integration: { provider: "GITHUB" },
            },
          },
        ]}
      />
    );

    const badge = screen.getByTestId("milestone-source-badge");
    expect(badge).toHaveAttribute(
      "title",
      "ui.issues.openInExternalSystem:GitHub"
    );
    openMenu(badge);
    expect(screen.getByTestId("milestone-source-menu-open")).toHaveTextContent(
      "ui.issues.openInExternalSystem:GitHub"
    );
  });

  it("Sync now asks the server to read the milestone from the tracker, then refreshes what the page shows", async () => {
    render(<MilestoneSourceBadge milestone={synced} />);

    openMenu(screen.getByTestId("milestone-source-badge"));
    fireEvent.click(screen.getByTestId("milestone-source-menu-sync"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/milestones/42/members/overflow",
        expect.objectContaining({ method: "POST" })
      );
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("sync.syncSuccess:Jira");
    });
    expect(mockRouterRefresh).toHaveBeenCalled();
    const { predicate } = mockInvalidateQueries.mock.calls[0][0];
    expect(
      predicate({ queryKey: ["zenstack", "MilestoneIssue", "findMany"] })
    ).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("Sync now reports the tracker's reason when the sync fails, and refreshes nothing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "GitHub refused access to Projects." }),
    }) as any;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MilestoneSourceBadge milestone={synced} />);

    openMenu(screen.getByTestId("milestone-source-badge"));
    fireEvent.click(screen.getByTestId("milestone-source-menu-sync"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("sync.syncError", {
        description: "GitHub refused access to Projects.",
      });
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(mockRouterRefresh).not.toHaveBeenCalled();
    logged.mockRestore();
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
    const { predicate } = mockInvalidateQueries.mock.calls[0][0];
    expect(
      predicate({ queryKey: ["zenstack", "Milestones", "findFirst"] })
    ).toBe(true);
    expect(predicate({ queryKey: ["zenstack", "Projects", "findMany"] })).toBe(
      false
    );
  });

  it("cancelling the unlink confirmation does not call the unlink route", () => {
    render(<MilestoneSourceBadge milestone={synced} />);

    openMenu(screen.getByTestId("milestone-source-badge"));
    fireEvent.click(screen.getByTestId("milestone-source-menu-unlink"));
    fireEvent.click(screen.getByTestId("milestone-source-unlink-cancel"));

    expect(global.fetch).not.toHaveBeenCalled();
  });

  // The test-runs page groups BY milestone but does not manage them, so it
  // opts out of the unlink affordance: project admins there get the same
  // plain open-in-tracker link everyone else gets.
  describe("showUnlinkAction={false}", () => {
    beforeEach(() => {
      mockIsProjectAdmin = true;
    });

    it("renders no dropdown menu even for a project admin", () => {
      render(
        <MilestoneSourceBadge
          milestone={synced}
          projectId={7}
          showUnlinkAction={false}
        />
      );

      expect(screen.getByTestId("milestone-source-badge")).toBeInTheDocument();
      openMenu(screen.getByTestId("milestone-source-badge"));
      expect(screen.queryByTestId("milestone-source-menu-open")).toBeNull();
      expect(screen.queryByTestId("milestone-source-menu-sync")).toBeNull();
      expect(screen.queryByTestId("milestone-source-menu-unlink")).toBeNull();
    });

    it("clicking the badge opens the tracker directly", () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      render(
        <MilestoneSourceBadge
          milestone={synced}
          projectId={7}
          showUnlinkAction={false}
        />
      );

      fireEvent.click(screen.getByTestId("milestone-source-badge"));

      expect(openSpy).toHaveBeenCalledWith(
        synced.externalUrl,
        "_blank",
        "noopener,noreferrer"
      );
      openSpy.mockRestore();
    });

    it("offers no path to the unlink route", () => {
      render(
        <MilestoneSourceBadge
          milestone={synced}
          projectId={7}
          showUnlinkAction={false}
        />
      );

      fireEvent.click(screen.getByTestId("milestone-source-badge"));

      expect(
        screen.queryByTestId("milestone-source-unlink-confirm")
      ).toBeNull();
      expect(global.fetch).not.toHaveBeenCalledWith(
        "/api/milestones/42/unlink",
        expect.anything()
      );
    });

    // Default-on: the milestones pages must keep their menu untouched.
    it("still shows the menu for a project admin when the prop is omitted", () => {
      render(<MilestoneSourceBadge milestone={synced} projectId={7} />);

      openMenu(screen.getByTestId("milestone-source-badge"));
      expect(
        screen.getByTestId("milestone-source-menu-unlink")
      ).toBeInTheDocument();
    });
  });

  // Pickers render the badge as decoration: a click on a combobox option has
  // to select the milestone, and on the combobox trigger a dropdown would nest
  // a menu inside a button.
  describe("interactive={false}", () => {
    it("renders the badge but no menu, even for a project admin", () => {
      render(
        <MilestoneSourceBadge
          milestone={synced}
          projectId={7}
          interactive={false}
        />
      );

      const badge = screen.getByTestId("milestone-source-badge");
      expect(badge).toBeInTheDocument();
      openMenu(badge);
      expect(screen.queryByTestId("milestone-source-menu-open")).toBeNull();
      expect(screen.queryByTestId("milestone-source-menu-sync")).toBeNull();
      expect(screen.queryByTestId("milestone-source-menu-unlink")).toBeNull();
    });

    it("neither opens the tracker on click nor advertises the link", () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      render(
        <MilestoneSourceBadge
          milestone={synced}
          projectId={7}
          interactive={false}
        />
      );

      expect(screen.queryByTestId("milestone-open-in-tracker")).toBeNull();
      fireEvent.click(screen.getByTestId("milestone-source-badge"));

      expect(openSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });

    it("does not navigate from a merged badge whose target is tracked locally", () => {
      mockFindFirstMilestones.mockReturnValue({
        data: { id: 100, name: "v2.0", projectId: 7 },
      });
      render(
        <MilestoneSourceBadge
          milestone={{
            ...synced,
            externalState: "merged",
            detachedAt: new Date().toISOString(),
            mergedToExternalId: "10099",
          }}
          interactive={false}
        />
      );

      fireEvent.click(screen.getByTestId("milestone-source-badge"));

      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });

  describe("non-project-admin gating", () => {
    beforeEach(() => {
      mockIsProjectAdmin = false;
    });

    it("renders a plain badge with no dropdown menu for a non-project-admin", () => {
      render(<MilestoneSourceBadge milestone={synced} projectId={7} />);

      const badge = screen.getByTestId("milestone-source-badge");
      expect(badge).toBeInTheDocument();
      expect(screen.queryByTestId("milestone-source-menu-open")).toBeNull();
      expect(screen.queryByTestId("milestone-source-menu-sync")).toBeNull();
      expect(screen.queryByTestId("milestone-source-menu-unlink")).toBeNull();
    });

    it("clicking the badge opens the tracker directly (no menu step) for a non-project-admin", () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      render(<MilestoneSourceBadge milestone={synced} projectId={7} />);

      fireEvent.click(screen.getByTestId("milestone-source-badge"));

      expect(openSpy).toHaveBeenCalledWith(
        synced.externalUrl,
        "_blank",
        "noopener,noreferrer"
      );
      openSpy.mockRestore();
    });

    it("a non-project-admin cannot reach the unlink route — no confirm dialog, no fetch", () => {
      render(<MilestoneSourceBadge milestone={synced} projectId={7} />);

      fireEvent.click(screen.getByTestId("milestone-source-badge"));

      expect(
        screen.queryByTestId("milestone-source-unlink-confirm")
      ).toBeNull();
      expect(global.fetch).not.toHaveBeenCalledWith(
        "/api/milestones/42/unlink",
        expect.anything()
      );
    });

    it("does not open the tracker for an unsafe URL even when clicked", () => {
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
      render(
        <MilestoneSourceBadge
          milestone={{ ...synced, externalUrl: "javascript:alert(1)" }}
          projectId={7}
        />
      );

      fireEvent.click(screen.getByTestId("milestone-source-badge"));

      expect(openSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });

  describe("Jira project (space) segment", () => {
    const abt = {
      externalProjectKey: "ABT",
      externalProjectName: "Acme Billing Team",
      projectIntegration: { integrationId: 9 },
    };
    const adm = {
      externalProjectKey: "ADM",
      externalProjectName: "Acme Admin",
      projectIntegration: { integrationId: 9 },
    };

    it("renders the full project name (initial, uncollapsed) when a single mapping resolves", () => {
      render(
        <MilestoneSourceBadge milestone={synced} integrationProjects={[abt]} />
      );
      expect(screen.getByTestId("milestone-source-project")).toHaveTextContent(
        "· Acme Billing Team"
      );
    });

    it("renders no project segment when none is passed (unchanged behavior)", () => {
      render(<MilestoneSourceBadge milestone={synced} />);
      expect(screen.queryByTestId("milestone-source-project")).toBeNull();
    });

    describe("resolveMilestoneProjectSpace", () => {
      it("uses the sole mapping for a sprint (no key in its URL)", () => {
        expect(resolveMilestoneProjectSpace(synced, [abt])).toEqual({
          name: "Acme Billing Team",
          short: "ABT",
        });
      });

      it("picks the mapping whose key is embedded in a version URL", () => {
        const release = {
          ...synced,
          externalKind: "RELEASE",
          externalUrl: "https://jira.example.com/projects/ADM/versions/10099",
        };
        expect(resolveMilestoneProjectSpace(release, [abt, adm])).toEqual({
          name: "Acme Admin",
          short: "ADM",
        });
      });

      it("returns null when multiple mappings are ambiguous (sprint, no URL key)", () => {
        expect(resolveMilestoneProjectSpace(synced, [abt, adm])).toBeNull();
      });

      it("ignores mappings belonging to a different integration", () => {
        const other = { ...abt, projectIntegration: { integrationId: 99 } };
        expect(resolveMilestoneProjectSpace(synced, [other])).toBeNull();
      });

      it("returns null for a local milestone or when no mappings are provided", () => {
        expect(
          resolveMilestoneProjectSpace({ ...synced, integrationId: null }, [
            abt,
          ])
        ).toBeNull();
        expect(resolveMilestoneProjectSpace(synced, undefined)).toBeNull();
      });
    });
  });
});
