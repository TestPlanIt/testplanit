import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseFindFirstProjects,
  mockActionOverflow,
  mockMagicDialog,
  mockImpactDialog,
  mockRiskDialog,
} = vi.hoisted(() => ({
  mockUseFindFirstProjects: vi.fn(),
  mockActionOverflow: vi.fn(),
  mockMagicDialog: vi.fn(),
  mockImpactDialog: vi.fn(),
  mockRiskDialog: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: { useFindFirst: mockUseFindFirstProjects },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/action-bar", () => ({
  ActionOverflow: mockActionOverflow,
}));

vi.mock("./MagicSelectDialog", () => ({ MagicSelectDialog: mockMagicDialog }));
vi.mock("@/components/impact/ImpactDialog", () => ({
  ImpactDialog: mockImpactDialog,
}));
vi.mock("@/components/risk/RiskDialog", () => ({ RiskDialog: mockRiskDialog }));

import { CaseSelectionActions } from "./CaseSelectionActions";

const metadata = {
  name: "Regression",
  description: null,
  docs: null,
  linkedIssueIds: [],
};

function renderActions(
  props: Partial<React.ComponentProps<typeof CaseSelectionActions>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CaseSelectionActions
        projectId={1}
        testRunMetadata={metadata}
        selectedTestCases={[]}
        onSuggestionsAccepted={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
}

/** The action list the menu was handed on its latest render. */
function actions() {
  const calls = mockActionOverflow.mock.calls;
  return calls[calls.length - 1][0].actions as Array<{
    key: string;
    label: string;
    disabled?: boolean;
    hidden?: boolean;
    onClick: () => void;
  }>;
}

function actionFor(key: string) {
  return actions().find((a) => a.key === key)!;
}

describe("CaseSelectionActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActionOverflow.mockImplementation(() => <div data-testid="menu" />);
    mockMagicDialog.mockImplementation(() => <div data-testid="magic" />);
    mockImpactDialog.mockImplementation(() => <div data-testid="impact" />);
    mockRiskDialog.mockImplementation(() => <div data-testid="risk" />);
  });

  const fullyEnabled = {
    data: {
      impactEnabled: true,
      riskScoringEnabled: true,
      projectLlmIntegrations: [{ id: "llm-1" }],
      codeRepositoryConfigs: [
        {
          id: 7,
          repositoryId: 3,
          branch: "main",
          cacheEnabled: true,
          repository: { name: "app" },
        },
      ],
    },
    isLoading: false,
  };

  it("offers every source the project actually runs", () => {
    mockUseFindFirstProjects.mockReturnValue(fullyEnabled);
    renderActions();

    expect(actions().map((a) => a.key)).toEqual(["magic", "impact", "risk"]);
    for (const key of ["magic", "impact", "risk"]) {
      expect(actionFor(key).disabled).toBe(false);
      expect(actionFor(key).hidden).toBeFalsy();
    }
  });

  it("lets the caller's measured width decide menu or icons", () => {
    mockUseFindFirstProjects.mockReturnValue(fullyEnabled);

    // Default: one menu, which is what a caller that measures nothing gets.
    renderActions();
    expect(mockActionOverflow.mock.calls.at(-1)![0].compact).toBe(true);

    // A header with room asks for the sources as icon buttons instead.
    renderActions({ compact: false });
    expect(mockActionOverflow.mock.calls.at(-1)![0].compact).toBe(false);
  });

  it("hides a feature the project has switched off", () => {
    mockUseFindFirstProjects.mockReturnValue({
      ...fullyEnabled,
      data: {
        ...fullyEnabled.data,
        impactEnabled: false,
        riskScoringEnabled: false,
      },
    });
    renderActions();

    expect(actionFor("impact").hidden).toBe(true);
    expect(actionFor("risk").hidden).toBe(true);
    expect(actionFor("magic").hidden).toBeFalsy();
  });

  it("keeps an unconfigured source visible but disabled, and says what it needs", () => {
    mockUseFindFirstProjects.mockReturnValue({
      ...fullyEnabled,
      data: {
        ...fullyEnabled.data,
        projectLlmIntegrations: [],
        codeRepositoryConfigs: [],
      },
    });
    renderActions();

    expect(actionFor("magic").disabled).toBe(true);
    expect(actionFor("magic").label).toContain("noLlmIntegration");
    expect(actionFor("impact").disabled).toBe(true);
    expect(actionFor("impact").label).toContain("noRepository");
    // Switched on but unusable is not the same as switched off.
    expect(actionFor("impact").hidden).toBeFalsy();
  });

  it("opens only the chosen source's dialog, outside the menu", () => {
    mockUseFindFirstProjects.mockReturnValue(fullyEnabled);
    renderActions();

    expect(screen.queryByTestId("risk")).not.toBeInTheDocument();
    expect(screen.queryByTestId("impact")).not.toBeInTheDocument();

    act(() => actionFor("risk").onClick());

    expect(screen.getByTestId("risk")).toBeInTheDocument();
    expect(screen.queryByTestId("impact")).not.toBeInTheDocument();
  });

  it("merges a source's cases into the run without duplicating", () => {
    mockUseFindFirstProjects.mockReturnValue(fullyEnabled);
    const onSuggestionsAccepted = vi.fn();
    renderActions({ selectedTestCases: [10, 20], onSuggestionsAccepted });

    act(() => actionFor("risk").onClick());
    act(() => mockRiskDialog.mock.calls.at(-1)![0].onAccept([20, 30]));

    expect(onSuggestionsAccepted).toHaveBeenCalledWith([10, 20, 30]);
  });

  it("reports an accepted Impact analysis to the run", () => {
    mockUseFindFirstProjects.mockReturnValue(fullyEnabled);
    const onAnalysisAccepted = vi.fn();
    const onSuggestionsAccepted = vi.fn();
    renderActions({ onAnalysisAccepted, onSuggestionsAccepted });

    act(() => actionFor("impact").onClick());
    act(() =>
      mockImpactDialog.mock.calls.at(-1)![0].onAccept([5], { analysisId: 99 })
    );

    expect(onSuggestionsAccepted).toHaveBeenCalledWith([5]);
    expect(onAnalysisAccepted).toHaveBeenCalledWith({
      analysisId: 99,
      acceptedCaseIds: [5],
    });
  });
});
