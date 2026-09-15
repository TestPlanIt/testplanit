import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { ImpactAnalysisCaseRow } from "~/hooks/useImpactAnalysis";
import {
  AffectedTestsStep,
  affectedThresholdOf,
  filterCases,
  facetCounts,
  NO_FILTERS,
  sortCases,
} from "./AffectedTestsStep";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string, values?: object) => {
    const base = namespace ? `${namespace}.${key}` : key;
    return values ? `${base}:${JSON.stringify(values)}` : base;
  },
  useLocale: () => "en-US",
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/projects/runs/7",
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="tooltip">{children}</span>
  ),
}));

vi.mock("../UncoveredFilesCallout", () => ({
  UncoveredFilesCallout: () => null,
}));

function row(
  caseId: number,
  score: number,
  tier: ImpactAnalysisCaseRow["tier"],
  reasons: ImpactAnalysisCaseRow["reasons"],
  name = `Case ${caseId}`
): ImpactAnalysisCaseRow {
  return {
    caseId,
    score,
    tier,
    layers: reasons.map((reason) => reason.kind),
    reasons,
    coveredFiles: [],
    case: { id: caseId, name, automated: false, folder: null },
  };
}

const PIN = { kind: "PIN", pinKind: "FILE", filePath: "src/a.ts" } as any;
const PATH = {
  kind: "PATH",
  term: "checkout",
  matchedField: "db.name",
} as any;
const LINKED = { kind: "LINKED", viaCaseId: 1 } as any;

const cases = [
  row(1, 100, "pinned", [PIN], "Zeta pinned"),
  row(2, 60, "affected", [PATH], "Alpha affected"),
  row(3, 30, "related", [LINKED], "Mid related"),
];

const config = { id: 5, repositoryId: 9, branch: "main" } as any;

function renderStep(
  over: Partial<React.ComponentProps<typeof AffectedTestsStep>> = {}
) {
  const onSetSelection = vi.fn();
  render(
    <AffectedTestsStep
      projectId={7}
      config={config}
      cases={cases}
      result={null}
      selectedCaseIds={[1, 2]}
      onToggleCase={vi.fn()}
      onSetSelection={onSetSelection}
      pinnedUncovered={{}}
      onPinCreated={vi.fn()}
      {...over}
    />
  );
  return { onSetSelection };
}

describe("filterCases", () => {
  it("keeps every case with no filters", () => {
    expect(filterCases(cases, NO_FILTERS)).toHaveLength(3);
  });

  it("narrows by tier, by any chosen reason, and by minimum score", () => {
    expect(
      filterCases(cases, { ...NO_FILTERS, tiers: new Set(["related"]) }).map(
        (c) => c.caseId
      )
    ).toEqual([3]);
    expect(
      filterCases(cases, {
        ...NO_FILTERS,
        reasons: new Set(["PIN", "PATH"]),
      }).map((c) => c.caseId)
    ).toEqual([1, 2]);
    expect(
      filterCases(cases, { ...NO_FILTERS, minScore: 60 }).map((c) => c.caseId)
    ).toEqual([1, 2]);
  });
});

describe("facetCounts", () => {
  it("counts each tier and reason under the other filters, keeping every option", () => {
    const all = facetCounts(cases, NO_FILTERS);
    expect(all.tiers).toEqual([
      { tier: "pinned", count: 1 },
      { tier: "affected", count: 1 },
      { tier: "related", count: 1 },
    ]);
    expect(all.reasons.map((r) => [r.kind, r.count])).toEqual([
      ["PIN", 1],
      ["PATH", 1],
      ["LINKED", 1],
    ]);

    // The score slider empties Related but the option stays, at zero.
    const scored = facetCounts(cases, { ...NO_FILTERS, minScore: 50 });
    expect(scored.tiers).toEqual([
      { tier: "pinned", count: 1 },
      { tier: "affected", count: 1 },
      { tier: "related", count: 0 },
    ]);
    // A tier choice narrows the reason counts, not the tier counts.
    const tiered = facetCounts(cases, {
      ...NO_FILTERS,
      tiers: new Set(["pinned"]),
    });
    expect(tiered.tiers.map((t) => t.count)).toEqual([1, 1, 1]);
    expect(tiered.reasons.map((r) => [r.kind, r.count])).toEqual([
      ["PIN", 1],
      ["PATH", 0],
      ["LINKED", 0],
    ]);
  });
});

