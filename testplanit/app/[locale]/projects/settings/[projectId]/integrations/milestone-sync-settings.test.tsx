import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const { mockUpdatePI, mockUseSession, mockMappingsFindMany } = vi.hoisted(
  () => {
    return {
      mockUpdatePI: vi.fn(),
      mockUseSession: vi.fn(),
      mockMappingsFindMany: vi.fn(),
    };
  }
);

// --- Mocks ---

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projectIntegration: { useUpdate: () => ({ mutateAsync: mockUpdatePI }) },
    integrationProject: {
      useFindMany: (...args: any[]) => mockMappingsFindMany(...args),
    },
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

function getSaveButton() {
  return screen.getByRole("button", { name: "save" });
}

describe("MilestoneSyncSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: { user: { id: "current-user-1" } },
    });
    mockUpdatePI.mockResolvedValue({});
    mockMappingsFindMany.mockReturnValue({
      data: [
        {
          id: "map-1",
          externalProjectId: "10050",
          externalProjectKey: "ABT",
          externalProjectName: "Abstract",
        },
        {
          id: "map-2",
          externalProjectId: "20060",
          externalProjectKey: "ADM",
          externalProjectName: "Admin Tools",
        },
      ],
    });
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

  it("save button starts disabled, and toggling a setting alone does not persist", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({ existingKey: "keep" })}
        integration={jiraIntegration}
      />
    );

    expect(getSaveButton()).toBeDisabled();

    const enableSwitch = screen.getByRole("switch", { name: /enableLabel/i });
    fireEvent.click(enableSwitch);

    expect(getSaveButton()).toBeEnabled();
    // Toggling alone must not reach the server — only Save does.
    expect(mockUpdatePI).not.toHaveBeenCalled();
  });

  it("clicking Save commits the pending enable toggle, merged into config (not on Integration.settings)", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({ existingKey: "keep" })}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: /enableLabel/i }));
    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.where).toEqual({ id: "pi-1" });
    // Existing config keys are preserved (spread-merge, not overwrite).
    expect(call.data.config.existingKey).toBe("keep");
    expect(call.data.config.milestoneSync.enabled).toBe(true);
    // No write anywhere resembling Integration.settings.
    expect(call.data).not.toHaveProperty("settings");

    // Save re-disabling itself is covered by the "re-seeds pending state"
    // test below: like RequirementsConfigSettings, this component has no
    // self-reset — it relies on the parent re-passing a fresh
    // ProjectIntegration after query invalidation, which an isolated unit
    // test simulates via `rerender`, not a bare post-save assertion here.
  });

  it("saving after enabling sync writes autoTrackAdminId = the current user's id", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration()}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: /enableLabel/i }));
    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.data.config.milestoneSync.autoTrackAdminId).toBe(
      "current-user-1"
    );
  });

  it("toggling a kind checkbox stages the updated kinds list, committed only on Save", async () => {
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

    expect(mockUpdatePI).not.toHaveBeenCalled();

    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.data.config.milestoneSync.kinds).toEqual(["RELEASE"]);
  });

  it("toggling autoTrack stages the updated flag, committed only on Save", async () => {
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
    fireEvent.click(getSaveButton());

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

    fireEvent.click(screen.getByRole("switch", { name: /autoTrackLabel/i }));
    fireEvent.click(getSaveButton());

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

    fireEvent.click(screen.getByRole("switch", { name: /autoTrackLabel/i }));
    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.data.config.milestoneSync.autoTrack).toBe(false);
    expect(call.data.config.milestoneSync.autoTrackBaseline).toEqual([
      "kept-1",
    ]);
  });

  it("lists a checkbox per mapped tracker project when auto-track is on, all checked by default", () => {
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

    const abt = screen.getByRole("checkbox", { name: "Abstract" });
    const adm = screen.getByRole("checkbox", { name: "Admin Tools" });
    expect(abt).toBeChecked();
    expect(adm).toBeChecked();
  });

  it("unchecking a project stages it into autoTrackExcludedExternalProjectIds and clears the baseline, committed only on Save", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({
          milestoneSync: {
            enabled: true,
            kinds: ["RELEASE"],
            autoTrack: true,
            autoTrackAdminId: "admin-1",
            autoTrackBaseline: ["stale-1"],
          },
        })}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Admin Tools" }));
    expect(mockUpdatePI).not.toHaveBeenCalled();

    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(
      call.data.config.milestoneSync.autoTrackExcludedExternalProjectIds
    ).toEqual(["20060"]);
    // Scope change re-baselines.
    expect(call.data.config.milestoneSync).not.toHaveProperty(
      "autoTrackBaseline"
    );
  });

  it("re-checking an excluded project removes it from the exclusions and clears the baseline, committed only on Save", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({
          milestoneSync: {
            enabled: true,
            kinds: ["RELEASE"],
            autoTrack: true,
            autoTrackAdminId: "admin-1",
            autoTrackBaseline: ["stale-1"],
            autoTrackExcludedExternalProjectIds: ["20060"],
          },
        })}
        integration={jiraIntegration}
      />
    );

    const adm = screen.getByRole("checkbox", { name: "Admin Tools" });
    expect(adm).not.toBeChecked();
    fireEvent.click(adm);
    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(
      call.data.config.milestoneSync.autoTrackExcludedExternalProjectIds
    ).toEqual([]);
    // Re-including a project MUST re-baseline — its pre-existing artifacts
    // were never baselined while excluded and would otherwise backfill.
    expect(call.data.config.milestoneSync).not.toHaveProperty(
      "autoTrackBaseline"
    );
  });

  it("changing a kind clears the baseline (scope change) while updating kinds, committed only on Save", async () => {
    render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({
          milestoneSync: {
            enabled: true,
            kinds: ["RELEASE"],
            autoTrack: true,
            autoTrackAdminId: "admin-1",
            autoTrackBaseline: ["stale-1"],
          },
        })}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /sprintsLabel/i }));
    fireEvent.click(getSaveButton());

    await waitFor(() => expect(mockUpdatePI).toHaveBeenCalled());

    const call = mockUpdatePI.mock.calls[0][0];
    expect(call.data.config.milestoneSync.kinds).toEqual([
      "RELEASE",
      "ITERATION",
    ]);
    expect(call.data.config.milestoneSync).not.toHaveProperty(
      "autoTrackBaseline"
    );
  });

  it("re-seeds pending state (and re-disables Save) when the saved config changes underneath it", () => {
    const { rerender } = render(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({
          milestoneSync: {
            enabled: false,
            kinds: ["RELEASE"],
            autoTrack: true,
          },
        })}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: /enableLabel/i }));
    expect(getSaveButton()).toBeEnabled();

    // Simulate a successful save re-reading ProjectIntegration with the
    // enabled flag now persisted.
    rerender(
      <MilestoneSyncSettings
        projectIntegration={makeProjectIntegration({
          milestoneSync: { enabled: true, kinds: ["RELEASE"], autoTrack: true },
        })}
        integration={jiraIntegration}
      />
    );

    expect(getSaveButton()).toBeDisabled();
  });
});
