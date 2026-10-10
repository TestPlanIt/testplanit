import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StepsResults } from "./StepsResults";

const { stepLayoutState, toggleLayout, sharedItemsQuery } = vi.hoisted(() => ({
  stepLayoutState: { layout: "STACKED" as "STACKED" | "SIDE_BY_SIDE" },
  toggleLayout: vi.fn(),
  sharedItemsQuery: vi.fn((): { data: any[]; isLoading: boolean } => ({
    data: [],
    isLoading: false,
  })),
}));

vi.mock("~/hooks/useStepLayout", () => ({
  useStepLayout: () => ({
    layout: stepLayoutState.layout,
    isSideBySide: stepLayoutState.layout === "SIDE_BY_SIDE",
    toggleLayout,
    setLayout: vi.fn(),
  }),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    sharedStepItem: { useFindMany: sharedItemsQuery },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("@/components/tiptap/TipTapEditor", () => ({
  default: ({ content }: { content: any }) => (
    <div data-testid="tiptap-editor">
      {content?.content?.[0]?.content?.[0]?.text ?? ""}
    </div>
  ),
}));

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const step = (id: number, text: string, expected: string) =>
  ({
    id,
    step: doc(text),
    expectedResult: doc(expected),
    order: id - 1,
    sharedStepGroupId: null,
    testCaseId: 1,
    isDeleted: false,
  }) as any;

describe("StepsResults layout", () => {
  beforeEach(() => {
    stepLayoutState.layout = "STACKED";
    toggleLayout.mockClear();
    sharedItemsQuery.mockReturnValue({ data: [], isLoading: false });
  });

  it("stacks by default", () => {
    render(<StepsResults steps={[step(1, "Do it", "It is done")]} />);

    expect(screen.getByTestId("steps-results")).toHaveAttribute(
      "data-step-layout",
      "STACKED"
    );
    expect(screen.getByTestId("step-container-0")).toHaveClass("flex-col");
    expect(screen.getByTestId("step-container-0")).not.toHaveClass(
      "@2xl:grid-cols-2"
    );
  });

  it("renders two columns per step when side by side", () => {
    stepLayoutState.layout = "SIDE_BY_SIDE";
    render(
      <StepsResults
        steps={[step(1, "Do it", "It is done"), step(2, "Check", "Checked")]}
      />
    );

    expect(screen.getByTestId("steps-results")).toHaveAttribute(
      "data-step-layout",
      "SIDE_BY_SIDE"
    );
    for (const index of [0, 1]) {
      expect(screen.getByTestId(`step-container-${index}`)).toHaveClass(
        "grid",
        "@2xl:grid-cols-2"
      );
    }
    expect(screen.getByText("Do it")).toBeInTheDocument();
    expect(screen.getByText("It is done")).toBeInTheDocument();
  });

  it("flips the layout from the toggle", async () => {
    const user = userEvent.setup();
    render(<StepsResults steps={[step(1, "Do it", "It is done")]} />);

    await user.click(screen.getByTestId("step-layout-toggle"));

    expect(toggleLayout).toHaveBeenCalledTimes(1);
  });

  it("leaves the toggle to the surrounding surface when asked", () => {
    render(
      <StepsResults steps={[step(1, "Do it", "It is done")]} hideLayoutToggle />
    );

    expect(screen.queryByTestId("step-layout-toggle")).toBeNull();
    expect(screen.getByTestId("steps-results")).toHaveAttribute(
      "data-step-layout",
      "STACKED"
    );
  });

  it("lays out shared step items in two columns and drops their divider", () => {
    stepLayoutState.layout = "SIDE_BY_SIDE";
    sharedItemsQuery.mockReturnValue({
      data: [
        {
          id: 5,
          order: 0,
          step: doc("Shared do"),
          expectedResult: doc("Shared done"),
        },
      ],
      isLoading: false,
    });
    render(
      <StepsResults
        steps={[
          {
            ...step(3, "", ""),
            sharedStepGroupId: 9,
            sharedStepGroup: { name: "Setup" },
          },
        ]}
      />
    );

    const item = screen.getByText("Shared do").closest(".grid.grid-cols-1")!;
    expect(item).toHaveClass("@2xl:grid-cols-2");
    expect(item.querySelector('[role="none"]')).toHaveClass("@2xl:hidden");
    expect(screen.getByText("Shared done")).toBeInTheDocument();
  });
});
