import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseQuery, mockProject, mockReview } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockProject: vi.fn(),
  mockReview: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => {
    const t = (key: string, params?: Record<string, unknown>) =>
      `${ns ? `${ns}.` : ""}${key}${params ? JSON.stringify(params) : ""}`;
    t.rich = (key: string) => key;
    return t;
  },
  useLocale: () => "en-US",
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (...a: unknown[]) => mockUseQuery(...a),
}));
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: { useFindUnique: (...a: unknown[]) => mockProject(...a) },
  }),
}));
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...a: unknown[]) => mockReview(...a),
}));
vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => <span>{userId}</span>,
}));

import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import {
  caseFilterForSave,
  replaceCaseFilterPredicate,
  upsertCaseFilterPredicate,
  useCaseFilterText,
  useProjectCaseFilterOptions,
  WebhookActionCaseFilter,
  type ProjectCaseFilterOptions,
} from "./webhook-action-case-filter";

beforeAll(() => {
  // cmdk scrolls the selected item into view; jsdom has no implementation.
  Element.prototype.scrollIntoView = vi.fn();
});

const viewOptions = {
  templates: [{ id: 1, name: "Login" }],
  tags: [{ id: 5, name: "smoke" }],
  dynamicFields: {
    Priority: {
      type: "Dropdown",
      fieldId: 12,
      options: [
        { id: 31, name: "High" },
        { id: 32, name: "Low" },
      ],
    },
    Notes: { type: "Text Long", fieldId: 13 },
    Owner: { type: "User", fieldId: 14 },
  },
};

const automatedIs = (value: number): FilterPredicate => ({
  dimension: "automated",
  operator: "is",
  values: [value],
});
const tagsAny = (values: number[]): FilterPredicate => ({
  dimension: "tags",
  operator: "any",
  values,
});
const tagsNone: FilterPredicate = {
  dimension: "tags",
  operator: "none",
  values: [],
};

/** Renders the hook's result as JSON so a test can read it. */
function HookProbe({
  projectId,
  enabled,
}: {
  projectId: number;
  enabled?: boolean;
}) {
  const options = useProjectCaseFilterOptions(projectId, enabled);
  const text = useCaseFilterText(options);
  return (
    <pre data-testid="probe">
      {JSON.stringify({
        keys: [...options.registry.keys()],
        labels: options.dynamicFieldLabels,
        ready: options.ready,
        texts: [
          text({ dimension: "field_12", operator: "in", values: [31, 32] }),
          text(automatedIs(0)),
          text(tagsAny([5])),
          text({ dimension: "field_99", operator: "in", values: [1] }),
        ],
      })}
    </pre>
  );
}

function probe() {
  return JSON.parse(screen.getByTestId("probe").textContent ?? "{}");
}

describe("useProjectCaseFilterOptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: viewOptions });
    mockProject.mockReturnValue({ data: { impactEnabled: true } });
    mockReview.mockReturnValue({ enabled: true });
  });

  it("builds the repository's dimensions from the project's view options and flags, without run dimensions", () => {
    render(<HookProbe projectId={42} />);

    const result = probe();
    expect(result.keys).toEqual([
      "templates",
      "states",
      "creators",
      "automated",
      "parameterized",
      "attachments",
      "tags",
      "issues",
      "inReview",
      "codePins",
      "field_12",
      "field_13",
    ]);
    expect(result.labels).toEqual({ field_12: "Priority", field_13: "Notes" });
    expect(result.ready).toBe(true);
    expect(mockUseQuery.mock.calls[0][0]).toMatchObject({
      queryKey: ["viewOptions", 42, "caseFilter"],
      enabled: true,
    });
    expect(mockProject).toHaveBeenCalledWith(
      {
        where: { id: 42 },
        select: { impactEnabled: true, riskScoringEnabled: true },
      },
      { enabled: true }
    );
  });

  it("leaves In Review and Code Pins out when the project doesn't run them", () => {
    mockProject.mockReturnValue({ data: { impactEnabled: false } });
    mockReview.mockReturnValue({ enabled: false });
    render(<HookProbe projectId={42} />);
    const keys = probe().keys;
    expect(keys).not.toContain("inReview");
    expect(keys).not.toContain("codePins");
  });

  it("is not ready until the options, the review flag and the project have all loaded", () => {
    mockUseQuery.mockReturnValue({ data: undefined });
    const { rerender } = render(<HookProbe projectId={42} />);
    expect(probe().ready).toBe(false);
    expect(probe().keys).not.toContain("field_12");

    mockUseQuery.mockReturnValue({ data: viewOptions });
    mockReview.mockReturnValue({ enabled: undefined });
    rerender(<HookProbe projectId={42} />);
    expect(probe().ready).toBe(false);

    mockReview.mockReturnValue({ enabled: false });
    mockProject.mockReturnValue({ data: undefined });
    rerender(<HookProbe projectId={42} />);
    expect(probe().ready).toBe(false);

    mockProject.mockReturnValue({ data: null });
    rerender(<HookProbe projectId={42} />);
    expect(probe().ready).toBe(true);
  });

  it("fetches nothing while disabled", () => {
    render(<HookProbe projectId={42} enabled={false} />);
    expect(mockUseQuery.mock.calls[0][0]).toMatchObject({ enabled: false });
    expect(mockProject.mock.calls[0][1]).toEqual({ enabled: false });
  });

  it("names a filter as the repository's chips do, or not at all for a dimension the project lacks", () => {
    render(<HookProbe projectId={42} />);
    expect(probe().texts).toEqual([
      "Priority: common.operators.in High, Low",
      "repository.views.byAutomation: common.operators.is common.fields.notAutomated",
      "repository.views.byTag: common.operators.anyOf smoke",
      null,
    ]);
  });
});

