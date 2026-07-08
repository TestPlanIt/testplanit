import { act, render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const {
  mockFindManyMilestones,
  mockFindFirstProjects,
  mockFindManyIntegrationProject,
  mockFetch,
} = vi.hoisted(() => {
  return {
    mockFindManyMilestones: vi.fn(),
    mockFindFirstProjects: vi.fn(() => ({
      data: { id: 42, name: "Demo Project", iconUrl: null },
      isLoading: false,
    })),
    mockFindManyIntegrationProject: vi.fn(() => ({ data: [] })),
    mockFetch: vi.fn(),
  };
});

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: { useFindFirst: (...args: any[]) => mockFindFirstProjects(...args) },
    milestones: { useFindMany: (...args: any[]) => mockFindManyMilestones(...args) },
    integrationProject: {
      useFindMany: (...args: any[]) => mockFindManyIntegrationProject(...args),
    },
  }),
}));

vi.stubGlobal("fetch", mockFetch);

vi.mock("~/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { user: { id: "user-1", access: "ADMIN" } },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: { canAddEdit: true },
    isLoading: false,
  }),
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/Loading", () => ({
  Loading: () => <div data-testid="loading" />,
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: () => <div data-testid="project-icon" />,
}));

vi.mock("@/projects/milestones/[projectId]/AddMilestoneModal", () => ({
  AddMilestone: () => <div data-testid="add-milestone-modal" />,
}));

vi.mock("@/projects/milestones/[projectId]/MilestoneDisplay", () => ({
  default: () => <div data-testid="milestone-display" />,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: any) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <div>{children}</div>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

import ProjectMilestones from "./page";

function makeMilestone(overrides: Partial<any> = {}) {
  return {
    id: 1,
    name: "M",
    integrationId: null,
    isCompleted: false,
    ...overrides,
  };
}

describe("Milestones page — passive refresh mount effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirstProjects.mockReturnValue({
      data: { id: 42, name: "Demo Project", iconUrl: null },
      isLoading: false,
    });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("fires one project-level /now?trigger=hover POST per distinct synced integration on mount", async () => {
    mockFindManyMilestones.mockImplementation((query: any) => {
      const isCompletedFilter = query?.where?.AND?.find(
        (c: any) => "isCompleted" in c
      )?.isCompleted;
      if (isCompletedFilter === false) {
        return {
          data: [
            makeMilestone({ id: 1, integrationId: 5 }),
            makeMilestone({ id: 2, integrationId: 5 }), // same integration
          ],
        };
      }
      return { data: [] };
    });
    mockFindManyIntegrationProject.mockReturnValue({
      data: [
        {
          id: "mapping-5",
          projectIntegration: { integrationId: 5 },
        },
      ],
    });

    await act(async () => {
      render(<ProjectMilestones params={Promise.resolve({ projectId: "42" })} />);
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/integrations/5/milestone-sync/now?trigger=hover",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectMappingId: "mapping-5" }),
      })
    );
  });

  it("fires nothing when only local milestones are present", async () => {
    mockFindManyMilestones.mockImplementation((query: any) => {
      const isCompletedFilter = query?.where?.AND?.find(
        (c: any) => "isCompleted" in c
      )?.isCompleted;
      if (isCompletedFilter === false) {
        return { data: [makeMilestone({ id: 1, integrationId: null })] };
      }
      return { data: [] };
    });

    await act(async () => {
      render(<ProjectMilestones params={Promise.resolve({ projectId: "42" })} />);
    });

    // Give effects a tick to (not) fire.
    await waitFor(() => expect(mockFindManyMilestones).toHaveBeenCalled());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("two synced milestones on the same integration produce exactly one call", async () => {
    mockFindManyMilestones.mockImplementation((query: any) => {
      const isCompletedFilter = query?.where?.AND?.find(
        (c: any) => "isCompleted" in c
      )?.isCompleted;
      if (isCompletedFilter === false) {
        return {
          data: [
            makeMilestone({ id: 1, integrationId: 7 }),
            makeMilestone({ id: 2, integrationId: 7 }),
          ],
        };
      }
      return { data: [] };
    });
    mockFindManyIntegrationProject.mockReturnValue({
      data: [{ id: "mapping-7", projectIntegration: { integrationId: 7 } }],
    });

    await act(async () => {
      render(<ProjectMilestones params={Promise.resolve({ projectId: "42" })} />);
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/integrations/7/milestone-sync/now?trigger=hover",
      expect.objectContaining({
        body: JSON.stringify({ projectMappingId: "mapping-7" }),
      })
    );
  });
});
