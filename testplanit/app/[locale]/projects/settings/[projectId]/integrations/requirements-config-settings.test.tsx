import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const { mockUpdatePI, mockMappingsFindMany, mockIssueUseCount } = vi.hoisted(
  () => {
    return {
      mockUpdatePI: vi.fn(),
      mockMappingsFindMany: vi.fn(),
      mockIssueUseCount: vi.fn(),
    };
  }
);

// --- Mocks ---

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    // Present purely so a test can assert it was never called — the save
    // path must go through the requirements-config route, not this hook.
    projectIntegration: { useUpdate: () => ({ mutateAsync: mockUpdatePI }) },
    integrationProject: {
      useFindMany: (...args: any[]) => mockMappingsFindMany(...args),
    },
    issue: {
      useCount: (...args: any[]) => mockIssueUseCount(...args),
    },
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) => {
    const last = key.split(".").pop() ?? key;
    return params ? `${last}:${JSON.stringify(params)}` : last;
  },
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

// Reuses the existing MultiAsyncCombobox mock shape (see
// project-integration-settings.test.tsx) so a click can push a selection
// through onValueChange, and additionally renders `value` so seeded chips
// are assertable.
vi.mock("@/components/ui/multi-async-combobox", () => ({
  MultiAsyncCombobox: ({
    value,
    placeholder,
    ariaLabel,
    disabled,
    onValueChange,
  }: any) => (
    <div data-testid="multi-async-combobox">
      <span>{placeholder}</span>
      <span>{ariaLabel}</span>
      {value.map((v: any) => (
        <span key={v.id} data-testid="selected-type">
          {v.name}
        </span>
      ))}
      <button
        type="button"
        data-testid="mock-add-type"
        disabled={disabled}
        onClick={() =>
          onValueChange?.([...value, { id: "type-new", name: "Story" }])
        }
      >
        Add type
      </button>
      <button
        type="button"
        data-testid="mock-remove-first"
        disabled={disabled}
        onClick={() => onValueChange?.(value.slice(1))}
      >
        Remove first
      </button>
    </div>
  ),
}));

import { RequirementsConfigSettings } from "./requirements-config-settings";

const jiraIntegration = {
  id: 1,
  provider: "JIRA",
  name: "Jira",
} as any;

function makeProjectIntegration(config: Record<string, any> | null = null) {
  return {
    id: "pi-1",
    projectId: 100,
    integrationId: 1,
    config,
  } as any;
}

const originalFetch = global.fetch;

describe("RequirementsConfigSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMappingsFindMany.mockReturnValue({
      data: [
        {
          id: "map-1",
          externalProjectId: "10050",
          externalProjectKey: "ABT",
          externalProjectName: "Abstract",
        },
      ],
    });
    mockIssueUseCount.mockReturnValue({ data: 0 });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ issueTypes: [] }),
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders the issue-type multi-select seeded from the saved requirements config", () => {
    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration({
          requirements: {
            enabled: true,
            issueTypeIds: ["type-1", "type-2"],
            issueTypeNames: { "type-1": "Epic", "type-2": "Story" },
          },
        })}
        integration={jiraIntegration}
      />
    );

    expect(screen.getByText("Epic")).toBeInTheDocument();
    expect(screen.getByText("Story")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows how many issues become requirements for the newly selected types", async () => {
    mockIssueUseCount.mockImplementation((args: any) => {
      if (args?.where?.isRequirement === false) {
        return { data: 4 };
      }
      return { data: 0 };
    });

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration({
          requirements: {
            enabled: true,
            issueTypeIds: ["type-1"],
            issueTypeNames: { "type-1": "Epic" },
          },
        })}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByTestId("mock-add-type"));

    await waitFor(() => {
      const becomingCall = mockIssueUseCount.mock.calls.find(
        (call: any) =>
          call[0]?.where?.isRequirement === false &&
          (call[0]?.where?.issueTypeId?.in?.length ?? 0) > 0
      );
      expect(becomingCall).toBeDefined();
      expect(becomingCall![0].where.issueTypeId).toEqual({ in: ["type-new"] });
    });

    expect(screen.getByText(/becomingRequirements/)).toHaveTextContent("4");
  });

  it("shows how many issues stop being requirements for the deselected types", async () => {
    mockIssueUseCount.mockImplementation((args: any) => {
      if (args?.where?.isRequirement === true && !args.where.OR) {
        return { data: 3 };
      }
      return { data: 0 };
    });

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration({
          requirements: {
            enabled: true,
            issueTypeIds: ["type-1"],
            issueTypeNames: { "type-1": "Epic" },
          },
        })}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByTestId("mock-remove-first"));

    await waitFor(() => {
      const stoppingCall = mockIssueUseCount.mock.calls.find(
        (call: any) =>
          call[0]?.where?.isRequirement === true &&
          !call[0].where.OR &&
          (call[0]?.where?.issueTypeId?.in?.length ?? 0) > 0
      );
      expect(stoppingCall).toBeDefined();
      expect(stoppingCall![0].where.issueTypeId).toEqual({ in: ["type-1"] });
    });

    expect(screen.getByText(/stoppingRequirements/)).toHaveTextContent("3");
  });

  it("calls out affected rows that are detached or locally owned", async () => {
    mockIssueUseCount.mockImplementation((args: any) => {
      if (args?.where?.OR) {
        return { data: 2 };
      }
      if (args?.where?.isRequirement === true) {
        return { data: 5 };
      }
      return { data: 0 };
    });

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration({
          requirements: {
            enabled: true,
            issueTypeIds: ["type-1"],
            issueTypeNames: { "type-1": "Epic" },
          },
        })}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByTestId("mock-remove-first"));

    await waitFor(() => {
      const calloutCall = mockIssueUseCount.mock.calls.find(
        (call: any) =>
          call[0]?.where?.OR &&
          (call[0]?.where?.issueTypeId?.in?.length ?? 0) > 0
      );
      expect(calloutCall).toBeDefined();
      expect(calloutCall![0].where.OR).toEqual([
        { requirementDetachedAt: { not: null } },
        { integrationId: null },
      ]);
    });

    expect(screen.getByText(/detachedCallout/)).toHaveTextContent("2");
  });

  it("saves through the requirements-config route, not the projectIntegration update hook", async () => {
    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration({
          requirements: {
            enabled: true,
            issueTypeIds: ["type-1"],
            issueTypeNames: { "type-1": "Epic" },
          },
        })}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByTestId("mock-add-type"));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ classified: 1, declassified: 0 }),
    }) as any;

    fireEvent.click(screen.getByRole("button", { name: "saveLabel" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const [url, options] = (global.fetch as any).mock.calls.at(-1);
    expect(url).toContain("requirements-config");
    expect(options.method).toBe("PUT");
    const body = JSON.parse(options.body);
    expect(body.projectId).toBe(100);
    expect(body.enabled).toBe(true);
    expect(body.issueTypeIds).toEqual(["type-1", "type-new"]);

    // The atomicity guarantee expressed as a test: the plain update hook is
    // never invoked by this card's save path.
    expect(mockUpdatePI).not.toHaveBeenCalled();
  });

  it("disables save until the pending selection differs from the saved config", () => {
    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration({
          requirements: {
            enabled: true,
            issueTypeIds: ["type-1"],
            issueTypeNames: { "type-1": "Epic" },
          },
        })}
        integration={jiraIntegration}
      />
    );

    const saveButton = screen.getByRole("button", { name: "saveLabel" });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByTestId("mock-add-type"));

    expect(saveButton).toBeEnabled();
  });
});
