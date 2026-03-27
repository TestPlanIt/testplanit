import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ExtendedProjects, getColumns } from "./columns";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock navigation (Link used by ProjectNameCell etc.)
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock ProjectIcon
vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: () => <span data-testid="project-icon" />,
}));

// Mock ProjectNameCell
vi.mock("@/components/tables/ProjectNameCell", () => ({
  ProjectNameCell: ({ projectId }: { projectId: number }) => (
    <span data-testid={`project-name-cell-${projectId}`}>{projectId}</span>
  ),
}));

// Mock UserListDisplay
vi.mock("@/components/tables/UserListDisplay", () => ({
  UserListDisplay: ({ users }: { users: { userId: string }[] }) => (
    <span data-testid="user-list-display">{users.length} users</span>
  ),
}));

// Mock GroupListDisplay
vi.mock("@/components/tables/GroupListDisplay", () => ({
  GroupListDisplay: ({ groups }: { groups: { groupId: number }[] }) => (
    <span data-testid="group-list-display">{groups.length} groups</span>
  ),
}));

// Mock MilestoneListDisplay
vi.mock("@/components/tables/MilestoneListDisplay", () => ({
  MilestoneListDisplay: () => <span data-testid="milestone-list-display" />,
  MilestonesWithTypes: {},
}));

// Mock MilestoneTypeListDisplay
vi.mock("@/components/tables/MilestoneTypeListDisplay", () => ({
  MilestoneTypeListDisplay: () => (
    <span data-testid="milestone-type-list-display" />
  ),
}));

// Mock UserNameCell
vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid={`user-name-cell-${userId}`}>{userId}</span>
  ),
}));

// Mock DateFormatter
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: () => <span data-testid="date-formatter" />,
}));

// Mock Switch
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked }: { checked: boolean }) => (
    <input type="checkbox" data-testid="switch" defaultChecked={checked} />
  ),
}));

// Mock LlmProviderBadge
vi.mock("~/lib/llm/provider-styles", () => ({
  LlmProviderBadge: ({
    provider,
    name,
  }: {
    provider: string;
    name?: string;
    showIcon?: boolean;
  }) => <span data-testid={`llm-badge-${provider}`}>{name ?? provider}</span>,
}));

// Mock DeleteProjectModal
vi.mock("./DeleteProject", () => ({
  DeleteProjectModal: ({ project }: { project: any }) => (
    <button data-testid={`delete-project-${project.id}`}>Delete</button>
  ),
}));

const mockTranslations = ((key: string) => key) as ReturnType<
  typeof import("next-intl").useTranslations<"common">
>;
const mockUserPreferences = {
  user: { preferences: { dateFormat: "MM_DD_YYYY_DASH", timezone: "Etc/UTC" } },
};
const mockToggleCompleted = vi.fn();
const mockOpenEditModal = vi.fn();

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function renderCell(
  columns: ReturnType<typeof getColumns>,
  columnId: string,
  row: ExtendedProjects
) {
  const column = columns.find((c) => c.id === columnId);
  if (!column || !column.cell) {
    throw new Error(`Column "${columnId}" not found or has no cell renderer`);
  }

  const cellFn = column.cell as (info: any) => React.ReactNode;
  const queryClient = makeQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      {cellFn({
        row: { original: row },
        getValue: () =>
          row[(column as any).accessorKey as keyof ExtendedProjects],
      })}
    </QueryClientProvider>
  );
}

const testProject: ExtendedProjects = {
  id: 1,
  name: "Test Project",
  note: null,
  iconUrl: null,
  isDeleted: false,
  isCompleted: false,
  completedAt: null,
  createdAt: new Date(),
  createdBy: "user-1",
  defaultRoleId: null,
  defaultAccessType: "DEFAULT",
  docs: null,
  promptConfigId: null,
  defaultCaseExportTemplateId: null,
  quickScriptEnabled: false,
  creator: {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
  } as any,
  assignedUsers: [
    { userId: "user-1", projectId: 1 },
    { userId: "user-2", projectId: 1 },
  ],
  groupPermissions: [{ groupId: 10 }, { groupId: 20 }],
  codeRepositoryConfig: { id: 1, repository: { name: "my-github-repo" } },
  projectLlmIntegrations: [
    { isActive: true, llmIntegration: { name: "GPT-4o", provider: "OPENAI" } },
  ],
  milestones: [],
  milestoneTypes: [],
  projectIntegrations: [],
  effectiveUserIds: ["user-1", "user-2"],
};

const projectWithNoGroups: ExtendedProjects = {
  ...testProject,
  id: 2,
  name: "No Groups Project",
  groupPermissions: [],
};

const projectWithNoIntegrations: ExtendedProjects = {
  ...testProject,
  id: 3,
  name: "No Integrations Project",
  codeRepositoryConfig: null,
  projectLlmIntegrations: [],
};

