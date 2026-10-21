import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: mockToast }));

const mockMutateAsync = vi.fn();
let mockTemplates:
  | Array<{
      id: number;
      templateName: string;
      isDefault: boolean;
      isEnabled: boolean;
      isDeleted: boolean;
      projects: { projectId: number }[];
    }>
  | undefined;
const mockFindMany = vi.fn();

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    templates: {
      useFindMany: (...args: unknown[]) => {
        mockFindMany(...args);
        return { data: mockTemplates };
      },
    },
    projects: {
      useUpdate: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
    },
  }),
}));

vi.mock("@/components/DefaultTemplateBadge", () => ({
  DefaultTemplateBadge: ({ source }: { source: string }) => (
    <span data-testid={`badge-${source}`} />
  ),
}));

// Radix Select doesn't open in jsdom; render each item as a clickable option
// that reports whether it is the selected value.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});
  return {
    Select: ({ value, onValueChange, children }: any) => (
      <SelectContext.Provider value={{ value, onValueChange }}>
        {children}
      </SelectContext.Provider>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ value, disabled, children }: any) => {
      const select = React.useContext(SelectContext);
      return (
        <button
          type="button"
          role="option"
          aria-selected={select.value === value}
          disabled={disabled}
          onClick={() => select.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
  };
});

import { DefaultTemplateCard } from "./DefaultTemplateCard";

const usable = (id: number, templateName: string, isDefault = false) => ({
  id,
  templateName,
  isDefault,
  isEnabled: true,
  isDeleted: false,
  projects: [{ projectId: 42 }],
});

function renderCard(defaultTemplateId: number | null) {
  return render(
    <DefaultTemplateCard
      projectId={42}
      defaultTemplateId={defaultTemplateId}
      disabled={false}
    />
  );
}

describe("DefaultTemplateCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
    mockTemplates = [usable(1, "Manual", true), usable(2, "Automated")];
  });

  it("selects Use System Default when the project has no default", () => {
    renderCard(null);

    expect(
      screen.getByRole("option", {
        name: "projects.settings.aiModels.useSystemDefault",
      })
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Manual" })).toContainElement(
      screen.getByTestId("badge-system")
    );
    expect(
      screen.queryByTestId("default-template-unavailable-warning")
    ).not.toBeInTheDocument();
  });

  it("queries the project's usable templates plus its configured default", () => {
    renderCard(9);

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            {
              isDeleted: false,
              isEnabled: true,
              projects: { some: { projectId: 42 } },
            },
            { id: 9 },
          ],
        },
      }),
      expect.objectContaining({ enabled: true })
    );
  });

  it("saves the chosen template as the project default", async () => {
    renderCard(null);

    fireEvent.click(screen.getByRole("option", { name: "Automated" }));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { defaultTemplateId: 2 },
      });
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("clears the project default when Use System Default is chosen", async () => {
    renderCard(2);

    expect(screen.getByRole("option", { name: "Automated" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    fireEvent.click(
      screen.getByRole("option", {
        name: "projects.settings.aiModels.useSystemDefault",
      })
    );

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { defaultTemplateId: null },
      });
    });
  });

  it("reports a failed save", async () => {
    mockMutateAsync.mockRejectedValue(new Error("denied"));
    renderCard(null);

    fireEvent.click(screen.getByRole("option", { name: "Automated" }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it.each([
    ["disabled", { isEnabled: false }],
    ["deleted", { isDeleted: true }],
    ["unassigned", { projects: [] }],
  ])("warns when the configured default is %s", (_label, change) => {
    mockTemplates = [
      usable(1, "Manual", true),
      { ...usable(3, "Legacy"), ...change },
    ];
    renderCard(3);

    expect(
      screen.getByTestId("default-template-unavailable-warning")
    ).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Legacy" })).toBeDisabled();
  });

  it("does not warn while the configured default is usable", () => {
    renderCard(2);

    expect(
      screen.queryByTestId("default-template-unavailable-warning")
    ).not.toBeInTheDocument();
  });
});
