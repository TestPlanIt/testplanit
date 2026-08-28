import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const {
  mockUpdatePI,
  mockMappingsFindMany,
  mockIssueUseCount,
  mockInvalidateQueries,
  mockOnRequestImport,
} = vi.hoisted(() => {
  return {
    mockUpdatePI: vi.fn(),
    mockMappingsFindMany: vi.fn(),
    mockIssueUseCount: vi.fn(),
    mockInvalidateQueries: vi.fn(),
    // Opening the shared import dialog is the caller's job now (28-20) --
    // this section only calls the prop, never manages its own dialog.
    mockOnRequestImport: vi.fn(),
  };
});

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
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
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

/** Routes a mocked `global.fetch` by URL substring, matched in the order
 *  given (first match wins) -- lets a single test express "the preview
 *  route returns X, the trigger route returns Y" without a generic
 *  catch-all masking a route this test forgot to stub. */
function mockFetchRoutes(
  routes: Array<[string, () => { status?: number; json?: any }]>
) {
  global.fetch = vi.fn((url: string) => {
    const match = routes.find(([pattern]) => url.includes(pattern));
    const result = match
      ? match[1]()
      : { status: 200, json: { issueTypes: [] } };
    const status = result.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.json ?? {},
    });
  }) as any;
}

function makeMapping(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: "map-1",
    externalProjectId: "10050",
    externalProjectKey: "ABT",
    externalProjectName: "Abstract",
    syncStatus: null,
    syncError: null,
    ...overrides,
  };
}

describe("RequirementsConfigSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMappingsFindMany.mockReturnValue({ data: [makeMapping()] });
    mockIssueUseCount.mockReturnValue({ data: 0 });
    mockInvalidateQueries.mockResolvedValue(undefined);
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
        onRequestImport={mockOnRequestImport}
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
        onRequestImport={mockOnRequestImport}
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
        onRequestImport={mockOnRequestImport}
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
        onRequestImport={mockOnRequestImport}
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
        onRequestImport={mockOnRequestImport}
      />
    );

    fireEvent.click(screen.getByTestId("mock-add-type"));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ classified: 1, declassified: 0 }),
    }) as any;

    fireEvent.click(screen.getByRole("button", { name: "save" }));

    // Located by URL rather than assumed to be the last call: a save that
    // newly classifies a type (as this one does) also fires the 28-07
    // offer-on-save preview probe on the same success path, so the PUT is
    // no longer necessarily the LAST fetch call -- it is still the only
    // call to this URL.
    await waitFor(() =>
      expect(
        (global.fetch as any).mock.calls.some(([callUrl]: [string]) =>
          callUrl.includes("requirements-config")
        )
      ).toBe(true)
    );

    const [url, options] = (global.fetch as any).mock.calls.find(
      ([callUrl]: [string]) => callUrl.includes("requirements-config")
    );
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
        onRequestImport={mockOnRequestImport}
      />
    );

    const saveButton = screen.getByRole("button", { name: "save" });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByTestId("mock-add-type"));

    expect(saveButton).toBeEnabled();
  });
});

describe("RequirementsConfigSettings — single import affordance via the shared dialog (#501/28-20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueUseCount.mockReturnValue({ data: 0 });
    mockInvalidateQueries.mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ issueTypes: [] }),
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const oneMappingConfig = {
    requirements: {
      enabled: true,
      issueTypeIds: ["type-1"],
      issueTypeNames: { "type-1": "Epic" },
    },
  };

  it("renders no per-mapping import button -- opening the shared dialog is the caller's job now (28-20)", () => {
    mockMappingsFindMany.mockReturnValue({
      data: [
        makeMapping({ id: "map-1", externalProjectName: "Abstract" }),
        makeMapping({ id: "map-2", externalProjectName: "Concrete" }),
      ],
    });

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration(oneMappingConfig)}
        integration={jiraIntegration}
        onRequestImport={mockOnRequestImport}
      />
    );

    expect(
      screen.queryByTestId("requirements-import-action-map-1")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("requirements-import-action-map-2")
    ).not.toBeInTheDocument();
    // The mapping row still renders (progress/status), just without a
    // button of its own.
    expect(
      screen.getByTestId("requirements-import-row-map-1")
    ).toHaveTextContent("Abstract");
    // Nothing here triggers a preview round trip on its own anymore.
    expect(
      (global.fetch as any).mock.calls.some(([url]: [string]) =>
        url.includes("requirements-import")
      )
    ).toBe(false);
  });

  it("never calls onRequestImport on its own render -- only a save that newly classifies a type does", () => {
    mockMappingsFindMany.mockReturnValue({ data: [makeMapping()] });

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration(oneMappingConfig)}
        integration={jiraIntegration}
        onRequestImport={mockOnRequestImport}
      />
    );

    expect(mockOnRequestImport).not.toHaveBeenCalled();
  });
});