describe("Projects columns", () => {
  const columns = getColumns(
    mockUserPreferences,
    mockToggleCompleted,
    mockOpenEditModal,
    mockTranslations
  );

  describe("column definitions", () => {
    test("includes groups column", () => {
      const columnIds = columns.map((c) => c.id);
      expect(columnIds).toContain("groups");
    });

    test("groups column appears after users and before milestoneTypes", () => {
      const columnIds = columns.map((c) => c.id);
      const usersIndex = columnIds.indexOf("users");
      const groupsIndex = columnIds.indexOf("groups");
      const milestoneTypesIndex = columnIds.indexOf("milestoneTypes");

      expect(groupsIndex).toBe(usersIndex + 1);
      expect(groupsIndex).toBe(milestoneTypesIndex - 1);
    });

    test("groups column is not sortable", () => {
      const groupsCol = columns.find((c) => c.id === "groups")!;
      expect(groupsCol.enableSorting).toBe(false);
    });

    test("name column is pinned left and not hideable", () => {
      const nameCol = columns.find((c) => c.id === "name")!;
      expect(nameCol.enableHiding).toBe(false);
      expect((nameCol.meta as any)?.isPinned).toBe("left");
    });

    test("actions column is pinned right and not hideable", () => {
      const actionsCol = columns.find((c) => c.id === "actions")!;
      expect(actionsCol.enableHiding).toBe(false);
      expect((actionsCol.meta as any)?.isPinned).toBe("right");
    });
  });

  describe("groups column cell", () => {
    test("renders GroupListDisplay with group permissions", () => {
      renderCell(columns, "groups", testProject);

      const display = screen.getByTestId("group-list-display");
      expect(display).toBeInTheDocument();
      expect(display).toHaveTextContent("2 groups");
    });

    test("renders GroupListDisplay with empty permissions", () => {
      renderCell(columns, "groups", projectWithNoGroups);

      const display = screen.getByTestId("group-list-display");
      expect(display).toBeInTheDocument();
      expect(display).toHaveTextContent("0 groups");
    });
  });

  describe("column definitions - new indicator columns", () => {
    test("includes codeRepository and aiModels columns", () => {
      const columnIds = columns.map((c) => c.id);
      expect(columnIds).toContain("codeRepository");
      expect(columnIds).toContain("aiModels");
    });

    test("codeRepository and aiModels columns are not sortable", () => {
      const codeRepoCol = columns.find((c) => c.id === "codeRepository")!;
      const aiModelsCol = columns.find((c) => c.id === "aiModels")!;
      expect(codeRepoCol.enableSorting).toBe(false);
      expect(aiModelsCol.enableSorting).toBe(false);
    });
  });

  describe("codeRepository column cell", () => {
    test("renders active indicator with repo name when configured", () => {
      renderCell(columns, "codeRepository", testProject);

      const indicator = screen.getByTestId("code-repo-indicator");
      expect(indicator).toHaveAttribute("data-active", "true");
      expect(screen.getByText("my-github-repo")).toBeInTheDocument();
    });

    test("renders inactive indicator with N/A when no repo configured", () => {
      renderCell(columns, "codeRepository", projectWithNoIntegrations);

      const indicator = screen.getByTestId("code-repo-indicator");
      expect(indicator).toHaveAttribute("data-active", "false");
      expect(screen.getByText("status.notApplicable")).toBeInTheDocument();
    });
  });

  describe("aiModels column cell", () => {
    test("renders active indicator when LLM integration is active", () => {
      renderCell(columns, "aiModels", testProject);

      const indicator = screen.getByTestId("ai-model-indicator");
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveAttribute("data-active", "true");
    });

    test("renders inactive indicator when no LLM integrations exist", () => {
      renderCell(columns, "aiModels", projectWithNoIntegrations);

      const indicator = screen.getByTestId("ai-model-indicator");
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveAttribute("data-active", "false");
    });

    test("renders inactive indicator when LLM integrations exist but none active", () => {
      const projectInactiveLlm: ExtendedProjects = {
        ...testProject,
        projectLlmIntegrations: [
          {
            isActive: false,
            llmIntegration: { name: "Claude", provider: "ANTHROPIC" },
          },
        ],
      };
      renderCell(columns, "aiModels", projectInactiveLlm);

      const indicator = screen.getByTestId("ai-model-indicator");
      expect(indicator).toHaveAttribute("data-active", "false");
    });

    test("renders provider badge when active", () => {
      renderCell(columns, "aiModels", testProject);

      expect(screen.getByTestId("llm-badge-OPENAI")).toHaveTextContent(
        "GPT-4o"
      );
    });

    test("renders multiple provider badges for active models only", () => {
      const projectMultiLlm: ExtendedProjects = {
        ...testProject,
        projectLlmIntegrations: [
          {
            isActive: true,
            llmIntegration: { name: "GPT-4o", provider: "OPENAI" },
          },
          {
            isActive: true,
            llmIntegration: { name: "Claude", provider: "ANTHROPIC" },
          },
          {
            isActive: false,
            llmIntegration: { name: "Inactive Model", provider: "OLLAMA" },
          },
        ],
      };
      renderCell(columns, "aiModels", projectMultiLlm);

      expect(screen.getByTestId("llm-badge-OPENAI")).toHaveTextContent(
        "GPT-4o"
      );
      expect(screen.getByTestId("llm-badge-ANTHROPIC")).toHaveTextContent(
        "Claude"
      );
      expect(screen.queryByTestId("llm-badge-OLLAMA")).not.toBeInTheDocument();
    });

    test("shows N/A when no AI model configured", () => {
      renderCell(columns, "aiModels", projectWithNoIntegrations);

      expect(screen.getByText("status.notApplicable")).toBeInTheDocument();
    });
  });

  describe("accessorFn", () => {
    test("groups accessorFn returns groupPermissions array", () => {
      const groupsCol = columns.find((c) => c.id === "groups")!;
      const accessorFn = (groupsCol as any).accessorFn;
      expect(accessorFn(testProject)).toBe(testProject.groupPermissions);
    });

    test("aiModels accessorFn returns projectLlmIntegrations array", () => {
      const aiCol = columns.find((c) => c.id === "aiModels")!;
      const accessorFn = (aiCol as any).accessorFn;
      expect(accessorFn(testProject)).toBe(testProject.projectLlmIntegrations);
    });
  });
});
