import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/search/ProjectNameDisplay", () => ({
  ProjectNameDisplay: ({ projectName }: { projectName: string }) => (
    <span>{projectName}</span>
  ),
}));

import {
  ProjectDefaultTemplateWarning,
  projectsUsingAsDefault,
} from "./ProjectDefaultTemplateWarning";

const ADMIN_TOOL = { id: 1, name: "Admin Tool", iconUrl: null };
const WEB = { id: 2, name: "Web", iconUrl: null };

describe("projectsUsingAsDefault", () => {
  it("keeps only the projects the template is still assigned to", () => {
    expect(projectsUsingAsDefault([ADMIN_TOOL, WEB], [2, 3])).toEqual([WEB]);
  });

  it("returns nothing when no project uses the template as its default", () => {
    expect(projectsUsingAsDefault(undefined, [1])).toEqual([]);
  });
});

describe("ProjectDefaultTemplateWarning", () => {
  it("renders nothing without affected projects", () => {
    render(<ProjectDefaultTemplateWarning projects={[]} />);
    expect(
      screen.queryByTestId("template-project-default-warning")
    ).not.toBeInTheDocument();
  });

  it("names each affected project", () => {
    render(<ProjectDefaultTemplateWarning projects={[ADMIN_TOOL, WEB]} />);
    const warning = screen.getByTestId("template-project-default-warning");
    expect(warning).toHaveTextContent("Admin Tool");
    expect(warning).toHaveTextContent("Web");
  });
});
