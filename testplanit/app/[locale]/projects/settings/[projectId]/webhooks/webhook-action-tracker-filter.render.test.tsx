import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockIssues,
  mockMappings,
  mockProject,
  mockProjectIntegration,
  mockTrackerStatuses,
  comboboxes,
} = vi.hoisted(() => ({
  mockIssues: vi.fn(),
  mockMappings: vi.fn(),
  mockProject: vi.fn(),
  mockProjectIntegration: vi.fn(),
  mockTrackerStatuses: vi.fn(),
  comboboxes: new Map<string, any>(),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (ns?: string) => (key: string, params?: Record<string, unknown>) =>
      `${ns ? `${ns}.` : ""}${key}${params ? JSON.stringify(params) : ""}`,
}));
vi.mock("~/zenstack/schema", () => ({ schema: {} }));
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: { useFindMany: (...a: unknown[]) => mockIssues(...a) },
    integrationProject: {
      useFindMany: (...a: unknown[]) => mockMappings(...a),
    },
    projects: { useFindUnique: (...a: unknown[]) => mockProject(...a) },
    projectIntegration: {
      useFindFirst: (...a: unknown[]) => mockProjectIntegration(...a),
    },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (...a: unknown[]) => mockTrackerStatuses(...a),
}));
// Records each combobox's props by its accessible name and shows its value.
vi.mock("@/components/ui/multi-async-combobox", () => ({
  MultiAsyncCombobox: (props: any) => {
    comboboxes.set(props.ariaLabel, props);
    return (
      <div data-testid={`combobox-${props.ariaLabel}`}>
        {props.value.map((v: any) => props.getOptionLabel(v)).join("|")}
      </div>
    );
  },
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...rest }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      data-testid={rest["data-testid"]}
    />
  ),
}));

import {
  WebhookActionTrackerFilter,
  trackerFilterDraftFrom,
  trackerFilterFromDraft,
  type TrackerFilterDraft,
} from "./webhook-action-tracker-filter";

const STATUSES = "common.labels.statuses";
const ISSUE_TYPES =
  "projects.settings.integrations.integration.requirementsConfig.issueTypesLabel";

const emptyDraft: TrackerFilterDraft = {
  statuses: [],
  issueTypes: [],
  labels: [],
  requirementsOnly: false,
};

const onChange = vi.fn();

