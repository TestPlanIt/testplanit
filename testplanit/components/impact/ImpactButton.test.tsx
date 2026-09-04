import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUseFindFirstProjects, mockImpactDialog } = vi.hoisted(() => ({
  mockUseFindFirstProjects: vi.fn(),
  mockImpactDialog: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: { useFindFirst: mockUseFindFirstProjects },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./ImpactDialog", () => ({
  ImpactDialog: mockImpactDialog,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { ImpactButton } from "./ImpactButton";

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

const config = { id: 7, repositoryId: 3, branch: "main", cacheEnabled: true };

describe("ImpactButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImpactDialog.mockImplementation(
      ({
        open,
        onAccept,
      }: {
        open: boolean;
        onAccept: (ids: number[], info: { analysisId: number }) => void;
      }) =>
        open ? (
          <div data-testid="impact-dialog-mock">
            <button
              type="button"
              onClick={() => onAccept([3, 4], { analysisId: 9 })}
            >
              accept
            </button>
          </div>
        ) : null
    );
  });

  it("renders nothing while loading or when Impact is disabled for the project", () => {
    mockUseFindFirstProjects.mockReturnValue({
      data: { impactEnabled: false, codeRepositoryConfigs: [config] },
      isLoading: false,
    });
    renderWithQueryClient(
      <ImpactButton
        projectId={1}
        selectedTestCases={[]}
        onSuggestionsAccepted={vi.fn()}
      />
    );
    expect(screen.queryByTestId("impact-button")).not.toBeInTheDocument();
  });

  it("shows a disabled button with a tooltip when no Impact repository is configured", () => {
    mockUseFindFirstProjects.mockReturnValue({
      data: { impactEnabled: true, codeRepositoryConfigs: [] },
      isLoading: false,
    });
    renderWithQueryClient(
      <ImpactButton
        projectId={1}
        selectedTestCases={[]}
        onSuggestionsAccepted={vi.fn()}
      />
    );
    expect(screen.getByTestId("impact-button")).toBeDisabled();
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "noRepository"
    );
  });

  it("opens the dialog and unions accepted cases with the current selection", async () => {
    mockUseFindFirstProjects.mockReturnValue({
      data: { impactEnabled: true, codeRepositoryConfigs: [config] },
      isLoading: false,
    });
    const onSuggestionsAccepted = vi.fn();
    const onAnalysisAccepted = vi.fn();
    renderWithQueryClient(
      <ImpactButton
        projectId={1}
        selectedTestCases={[1, 3]}
        onSuggestionsAccepted={onSuggestionsAccepted}
        onAnalysisAccepted={onAnalysisAccepted}
      />
    );
    const button = screen.getByTestId("impact-button");
    expect(button).toBeEnabled();
    expect(screen.queryByTestId("impact-dialog-mock")).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(screen.getByTestId("impact-dialog-mock")).toBeInTheDocument();
    expect(mockImpactDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: 1,
        currentSelection: [1, 3],
        config: { id: 7, repositoryId: 3, branch: "main" },
      }),
      undefined
    );

    await userEvent.click(screen.getByText("accept"));
    expect(onSuggestionsAccepted).toHaveBeenCalledWith([1, 3, 4]);
    expect(onAnalysisAccepted).toHaveBeenCalledWith({
      analysisId: 9,
      acceptedCaseIds: [3, 4],
    });
  });
});
