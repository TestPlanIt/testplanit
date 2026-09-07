import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

vi.mock("@/components/ui/select", async () =>
  (await import("~/__tests__/helpers/radixSelectMock")).createSelectMock()
);

vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => null,
}));

vi.mock("@/components/ui/form", () => ({
  FormLabel: ({ children }: { children: React.ReactNode }) => (
    <label>{children}</label>
  ),
}));

const { mockList, mockSave, projectsRef } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockSave: vi.fn(),
  projectsRef: {
    current: [
      { id: 5, name: "Banking" },
      { id: 6, name: "Payments" },
    ] as Array<{ id: number; name: string }>,
  },
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useFindMany: () => ({ data: projectsRef.current, isLoading: false }),
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("~/app/actions/scimProjectMappingActions", () => ({
  listGroupProjectMappings: mockList,
  saveGroupProjectMapping: mockSave,
}));

import { toast } from "sonner";

import { GroupProjectMappings } from "./GroupProjectMappings";

beforeEach(() => {
  vi.clearAllMocks();
  projectsRef.current = [
    { id: 5, name: "Banking" },
    { id: 6, name: "Payments" },
  ];
  mockList.mockResolvedValue({ success: true, mappings: [] });
  mockSave.mockResolvedValue({ success: true });
});

describe("GroupProjectMappings", () => {
  it("G1: shows the empty state when the group maps to no project", async () => {
    render(<GroupProjectMappings groupId={1} />);

    await waitFor(() => expect(mockList).toHaveBeenCalledWith(1));
    expect(
      screen.getByText("admin.groups.projectMappings.empty")
    ).toBeInTheDocument();
  });

  it("G2: renders a row per existing mapping, with the project name", async () => {
    mockList.mockResolvedValue({
      success: true,
      mappings: [
        { projectId: 5, projectName: "Banking", mappedAccess: "PROJECTADMIN" },
      ],
    });

    render(<GroupProjectMappings groupId={1} />);

    await waitFor(() =>
      expect(
        screen.getByTestId("group-project-mapping-row-5")
      ).toBeInTheDocument()
    );
    expect(screen.getByText("Banking")).toBeInTheDocument();
  });

  it("G3: never offers NONE — a group row cannot deny project access", async () => {
    render(<GroupProjectMappings groupId={1} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const select = screen.getByTestId("group-project-mapping-access-select");
    const values = Array.from(select.querySelectorAll("option")).map((o) =>
      o.getAttribute("value")
    );

    expect(values).not.toContain("NONE");
    expect(values).toEqual(
      expect.arrayContaining(["USER", "PROJECTADMIN", "ADMIN"])
    );
  });

  it("G4: adding a mapping saves the chosen project and tier, then reloads", async () => {
    const user = userEvent.setup();
    render(<GroupProjectMappings groupId={1} />);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));

    await user.selectOptions(
      screen.getByTestId("group-project-mapping-project-select"),
      "5"
    );
    await user.selectOptions(
      screen.getByTestId("group-project-mapping-access-select"),
      "PROJECTADMIN"
    );
    await user.click(screen.getByTestId("group-project-mapping-add"));

    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(1, 5, "PROJECTADMIN")
    );
    // The list is refetched so the new row appears without a dialog reopen.
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it("G5: cannot add until a project is chosen", async () => {
    render(<GroupProjectMappings groupId={1} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(screen.getByTestId("group-project-mapping-add")).toBeDisabled();
  });

  it("G6: hides already-mapped projects from the add picker", async () => {
    mockList.mockResolvedValue({
      success: true,
      mappings: [
        { projectId: 5, projectName: "Banking", mappedAccess: "USER" },
      ],
    });

    render(<GroupProjectMappings groupId={1} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("group-project-mapping-row-5")
      ).toBeInTheDocument()
    );

    const picker = screen.getByTestId("group-project-mapping-project-select");
    const values = Array.from(picker.querySelectorAll("option"))
      .map((o) => o.getAttribute("value"))
      .filter(Boolean);

    expect(values).toEqual(["6"]);
  });

  it("G7: removing a mapping saves a null tier", async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      success: true,
      mappings: [
        { projectId: 5, projectName: "Banking", mappedAccess: "ADMIN" },
      ],
    });

    render(<GroupProjectMappings groupId={1} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("group-project-mapping-delete-5")
      ).toBeInTheDocument()
    );

    await user.click(screen.getByTestId("group-project-mapping-delete-5"));

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(1, 5, null));
  });

  it("G8: retiering an existing row saves the new tier for that project", async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      success: true,
      mappings: [
        { projectId: 5, projectName: "Banking", mappedAccess: "USER" },
      ],
    });

    render(<GroupProjectMappings groupId={1} />);
    await waitFor(() =>
      expect(
        screen.getByTestId("group-project-mapping-row-5")
      ).toBeInTheDocument()
    );

    const row = screen.getByTestId("group-project-mapping-row-5");
    await user.selectOptions(
      row.querySelector("select") as HTMLSelectElement,
      "ADMIN"
    );

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith(1, 5, "ADMIN"));
  });

  it("G9: surfaces a server error instead of reporting success", async () => {
    const user = userEvent.setup();
    mockSave.mockResolvedValue({ success: false, error: "Invalid input" });

    render(<GroupProjectMappings groupId={1} />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    await user.selectOptions(
      screen.getByTestId("group-project-mapping-project-select"),
      "5"
    );
    await user.click(screen.getByTestId("group-project-mapping-add"));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Invalid input")
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