function Harness({
  initial = emptyDraft,
  integration = { id: 3, provider: "JIRA" },
}: {
  initial?: TrackerFilterDraft;
  integration?: { id: number; provider: string } | null;
}) {
  const [value, setValue] = useState(initial);
  return (
    <WebhookActionTrackerFilter
      projectId={42}
      integration={integration}
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe("tracker filter draft helpers", () => {
  it("reads a stored filter into a draft, naming issue types where it can", () => {
    expect(
      trackerFilterDraftFrom({
        statuses: ["Ready"],
        issueTypeIds: ["10001", "10002"],
        issueTypeNames: { "10001": "Story" },
        labels: ["qa"],
        requirementsOnly: true,
      })
    ).toEqual({
      statuses: ["Ready"],
      issueTypes: [
        { id: "10001", name: "Story" },
        { id: "10002", name: "10002" },
      ],
      labels: ["qa"],
      requirementsOnly: true,
    });
  });

  it("reads an empty or unreadable filter as an empty draft", () => {
    expect(trackerFilterDraftFrom(undefined)).toEqual(emptyDraft);
    expect(trackerFilterDraftFrom({})).toEqual(emptyDraft);
    expect(trackerFilterDraftFrom({ statuses: "Ready" })).toEqual(emptyDraft);
  });

  it("round-trips a filter through the draft", () => {
    const stored = {
      statuses: ["Ready", "In Review"],
      issueTypeIds: ["10001"],
      issueTypeNames: { "10001": "Story" },
      labels: ["qa", "backend"],
      requirementsOnly: true,
    };
    expect(trackerFilterFromDraft(trackerFilterDraftFrom(stored))).toEqual(
      stored
    );
    expect(trackerFilterFromDraft(emptyDraft)).toEqual({
      statuses: [],
      issueTypeIds: [],
      issueTypeNames: {},
      labels: [],
      requirementsOnly: false,
    });
  });
});

describe("WebhookActionTrackerFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comboboxes.clear();
    mockIssues.mockReturnValue({
      data: [
        { externalStatus: "Done" },
        { externalStatus: "In Review" },
        { externalStatus: null },
        { externalStatus: "Ready for QA" },
      ],
    });
    mockMappings.mockReturnValue({ data: [] });
    mockProject.mockReturnValue({ data: { requirementsEnabled: true } });
    mockProjectIntegration.mockReturnValue({
      data: {
        config: { requirements: { enabled: true, issueTypeIds: ["1"] } },
      },
    });
    mockTrackerStatuses.mockReturnValue({ data: [] });
  });

  it("suggests the distinct statuses the integration's issues hold", () => {
    render(<Harness />);
    expect(mockIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 42,
          isDeleted: false,
          externalStatus: { not: null },
          integrationId: 3,
        },
        distinct: ["externalStatus"],
      })
    );
  });

  it("doesn't scope statuses to an integration when there is none", () => {
    render(<Harness integration={null} />);
    expect(mockIssues.mock.calls[0][0].where).not.toHaveProperty(
      "integrationId"
    );
  });

  it("filters known statuses and offers the typed text as a status of its own", async () => {
    render(<Harness />);
    const { fetchOptions } = comboboxes.get(STATUSES);

    expect(await fetchOptions("", 0, 10)).toEqual({
      results: ["Done", "In Review", "Ready for QA"],
      total: 3,
    });
    expect(await fetchOptions("re", 0, 10)).toEqual({
      results: ["re", "In Review", "Ready for QA"],
      total: 3,
    });
    // An exact match (any case) isn't offered twice.
    expect(await fetchOptions(" done ", 0, 10)).toEqual({
      results: ["Done"],
      total: 1,
    });
    expect(await fetchOptions("Blocked", 0, 10)).toEqual({
      results: ["Blocked"],
      total: 1,
    });
    // Paged.
    expect(await fetchOptions("", 1, 2)).toEqual({
      results: ["Ready for QA"],
      total: 3,
    });
  });

  it("updates the chosen statuses", () => {
    render(<Harness />);
    React.act(() => comboboxes.get(STATUSES).onValueChange(["Ready for QA"]));
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyDraft,
      statuses: ["Ready for QA"],
    });
    expect(screen.getByTestId(`combobox-${STATUSES}`)).toHaveTextContent(
      "Ready for QA"
    );
  });

  it("offers issue types for a tracker that has them", () => {
    render(
      <Harness
        initial={{
          ...emptyDraft,
          issueTypes: [{ id: "1", name: "Story" }],
        }}
      />
    );
    expect(screen.getByTestId(`combobox-${ISSUE_TYPES}`)).toHaveTextContent(
      "Story"
    );
    React.act(() =>
      comboboxes.get(ISSUE_TYPES).onValueChange([{ id: "2", name: "Bug" }])
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyDraft,
      issueTypes: [{ id: "2", name: "Bug" }],
    });
  });

  it.each([
    ["a label-mode tracker", { id: 3, provider: "GITHUB" }],
    ["a tracker without issue types", { id: 3, provider: "SOMETHING_ELSE" }],
    ["no integration", null],
  ])("hides the issue type picker for %s", (_name, integration) => {
    render(<Harness integration={integration} />);
    expect(screen.queryByTestId(`combobox-${ISSUE_TYPES}`)).toBeNull();
    expect(screen.getByTestId(`combobox-${STATUSES}`)).toBeInTheDocument();
  });

  it("adds and removes labels", () => {
    render(<Harness />);
    const input = screen.getByTestId("webhook-action-labels-values-input");

    fireEvent.change(input, { target: { value: "qa" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "backend" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyDraft,
      labels: ["qa", "backend"],
    });
    expect(screen.getAllByTestId("webhook-action-labels-value")).toHaveLength(
      2
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "common.actions.remove" })[0]
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyDraft,
      labels: ["backend"],
    });
  });

  it("lists the tracker's own statuses first, then stored ones it didn't list", async () => {
    mockTrackerStatuses.mockReturnValue({ data: ["To Do", "done"] });
    render(<Harness />);
    const { fetchOptions } = comboboxes.get(STATUSES);
    expect(await fetchOptions("", 0, 10)).toEqual({
      results: ["To Do", "done", "In Review", "Ready for QA"],
      total: 4,
    });
  });

  it("offers requirements only only when the project classifies requirements", () => {
    mockProject.mockReturnValue({ data: { requirementsEnabled: false } });
    const { unmount } = render(<Harness />);
    expect(screen.queryByTestId("webhook-action-requirements-only")).toBeNull();
    unmount();

    mockProject.mockReturnValue({ data: { requirementsEnabled: true } });
    mockProjectIntegration.mockReturnValue({
      data: { config: { requirements: { enabled: false } } },
    });
    render(<Harness />);
    expect(screen.queryByTestId("webhook-action-requirements-only")).toBeNull();
  });

  it("keeps a saved requirements-only filter visible so it can be turned off", () => {
    mockProject.mockReturnValue({ data: { requirementsEnabled: false } });
    render(<Harness initial={{ ...emptyDraft, requirementsOnly: true }} />);
    expect(
      screen.getByTestId("webhook-action-requirements-only")
    ).toBeChecked();
  });

  it("toggles requirements only", () => {
    render(<Harness />);
    const toggle = screen.getByTestId("webhook-action-requirements-only");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith({
      ...emptyDraft,
      requirementsOnly: true,
    });
    expect(toggle).toBeChecked();
  });
});
