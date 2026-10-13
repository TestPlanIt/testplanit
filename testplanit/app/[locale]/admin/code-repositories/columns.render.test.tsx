import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));
vi.mock("@/components/tables/ProjectListDisplay", () => ({
  ProjectListDisplay: ({ projects }: { projects: { projectId: number }[] }) => (
    <span data-testid="project-list">
      {projects.map((p) => p.projectId).join(",")}
    </span>
  ),
}));

import { getColumns, type CodeRepositoryRow } from "./columns";

const tCommon = ((key: string) => `common.${key}`) as any;

function renderProjectsCell(row: Partial<CodeRepositoryRow>) {
  const column = getColumns({
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onToggleStatus: vi.fn(),
    tCommon,
    tGlobal: tCommon,
  }).find((c) => c.id === "projects")!;
  const cell = column.cell as (ctx: any) => React.ReactNode;
  const original: CodeRepositoryRow = {
    id: 1,
    name: "Repo",
    provider: "GITHUB",
    settings: null,
    status: "ACTIVE",
    lastTestedAt: null,
    createdAt: "2026-09-17T00:00:00Z",
    ...row,
  };
  return render(<>{cell({ row: { original } })}</>);
}

describe("code repository columns — projects", () => {
  it("counts a project once across configs and execution targets", () => {
    renderProjectsCell({
      projectConfigs: [{ projectId: 3 }, { projectId: 5 }, { projectId: 3 }],
      executionTargets: [{ projectId: 5 }, { projectId: 8 }],
    });
    expect(screen.getByTestId("project-list")).toHaveTextContent("3,5,8");
  });

  it("renders nothing when no project uses the repository", () => {
    const { container } = renderProjectsCell({
      projectConfigs: [],
      executionTargets: [],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("tolerates rows loaded without the relations", () => {
    const { container } = renderProjectsCell({});
    expect(container).toBeEmptyDOMElement();
  });
});