describe("RequirementsConfigSettings — offer-on-save, progress polling, and stop (#501/28-07)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMappingsFindMany.mockReturnValue({ data: [makeMapping()] });
    mockIssueUseCount.mockReturnValue({ data: 0 });
    mockInvalidateQueries.mockResolvedValue(undefined);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ issueTypes: [] }),
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("a successful save with newly-added types calls onRequestImport with the newly-saved types preselected, captured BEFORE the cache invalidation resolves (the ordering trap)", async () => {
    // Simulates what a real (non-mocked) invalidateQueries eventually causes:
    // `projectIntegration.config` re-reading as the newly-saved value, which
    // would empty `diff.added` if the offer read it AFTER this resolves
    // instead of capturing it before.
    mockInvalidateQueries.mockImplementation(async () => {
      rerender(
        <RequirementsConfigSettings
          projectIntegration={makeProjectIntegration({
            requirements: {
              enabled: true,
              issueTypeIds: ["type-1", "type-new"],
              issueTypeNames: { "type-1": "Epic", "type-new": "Story" },
            },
          })}
          integration={jiraIntegration}
          onRequestImport={mockOnRequestImport}
        />
      );
    });
    mockFetchRoutes([
      [
        "requirements-config",
        () => ({ json: { classified: 1, declassified: 0 } }),
      ],
    ]);

    const { rerender } = render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration({
          requirements: {
            enabled: true,
            issueTypeIds: ["type-1"],
            issueTypeNames: { "type-1": "Epic" },
          },
        })}
        integration={jiraIntegration}
        onRequestImport={mockOnRequestImport}
      />
    );

    fireEvent.click(screen.getByTestId("mock-add-type"));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => {
      expect(mockOnRequestImport).toHaveBeenCalledWith({
        target: { id: "map-1", name: "Abstract", key: "ABT" },
        initialIssueTypeIds: ["type-1", "type-new"],
        initialIssueTypeNames: { "type-1": "Epic", "type-new": "Story" },
      });
    });
  });

  it("a successful save with no newly-added types never calls onRequestImport", async () => {
    mockFetchRoutes([
      [
        "requirements-config",
        () => ({ json: { classified: 0, declassified: 1 } }),
      ],
    ]);

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
        onRequestImport={mockOnRequestImport}
      />
    );

    // A removal-only change: no type is newly added.
    fireEvent.click(screen.getByTestId("mock-remove-first"));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(mockOnRequestImport).not.toHaveBeenCalled();
  });

  it("a failed save never calls onRequestImport", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    }) as any;

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
        onRequestImport={mockOnRequestImport}
      />
    );

    fireEvent.click(screen.getByTestId("mock-add-type"));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(mockOnRequestImport).not.toHaveBeenCalled();
  });

  it("polls every 3 seconds while any mapping is syncing or cancel-requested, and stops polling otherwise", () => {
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
        onRequestImport={mockOnRequestImport}
      />
    );

    const [, options] = mockMappingsFindMany.mock.calls.at(-1)!;
    expect(
      options.refetchInterval({ state: { data: [{ syncStatus: "syncing" }] } })
    ).toBe(3000);
    expect(
      options.refetchInterval({
        state: { data: [{ syncStatus: "cancel-requested" }] },
      })
    ).toBe(3000);
    expect(
      options.refetchInterval({
        state: { data: [{ syncStatus: "completed" }] },
      })
    ).toBe(false);
    expect(options.refetchInterval({ state: { data: [] } })).toBe(false);
  });

  it("a running mapping shows a running indicator and a stop control; a cancelled one renders distinctly from an error", () => {
    mockMappingsFindMany.mockReturnValue({
      data: [
        makeMapping({ id: "map-1", syncStatus: "syncing" }),
        makeMapping({
          id: "map-2",
          externalProjectName: "Concrete",
          syncStatus: "cancelled",
        }),
        makeMapping({
          id: "map-3",
          externalProjectName: "Solid",
          syncStatus: "error",
          syncError: "Boom",
        }),
      ],
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
        onRequestImport={mockOnRequestImport}
      />
    );

    expect(
      screen.getByTestId("requirements-import-stop-map-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("requirements-import-row-map-2")
    ).toHaveTextContent("importCancelled");
    expect(
      screen.getByTestId("requirements-import-row-map-2")
    ).not.toHaveTextContent("syncStatusError");
    expect(
      screen.getByTestId("requirements-import-row-map-3")
    ).toHaveTextContent("syncStatusError");
  });

  it("stopping asks for confirmation stating the one-page latency and keep-what-was-imported contract, then POSTs the cancel route", async () => {
    const { toast } = await import("sonner");
    mockMappingsFindMany.mockReturnValue({
      data: [makeMapping({ id: "map-1", syncStatus: "syncing" })],
    });
    mockFetchRoutes([
      ["requirements-import/cancel", () => ({ json: { success: true } })],
    ]);

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
        onRequestImport={mockOnRequestImport}
      />
    );

    fireEvent.click(screen.getByTestId("requirements-import-stop-map-1"));

    await waitFor(() => screen.getByTestId("requirements-import-stop-dialog"));
    expect(
      screen.getByTestId("requirements-import-stop-dialog")
    ).toHaveTextContent("importStopConfirmBody");

    fireEvent.click(screen.getByTestId("requirements-import-stop-confirm"));

    await waitFor(() => {
      const cancelCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url.includes("requirements-import/cancel")
      );
      expect(cancelCall).toBeDefined();
      expect(JSON.parse(cancelCall![1].body)).toEqual({
        projectId: 100,
        integrationProjectId: "map-1",
      });
    });
    expect(toast.success).toHaveBeenCalled();
  });
});
