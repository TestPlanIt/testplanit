import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const { mockUpdatePI, mockUseSession } = vi.hoisted(() => {
  return {
    mockUpdatePI: vi.fn(),
    mockUseSession: vi.fn(),
  };
});

// --- Mocks ---

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projectIntegration: { useUpdate: () => ({ mutateAsync: mockUpdatePI }) },
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: any) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}));

import { MilestoneSyncSettings } from "./milestone-sync-settings";

const jiraIntegration = {
  id: 1,
  provider: "JIRA",
  name: "Jira",
} as any;

const githubIntegration = {
  id: 2,
  provider: "GITHUB",
  name: "GitHub",
} as any;

function makeProjectIntegration(config: Record<string, any> | null = null) {
  return {
    id: "pi-1",
    projectId: 100,
    integrationId: 1,
    config,
  } as any;
}

describe("MilestoneSyncSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: { user: { id: "current-user-1" } },
    });
    mockUpdatePI.mockResolvedValue({});
  });

  it("renders for a milestones-capable integration (JIRA)", () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration()}
        integration={jiraIntegration}
      />
    );
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  it("hides for a non-milestones-capable integration (GITHUB)", () => {
    const { container } = render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration()}
        integration={githubIntegration}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("toggling enable calls useUpdate with milestoneSync merged into config (not on Integration.settings)", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({ existingKey: "keep" })}
        integration={jiraIntegration}
      />
    );

    const enableSwitch = screen.getByRole("switch", { name: /enableLabel/i });
    fireEvent.click(enableSwitch);

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.where).toEqual({ id: "pi-1" });
    // Existing config keys are preserved (spread-merge, not overwrite).
    expect(call.data.config.existingKey).toBe("keep");
    expect(call.data.config.milestoneSync.enabled).toBe(true);
    // No write anywhere resembling Integration.settings.
    expect(call.data).not.toHaveProperty("settings");
  });

  it("enabling sync writes autoTrackAdminId = the current user's id", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration()}
        integration={jiraIntegration}
      />
    );

    const enableSwitch = screen.getByRole("switch", { name: /enableLabel/i });
    fireEvent.click(enableSwitch);

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.data.config.milestoneSync.autoTrackAdminId).toBe(
      "current-user-1"
    );
  });

  it("toggling a kind checkbox calls useUpdate with the updated kinds list", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({
          milestoneSync: {
            enabled: true,
            kinds: ["RELEASE", "ITERATION"],
            autoTrack: true,
            autoTrackAdminId: "admin-1",
          },
        })}
        integration={jiraIntegration}
      />
    );

    const sprintsCheckbox = screen.getByRole("checkbox", {
      name: /sprintsLabel/i,
    });
    fireEvent.click(sprintsCheckbox);

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.data.config.milestoneSync.kinds).toEqual(["RELEASE"]);
  });

  it("toggling autoTrack calls useUpdate with the updated autoTrack flag", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({
          milestoneSync: {
            enabled: true,
            kinds: ["RELEASE"],
            autoTrack: true,
            autoTrackAdminId: "admin-1",
          },
        })}
        integration={jiraIntegration}
      />
    );

    const autoTrackSwitch = screen.getByRole("switch", {
      name: /autoTrackLabel/i,
    });
    fireEvent.click(autoTrackSwitch);

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.data.config.milestoneSync.autoTrack).toBe(false);
  });

  it("turning autoTrack ON clears the persisted baseline so the worker re-baselines from that moment", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({
          milestoneSync: {
            enabled: true,
            kinds: ["RELEASE"],
            autoTrack: false,
            autoTrackAdminId: "admin-1",
            autoTrackBaseline: ["stale-1", "stale-2"],
          },
        })}
        integration={jiraIntegration}
      />
    );

    const autoTrackSwitch = screen.getByRole("switch", {
      name: /autoTrackLabel/i,
    });
    fireEvent.click(autoTrackSwitch);

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.data.config.milestoneSync.autoTrack).toBe(true);
    // "Newly created" means "since auto-track (re-)enabled" — a stale
    // baseline from a previous enablement must not survive the ON flip.
    expect(call.data.config.milestoneSync).not.toHaveProperty(
      "autoTrackBaseline"
    );
  });

  it("turning autoTrack OFF preserves the stored baseline (only the ON transition re-baselines)", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({
          milestoneSync: {
            enabled: true,
            kinds: ["RELEASE"],
            autoTrack: true,
            autoTrackAdminId: "admin-1",
            autoTrackBaseline: ["kept-1"],
          },
        })}
        integration={jiraIntegration}
      />
    );

    const autoTrackSwitch = screen.getByRole("switch", {
      name: /autoTrackLabel/i,
    });
    fireEvent.click(autoTrackSwitch);

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.data.config.milestoneSync.autoTrack).toBe(false);
    expect(call.data.config.milestoneSync.autoTrackBaseline).toEqual([
      "kept-1",
    ]);
  });
});
