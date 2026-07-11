import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const {
  mockFindFirstProjects,
  mockFindManyProjectIntegration,
  mockFindManyIntegration,
} = vi.hoisted(() => {
  return {
    mockFindFirstProjects: vi.fn(),
    mockFindManyProjectIntegration: vi.fn(),
    mockFindManyIntegration: vi.fn(),
  };
});

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useFindFirst: (...args: any[]) => mockFindFirstProjects(...args),
    },
    projectIntegration: {
      useFindMany: (...args: any[]) => mockFindManyProjectIntegration(...args),
      useUpdate: () => ({ mutateAsync: vi.fn() }),
    },
    integrationProject: {
      useFindMany: () => ({ data: [] }),
    },
    integration: {
      useFindMany: (...args: any[]) => mockFindManyIntegration(...args),
    },
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "42" }),
  notFound: vi.fn(),
}));

vi.mock("~/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { user: { id: "user-1", access: "ADMIN" } },
    isLoading: false,
    isAuthenticated: true,
  }),
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

vi.mock("@/components/admin/integrations/integrations-list", () => ({
  IntegrationsList: () => <div data-testid="integrations-list-stub" />,
}));

vi.mock("./project-integration-settings", () => ({
  ProjectIntegrationSettings: ({ integration }: any) => (
    <div data-testid="project-integration-settings-stub">
      {integration.provider}
    </div>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

import ProjectIntegrationsPage from "./page";

const jiraIntegration = {
  id: 1,
  provider: "JIRA",
  name: "Jira",
};

const githubIntegration = {
  id: 2,
  provider: "GITHUB",
  name: "GitHub",
};

function makeProjectIntegration(integration: any) {
  return {
    id: "pi-1",
    projectId: 42,
    integrationId: integration.id,
    isActive: true,
    config: null,
    integration,
  };
}

describe("ProjectIntegrationsPage — milestone sync mount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirstProjects.mockReturnValue({
      data: {
        id: 42,
        name: "Demo Project",
        iconUrl: null,
        assignedUsers: [],
      },
      isLoading: false,
    });
    mockFindManyIntegration.mockReturnValue({ data: [], isLoading: false });
  });

  it("mounts MilestoneSyncSettings alongside ProjectIntegrationSettings for a Jira project integration", () => {
    mockFindManyProjectIntegration.mockReturnValue({
      data: [makeProjectIntegration(jiraIntegration)],
      isLoading: false,
    });

    render(<ProjectIntegrationsPage />);

    expect(
      screen.getByTestId("project-integration-settings-stub")
    ).toHaveTextContent("JIRA");
    // MilestoneSyncSettings renders its title Card for a milestones-capable
    // (JIRA) integration — proving it is actually mounted, not just
    // imported.
    expect(screen.getByText("milestoneSync.title")).toBeInTheDocument();
  });

  it("does not render milestone sync content for a non-capable provider (GitHub)", () => {
    mockFindManyProjectIntegration.mockReturnValue({
      data: [makeProjectIntegration(githubIntegration)],
      isLoading: false,
    });

    render(<ProjectIntegrationsPage />);

    expect(
      screen.getByTestId("project-integration-settings-stub")
    ).toHaveTextContent("GITHUB");
    expect(screen.queryByText("milestoneSync.title")).not.toBeInTheDocument();
  });
});
