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
    fetchOptions,
  }: any) => (
    <div data-testid="multi-async-combobox">
      <span>{placeholder}</span>
      <span>{ariaLabel}</span>
      <button
        type="button"
        data-testid="mock-fetch-options"
        onClick={() => void fetchOptions?.("", 0, 50)}
      >
        Fetch options
      </button>
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
    // Progress/status for a mapping's import no longer renders in this
    // section at all (#501/28-21) -- it lives on the mapping's own row in
    // project-integration-settings.tsx now, beside the Import button that
    // starts the run.
    expect(
      screen.queryByTestId("requirements-import-row-map-1")
    ).not.toBeInTheDocument();
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

  // Progress polling, the running/cancelled/error badge distinction, and the
  // stop-confirmation flow moved to project-integration-settings.test.tsx
  // (#501/28-21) along with the code -- this section's own `mappings` query
  // no longer selects syncStatus/syncError or polls, since it no longer
  // displays any of that.
});

// ---------------------------------------------------------------------------
// Label mode — GitHub and Gitea, the card's two label-mode providers.
// Selections are LABEL names (each adapter's getIssueTypes serves
// repository labels), the wording switches from types to labels, and the
// type-column impact preview is replaced by a note because the counts
// would be a confident zero (labels live in a JSON column the client
// query layer can't match).
// ---------------------------------------------------------------------------
describe.each([
  ["GITHUB", "GitHub"],
  ["GITEA", "Gitea"],
])("RequirementsConfigSettings — %s label mode", (provider, providerName) => {
  const labelModeIntegration = {
    id: 2,
    provider,
    name: providerName,
  } as any;

  const labelModeMapping = makeMapping({
    externalProjectId: "testowner/testrepo",
    externalProjectKey: "testrepo",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockMappingsFindMany.mockReturnValue({ data: [labelModeMapping] });
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

  function renderLabelModeCard() {
    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration({
          requirements: {
            enabled: true,
            issueTypeIds: ["epic"],
            issueTypeNames: { epic: "epic" },
          },
        })}
        integration={labelModeIntegration}
        onRequestImport={mockOnRequestImport}
      />
    );
  }

  it(`renders for ${provider} with label wording instead of issue-type wording`, () => {
    renderLabelModeCard();

    expect(
      screen.getByTestId("requirements-config-section")
    ).toBeInTheDocument();
    expect(screen.getByText("labelsLabel")).toBeInTheDocument();
    expect(screen.getByText("labelsPlaceholder")).toBeInTheDocument();
    expect(screen.getByText("labelsAriaLabel")).toBeInTheDocument();
    expect(screen.queryByText("issueTypesLabel")).not.toBeInTheDocument();
  });

  it("replaces the numeric impact preview with the label note and never runs the type-column counts", async () => {
    // A non-zero stub: if any of the three counts DID render, it would
    // show 9 and the becoming/stopping assertions below would catch it.
    mockIssueUseCount.mockReturnValue({ data: 9 });

    renderLabelModeCard();
    fireEvent.click(screen.getByTestId("mock-add-type"));

    await waitFor(() => {
      expect(screen.getByText(/labelPreviewNote/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/becomingRequirements/)).not.toBeInTheDocument();
    expect(screen.queryByText(/stoppingRequirements/)).not.toBeInTheDocument();
    // Every type-column count query must be gated off in label mode —
    // its where clause keys on issueTypeId, NULL on every labeled row.
    for (const call of mockIssueUseCount.mock.calls) {
      expect(call[1]?.enabled).toBe(false);
    }
  });

  it("fetches the label vocabulary with the full owner/repo ref, not the short repo key", async () => {
    renderLabelModeCard();
    fireEvent.click(screen.getAllByTestId("mock-fetch-options")[0]);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/integrations/2/issue-types?projectKey=${encodeURIComponent("testowner/testrepo")}`
        )
      );
    });
  });
});