describe("sortCases", () => {
  it("sorts by score, name, or tier in either direction", () => {
    expect(
      sortCases(cases, { column: "score", direction: "asc" }).map(
        (c) => c.caseId
      )
    ).toEqual([3, 2, 1]);
    expect(
      sortCases(cases, { column: "case", direction: "asc" }).map(
        (c) => c.caseId
      )
    ).toEqual([2, 3, 1]);
    expect(
      sortCases(cases, { column: "tier", direction: "desc" }).map(
        (c) => c.caseId
      )
    ).toEqual([3, 2, 1]);
  });
});

describe("affectedThresholdOf", () => {
  it("prefers the recorded threshold, then the lowest affected score, then 50", () => {
    expect(
      affectedThresholdOf(
        {
          summary: "",
          stalePins: [],
          uncoveredFiles: [],
          warnings: [],
          stats: { thresholds: { affected: 65, min: 20 } },
        },
        cases
      )
    ).toBe(65);
    expect(affectedThresholdOf(null, cases)).toBe(60);
    expect(affectedThresholdOf(null, [cases[0]])).toBe(50);
  });
});

describe("AffectedTestsStep", () => {
  it("counts the selection in the header and names the threshold", () => {
    renderStep();

    expect(screen.getByTestId("impact-affected-title")).toHaveTextContent(
      'runs.impact.affected.selectedOf:{"selected":2,"total":3}'
    );
    expect(
      screen.getByText(/affected\.thresholdHint:\{"threshold":60\}/)
    ).toBeInTheDocument();
  });

  it("lists every case sorted by score with tier tooltips", () => {
    renderStep();

    const rows = screen.getAllByTestId(/^impact-recommendation-\d+$/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "impact-recommendation-1",
      "impact-recommendation-2",
      "impact-recommendation-3",
    ]);
    expect(screen.getByTestId("impact-recommendation-1")).toHaveAttribute(
      "data-state",
      "selected"
    );
    expect(screen.getByTestId("impact-recommendation-3")).not.toHaveAttribute(
      "data-state"
    );
    const tier = screen.getByTestId("impact-tier-3").closest("td")!;
    expect(within(tier).getByTestId("tooltip")).toHaveTextContent(
      "tierRelatedTooltip"
    );
  });

  async function pickOption(pickerTestId: string, optionTestId: string) {
    const picker = screen.getByTestId(pickerTestId);
    fireEvent.click(within(picker).getByRole("combobox"));
    fireEvent.click(await screen.findByTestId(optionTestId));
  }

  it("filters by tier and selects just the shown cases", async () => {
    const { onSetSelection } = renderStep();

    await pickOption("impact-filter-tier", "impact-filter-tier-related");

    await waitFor(() =>
      expect(screen.queryByTestId("impact-recommendation-1")).toBeNull()
    );
    expect(screen.queryByTestId("impact-recommendation-2")).toBeNull();
    expect(screen.getByTestId("impact-recommendation-3")).toBeInTheDocument();
    expect(screen.getByTestId("impact-shown-count")).toHaveTextContent(
      '{"shown":1,"total":3}'
    );

    fireEvent.click(screen.getByTestId("impact-select-shown"));
    expect(onSetSelection).toHaveBeenLastCalledWith([1, 2, 3]);

    fireEvent.click(screen.getByTestId("impact-clear-filters"));
    expect(screen.getByTestId("impact-recommendation-1")).toBeInTheDocument();
  });

  it("filters by reason and deselects just the shown cases", async () => {
    const { onSetSelection } = renderStep();

    await pickOption("impact-filter-reason", "impact-filter-reason-PATH");

    await waitFor(() =>
      expect(screen.queryByTestId("impact-recommendation-1")).toBeNull()
    );
    expect(screen.getByTestId("impact-recommendation-2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("impact-deselect-shown"));
    expect(onSetSelection).toHaveBeenLastCalledWith([1]);
  });

  it("checks and clears the shown rows from the header checkbox", async () => {
    const { onSetSelection } = renderStep({ selectedCaseIds: [] });

    await pickOption("impact-filter-tier", "impact-filter-tier-affected");
    await waitFor(() =>
      expect(screen.queryByTestId("impact-recommendation-1")).toBeNull()
    );
    fireEvent.click(screen.getByTestId("impact-select-all"));

    expect(onSetSelection).toHaveBeenLastCalledWith([2]);
  });

  it("expands a row's reasons in place", () => {
    renderStep();

    fireEvent.click(screen.getByTestId("impact-recommendation-toggle-1"));

    expect(screen.getByTestId("impact-rationale-1")).toBeInTheDocument();
    expect(screen.getByTestId("impact-reason-1-PIN")).toBeInTheDocument();
  });
});
