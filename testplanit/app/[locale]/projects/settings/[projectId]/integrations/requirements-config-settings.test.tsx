import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Stable mock refs via vi.hoisted() ---
const {
  mockUpdatePI,
  mockMappingsFindMany,
  mockIssueUseCount,
  mockInvalidateQueries,
} = vi.hoisted(() => {
  return {
    mockUpdatePI: vi.fn(),
    mockMappingsFindMany: vi.fn(),
    mockIssueUseCount: vi.fn(),
    mockInvalidateQueries: vi.fn(),
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

    fireEvent.click(screen.getByRole("button", { name: "save" }));

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

    const saveButton = screen.getByRole("button", { name: "save" });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByTestId("mock-add-type"));

    expect(saveButton).toBeEnabled();
  });
});

describe("RequirementsConfigSettings — typed import action and consent (#501/28-07)", () => {
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

  it("renders an import action per active mapping, naming the tracker project", () => {
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
      />
    );

    expect(
      screen.getByTestId("requirements-import-action-map-1")
    ).toHaveTextContent("Abstract");
    expect(
      screen.getByTestId("requirements-import-action-map-2")
    ).toHaveTextContent("Concrete");
  });

  it("fetches the tracker-side count and states it with the ~ convention, sourced from the preview response and never the local becomingCount", async () => {
    mockMappingsFindMany.mockReturnValue({ data: [makeMapping()] });
    // A deliberately DIFFERENT number from the preview's `matched` -- if the
    // dialog ever renders this value instead, this test's own assertion on
    // the exact preview count would fail.
    mockIssueUseCount.mockReturnValue({ data: 999 });
    mockFetchRoutes([
      [
        "requirements-import/preview",
        () => ({ json: { matched: 10, hasMore: false, cap: 0 } }),
      ],
    ]);

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration(oneMappingConfig)}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByTestId("requirements-import-action-map-1"));

    await waitFor(() => {
      expect(
        screen.getByTestId("requirements-import-offer-dialog")
      ).toHaveTextContent(/"count":10/);
    });
    expect(
      screen.getByTestId("requirements-import-offer-dialog")
    ).not.toHaveTextContent("999");

    const [url, options] = (global.fetch as any).mock.calls.at(-1);
    expect(url).toContain("requirements-import/preview");
    expect(JSON.parse(options.body)).toEqual({
      projectId: 100,
      integrationProjectId: "map-1",
    });
  });

  it("confirming POSTs the trigger route with the clicked mapping's id and toasts that the import started", async () => {
    const { toast } = await import("sonner");
    mockMappingsFindMany.mockReturnValue({
      data: [
        makeMapping({ id: "map-1", externalProjectName: "Abstract" }),
        makeMapping({ id: "map-2", externalProjectName: "Concrete" }),
      ],
    });
    mockFetchRoutes([
      [
        "requirements-import/preview",
        () => ({ json: { matched: 4, hasMore: false, cap: 0 } }),
      ],
      ["requirements-import", () => ({ json: { jobId: "job-1" } })],
    ]);

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration(oneMappingConfig)}
        integration={jiraIntegration}
      />
    );

    // Two-mapping fixture: click the SECOND mapping's action and confirm the
    // trigger POST body carries THAT mapping's id, not the first's.
    fireEvent.click(screen.getByTestId("requirements-import-action-map-2"));
    await waitFor(() =>
      screen.getByTestId("requirements-import-offer-confirm")
    );
    fireEvent.click(screen.getByTestId("requirements-import-offer-confirm"));

    await waitFor(() => {
      const triggerCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) =>
          url.includes("requirements-import") && !url.includes("preview")
      );
      expect(triggerCall).toBeDefined();
      expect(JSON.parse(triggerCall![1].body)).toEqual({
        projectId: 100,
        integrationProjectId: "map-2",
      });
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it("declining closes the dialog and imports nothing", async () => {
    mockMappingsFindMany.mockReturnValue({ data: [makeMapping()] });
    mockFetchRoutes([
      [
        "requirements-import/preview",
        () => ({ json: { matched: 4, hasMore: false, cap: 0 } }),
      ],
    ]);

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration(oneMappingConfig)}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByTestId("requirements-import-action-map-1"));
    await waitFor(() =>
      screen.getByTestId("requirements-import-offer-confirm")
    );

    fireEvent.click(screen.getByRole("button", { name: /importOfferDecline/ }));

    await waitFor(() => {
      expect(
        screen.queryByTestId("requirements-import-offer-confirm")
      ).not.toBeInTheDocument();
    });
    expect(
      (global.fetch as any).mock.calls.some(
        ([url]: [string]) =>
          url.includes("requirements-import") && !url.includes("preview")
      )
    ).toBe(false);
  });

  it("a config with no classified types is stated plainly instead of offering an import that would do nothing", async () => {
    mockMappingsFindMany.mockReturnValue({ data: [makeMapping()] });

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration({
          requirements: { enabled: true, issueTypeIds: [], issueTypeNames: {} },
        })}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByTestId("requirements-import-action-map-1"));

    await waitFor(() => {
      expect(
        screen.getByTestId("requirements-import-offer-dialog")
      ).toHaveTextContent("importNoTypes");
    });
    expect(
      screen.queryByTestId("requirements-import-offer-confirm")
    ).not.toBeInTheDocument();
    // No network round trip for a case decidable client-side.
    expect(
      (global.fetch as any).mock.calls.some(([url]: [string]) =>
        url.includes("requirements-import/preview")
      )
    ).toBe(false);
  });

  it("a tracker count of zero is stated plainly, offering no confirm action", async () => {
    mockMappingsFindMany.mockReturnValue({ data: [makeMapping()] });
    mockFetchRoutes([
      [
        "requirements-import/preview",
        () => ({ json: { matched: 0, hasMore: false, cap: 0 } }),
      ],
    ]);

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration(oneMappingConfig)}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByTestId("requirements-import-action-map-1"));

    await waitFor(() => {
      expect(
        screen.getByTestId("requirements-import-offer-dialog")
      ).toHaveTextContent(/"count":0/);
    });
    expect(
      screen.queryByTestId("requirements-import-offer-confirm")
    ).not.toBeInTheDocument();
  });

  it("a 409 from the trigger surfaces as already running, not a generic failure", async () => {
    const { toast } = await import("sonner");
    mockMappingsFindMany.mockReturnValue({ data: [makeMapping()] });
    mockFetchRoutes([
      [
        "requirements-import/preview",
        () => ({ json: { matched: 4, hasMore: false, cap: 0 } }),
      ],
      ["requirements-import", () => ({ status: 409, json: { error: "busy" } })],
    ]);

    render(
      <RequirementsConfigSettings
        projectIntegration={makeProjectIntegration(oneMappingConfig)}
        integration={jiraIntegration}
      />
    );

    fireEvent.click(screen.getByTestId("requirements-import-action-map-1"));
    await waitFor(() =>
      screen.getByTestId("requirements-import-offer-confirm")
    );
    fireEvent.click(screen.getByTestId("requirements-import-offer-confirm"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("importAlreadyRunning")
      );
    });
  });
});