describe("upsertCaseFilterPredicate", () => {
  it("adds a new key, replaces an existing one, and drops what contradicts the result", () => {
    expect(upsertCaseFilterPredicate([], automatedIs(1))).toEqual([
      automatedIs(1),
    ]);
    expect(
      upsertCaseFilterPredicate([automatedIs(1), tagsAny([5])], automatedIs(0))
    ).toEqual([automatedIs(0), tagsAny([5])]);
    // bare `none` and a value-asserting predicate on one dimension can't coexist
    expect(
      upsertCaseFilterPredicate([tagsNone, automatedIs(1)], tagsAny([5]))
    ).toEqual([automatedIs(1), tagsAny([5])]);
  });
});

describe("replaceCaseFilterPredicate", () => {
  it("re-keys a chip, lets it displace a chip on the new key, and removes it when its last value goes", () => {
    const none5: FilterPredicate = { ...tagsNone, values: [5] };
    expect(
      replaceCaseFilterPredicate(
        [tagsAny([5]), automatedIs(1)],
        "tags",
        "any",
        none5
      )
    ).toEqual([none5, automatedIs(1)]);
    expect(
      replaceCaseFilterPredicate([tagsAny([5]), none5], "tags", "any", {
        ...none5,
        values: [6],
      })
    ).toEqual([{ ...none5, values: [6] }]);
    expect(
      replaceCaseFilterPredicate(
        [automatedIs(1), tagsAny([5])],
        "automated",
        "is",
        {
          ...automatedIs(1),
          values: [],
        }
      )
    ).toEqual([tagsAny([5])]);
    // a bare `any` keeps the chip: it reads as "has a value"
    expect(
      replaceCaseFilterPredicate([tagsAny([5])], "tags", "any", tagsAny([]))
    ).toEqual([tagsAny([])]);
    expect(
      replaceCaseFilterPredicate([tagsAny([5])], "states", "in", tagsAny([]))
    ).toBeNull();
  });
});

describe("caseFilterForSave", () => {
  const ready: ProjectCaseFilterOptions = {
    registry: new Map([["automated", {} as never]]),
    viewOptions: undefined,
    dynamicFieldLabels: {},
    ready: true,
  };

  it("drops filters the project no longer offers once the dimensions are known, and keeps everything before", () => {
    const gone: FilterPredicate = {
      dimension: "field_99",
      operator: "in",
      values: [1],
    };
    expect(caseFilterForSave([automatedIs(1), gone], ready)).toEqual([
      automatedIs(1),
    ]);
    expect(
      caseFilterForSave([automatedIs(1), gone], { ...ready, ready: false })
    ).toEqual([automatedIs(1), gone]);
  });
});

describe("WebhookActionCaseFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: viewOptions });
    mockProject.mockReturnValue({ data: { impactEnabled: false } });
    mockReview.mockReturnValue({ enabled: false });
  });

  function Host({
    initial,
    onChange,
  }: {
    initial: FilterPredicate[];
    onChange: (next: FilterPredicate[]) => void;
  }) {
    const options = useProjectCaseFilterOptions(42);
    const [value, setValue] = React.useState(initial);
    return (
      <WebhookActionCaseFilter
        options={options}
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }

  it("adds a filter picked from the repository's dimension list", () => {
    const onChange = vi.fn();
    render(<Host initial={[]} onChange={onChange} />);

    expect(
      screen.getByText("projects.settings.webhooks.actions.caseFilter")
    ).toBeInTheDocument();
    expect(
      screen.getByText("projects.settings.webhooks.actions.caseFilterHelp")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("filter-bar-add"));
    fireEvent.click(screen.getByTestId("filter-dimension-option-automated"));

    expect(onChange).toHaveBeenLastCalledWith([automatedIs(1)]);
    expect(screen.getByTestId("filter-chip-automated-is")).toBeInTheDocument();
  });

  it("removes one chip, or all of them", () => {
    const onChange = vi.fn();
    render(
      <Host initial={[automatedIs(1), tagsAny([5])]} onChange={onChange} />
    );

    fireEvent.click(screen.getByTestId("filter-chip-automated-is-remove"));
    expect(onChange).toHaveBeenLastCalledWith([tagsAny([5])]);
    expect(screen.queryByTestId("filter-bar-clear")).toBeNull();

    fireEvent.click(screen.getByTestId("filter-chip-tags-any-remove"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("clears every chip at once", () => {
    const onChange = vi.fn();
    render(
      <Host initial={[automatedIs(1), tagsAny([5])]} onChange={onChange} />
    );
    fireEvent.click(screen.getByTestId("filter-bar-clear"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("says how many saved filters the project no longer offers, once it knows", () => {
    const gone: FilterPredicate = {
      dimension: "field_99",
      operator: "in",
      values: [1],
    };
    const { rerender } = render(
      <Host initial={[automatedIs(1), gone]} onChange={vi.fn()} />
    );
    expect(
      screen.getByTestId("webhook-action-case-filter-dropped")
    ).toHaveTextContent('repository.savedViews.droppedFilters{"count":1}');
    expect(screen.queryByTestId("filter-chip-field_99-in")).toBeNull();

    mockUseQuery.mockReturnValue({ data: undefined });
    rerender(<Host initial={[automatedIs(1), gone]} onChange={vi.fn()} />);
    expect(
      screen.queryByTestId("webhook-action-case-filter-dropped")
    ).toBeNull();
  });
});
