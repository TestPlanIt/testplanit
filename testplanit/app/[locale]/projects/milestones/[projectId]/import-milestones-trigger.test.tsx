import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
}

// --- Stable mock refs via vi.hoisted() ---
const {
  mockFindManyMilestones,
  mockFindFirstProjects,
  mockFindManyIntegrationProject,
  mockFindManyProjectIntegration,
  mockFetch,
} = vi.hoisted(() => {
  return {
    mockFindManyMilestones: vi.fn(),
    mockFindFirstProjects: vi.fn(),
    mockFindManyIntegrationProject: vi.fn(),
    mockFindManyProjectIntegration: vi.fn(),
    mockFetch: vi.fn(),
  };
});

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useFindFirst: (...args: any[]) => mockFindFirstProjects(...args),
    },
    milestones: {
      useFindMany: (...args: any[]) => mockFindManyMilestones(...args),
    },
    integrationProject: {
      useFindMany: (...args: any[]) => mockFindManyIntegrationProject(...args),
    },
    projectIntegration: {
      useFindMany: (...args: any[]) => mockFindManyProjectIntegration(...args),
    },
  }),
}));

vi.stubGlobal("fetch", mockFetch);

let canAddEdit = true;
let isProjectAdmin = true;

vi.mock("~/hooks/useRequireAuth", () => ({
  useRequireAuth: () => ({
    session: { user: { id: "user-1", access: "ADMIN" } },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: { canAddEdit },
    isProjectAdmin,
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

vi.mock("@/projects/milestones/[projectId]/ImportMilestonesDialog", () => ({
  ImportMilestonesDialog: ({ open, onOpenChange }: any) =>
    open ? (
      <div data-testid="import-milestones-dialog">
        <button onClick={() => onOpenChange(false)}>close</button>
      </div>
    ) : null,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: any) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, "data-testid": testId }: any) => (
    <button data-testid={testId} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <div>{children}</div>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

import ProjectMilestones from "./page";

describe("Milestones page — Import from Jira trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canAddEdit = true;
    isProjectAdmin = true;
    mockFindFirstProjects.mockReturnValue({
      data: { id: 42, name: "Demo Project", iconUrl: null },
      isLoading: false,
    });
    mockFindManyMilestones.mockReturnValue({ data: [] });
    mockFindManyIntegrationProject.mockReturnValue({ data: [] });
    mockFindManyProjectIntegration.mockReturnValue({ data: [] });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it("renders the Import from Jira button for an enabled Jira integration + admin, and opens the dialog on click", async () => {
    mockFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          id: "pi-1",
          integrationId: 9,
          config: { milestoneSync: { enabled: true } },
        },
      ],
    });
    mockFindManyIntegrationProject.mockImplementation((query: any) => {
      if (query?.where?.projectIntegrationId === "pi-1") {
        return { data: [{ id: "mapping-9" }] };
      }
      return { data: [] };
    });

    await act(async () => {
      renderWithQueryClient(
        <ProjectMilestones params={Promise.resolve({ projectId: "42" })} />
      );
    });

    const button = await screen.findByTestId("import-milestones-button");
    expect(button).toBeInTheDocument();

    expect(
      screen.queryByTestId("import-milestones-dialog")
    ).not.toBeInTheDocument();

    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByTestId("import-milestones-dialog")).toBeInTheDocument()
    );
  });

  it("does not render the button when milestoneSync is not enabled", async () => {
    mockFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          id: "pi-1",
          integrationId: 9,
          config: { milestoneSync: { enabled: false } },
        },
      ],
    });

    await act(async () => {
      renderWithQueryClient(
        <ProjectMilestones params={Promise.resolve({ projectId: "42" })} />
      );
    });

    await waitFor(() =>
      expect(mockFindManyProjectIntegration).toHaveBeenCalled()
    );
    expect(
      screen.queryByTestId("import-milestones-button")
    ).not.toBeInTheDocument();
  });

  it("does not render the button when there is no milestone-capable active integration", async () => {
    mockFindManyProjectIntegration.mockReturnValue({ data: [] });

    await act(async () => {
      renderWithQueryClient(
        <ProjectMilestones params={Promise.resolve({ projectId: "42" })} />
      );
    });

    await waitFor(() =>
      expect(mockFindManyProjectIntegration).toHaveBeenCalled()
    );
    expect(
      screen.queryByTestId("import-milestones-button")
    ).not.toBeInTheDocument();
  });

  it("does not render the button when the user lacks canAddEdit permission", async () => {
    canAddEdit = false;
    mockFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          id: "pi-1",
          integrationId: 9,
          config: { milestoneSync: { enabled: true } },
        },
      ],
    });
    mockFindManyIntegrationProject.mockReturnValue({
      data: [{ id: "mapping-9" }],
    });

    await act(async () => {
      renderWithQueryClient(
        <ProjectMilestones params={Promise.resolve({ projectId: "42" })} />
      );
    });

    await waitFor(() =>
      expect(mockFindManyProjectIntegration).toHaveBeenCalled()
    );
    expect(
      screen.queryByTestId("import-milestones-button")
    ).not.toBeInTheDocument();
    // New Milestone button should also be gone since it shares canAddEdit gating.
    expect(
      screen.queryByTestId("new-milestone-button")
    ).not.toBeInTheDocument();
  });

  it("does not render the Import button for a non-project-admin who has canAddEdit (New Milestone stays visible)", async () => {
    isProjectAdmin = false;
    mockFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          id: "pi-1",
          integrationId: 9,
          config: { milestoneSync: { enabled: true } },
        },
      ],
    });
    mockFindManyIntegrationProject.mockReturnValue({
      data: [{ id: "mapping-9" }],
    });

    await act(async () => {
      renderWithQueryClient(
        <ProjectMilestones params={Promise.resolve({ projectId: "42" })} />
      );
    });

    await waitFor(() =>
      expect(mockFindManyProjectIntegration).toHaveBeenCalled()
    );
    expect(
      screen.queryByTestId("import-milestones-button")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("new-milestone-button")).toBeInTheDocument();
  });

  it("renders the Import button for a project admin even without exercising canAddEdit separately", async () => {
    isProjectAdmin = true;
    mockFindManyProjectIntegration.mockReturnValue({
      data: [
        {
          id: "pi-1",
          integrationId: 9,
          config: { milestoneSync: { enabled: true } },
        },
      ],
    });
    mockFindManyIntegrationProject.mockReturnValue({
      data: [{ id: "mapping-9" }],
    });

    await act(async () => {
      renderWithQueryClient(
        <ProjectMilestones params={Promise.resolve({ projectId: "42" })} />
      );
    });

    expect(
      await screen.findByTestId("import-milestones-button")
    ).toBeInTheDocument();
  });
});
