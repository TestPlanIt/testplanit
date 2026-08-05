import { render, screen } from "@testing-library/react";
import { LayoutTemplate } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => <span>{userId}</span>,
}));

import { ViewSelector } from "./ViewSelector";

/**
 * The row list's contract, in numbers: no count is ever negative and the
 * "All …"/"Mixed" row is never smaller than one of its own options. Both broke
 * once the counts engine started self-excluding each dimension — `totalCount`
 * (counted under ALL predicates) stopped being the base the option counts sit
 * on.
 */

const VIEW_ITEMS = [
  { id: "templates", name: "Templates", icon: LayoutTemplate },
  { id: "dynamic_2_Dropdown", name: "Severity", icon: LayoutTemplate },
];

const SEVERITY_FACET = {
  type: "Dropdown",
  fieldId: 2,
  options: [
    { id: 147, name: "High", count: 90 },
    { id: 148, name: "Low", count: 40 },
  ],
  counts: { hasValue: 130, noValue: 20 },
};

function baseViewOptions(overrides: Record<string, unknown> = {}) {
  return {
    templates: [
      { id: 1, name: "Login", count: 90 },
      { id: 2, name: "Checkout", count: 60 },
    ],
    states: [],
    creators: [],
    automated: [],
    parameterized: [],
    attachments: [],
    dynamicFields: { Severity: SEVERITY_FACET },
    tags: [],
    issues: [],
    ...overrides,
  };
}

function renderViewSelector(props: Record<string, unknown> = {}) {
  return render(
    <TooltipProvider>
      <ViewSelector
        selectedItem="dynamic_2_Dropdown"
        onValueChange={vi.fn()}
        viewItems={VIEW_ITEMS}
        isFilterValueActive={() => false}
        onToggleFilterValue={vi.fn()}
        // Under `?f=field_2:in:147` the table shows 90 cases; the option
        // counts self-exclude that chip and sit on a 150-case base.
        totalCount={90}
        viewOptions={baseViewOptions()}
        {...props}
      />
    </TooltipProvider>
  );
}

/** The count rendered on the row whose label is `label`. */
function rowCount(label: string): number {
  const row = screen.getByText(label).closest('[role="button"]');
  return Number(row!.lastElementChild!.textContent);
}

describe("ViewSelector counts", () => {
  it("renders a non-negative None row for an option field with an active filter", () => {
    renderViewSelector({ dimensionTotals: { field_2: 150 } });

    // The live repro rendered 90 - (90 + 40) = -60 here.
    expect(rowCount("common.access.none")).toBe(20);
  });

  it("keeps All >= every option row for an option field", () => {
    renderViewSelector({ dimensionTotals: { field_2: 150 } });

    const all = rowCount("common.fields.mixed");
    expect(all).toBe(150);
    for (const label of ["High", "Low", "common.access.none"]) {
      expect(all).toBeGreaterThanOrEqual(rowCount(label));
      expect(rowCount(label)).toBeGreaterThanOrEqual(0);
    }
  });

  it("falls back to the subtraction when the payload carries no counts, clamped at zero", () => {
    renderViewSelector({
      dimensionTotals: undefined,
      viewOptions: baseViewOptions({
        dynamicFields: {
          Severity: {
            type: "Dropdown",
            fieldId: 2,
            options: SEVERITY_FACET.options,
          },
        },
      }),
    });

    // 90 - 130 would be -40; the row clamps instead of rendering nonsense.
    expect(rowCount("common.access.none")).toBe(0);
    // With no dimensionTotals the Mixed row keeps the legacy totalCount.
    expect(rowCount("common.fields.mixed")).toBe(90);
  });

  it("reads dimensionTotals from the viewOptions payload as well as the prop", () => {
    renderViewSelector({
      viewOptions: baseViewOptions({ dimensionTotals: { field_2: 150 } }),
    });

    expect(rowCount("common.fields.mixed")).toBe(150);
  });

  it("uses the dimension's self-excluded total for the All-templates row", () => {
    renderViewSelector({
      selectedItem: "templates",
      dimensionTotals: { templates: 150 },
    });

    const all = rowCount("repository.views.allTemplates");
    expect(all).toBe(150);
    expect(all).toBeGreaterThanOrEqual(rowCount("Login"));
    expect(all).toBeGreaterThanOrEqual(rowCount("Checkout"));
  });

  it("falls back to the option sum for the All-templates row without dimensionTotals", () => {
    renderViewSelector({ selectedItem: "templates" });

    expect(rowCount("repository.views.allTemplates")).toBe(150);
  });
});
