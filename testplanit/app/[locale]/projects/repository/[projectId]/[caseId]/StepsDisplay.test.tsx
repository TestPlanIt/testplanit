import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StepsDisplay } from "./StepsDisplay";

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

vi.mock("@/components/TextFromJson", () => ({
  default: ({ jsonString }: { jsonString: string }) => (
    <span data-testid="text-from-json">{jsonString}</span>
  ),
}));

const doc = (text: string) =>
  JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

const steps = [
  {
    id: 1,
    step: doc("Open the app"),
    expectedResult: doc("App opens"),
    order: 0,
    sharedStepGroupId: null,
  },
  {
    id: 2,
    step: doc("Sign in"),
    expectedResult: doc("Signed in"),
    order: 1,
    sharedStepGroupId: null,
  },
];

const pairOf = (index: number) =>
  screen.getByTestId(`expected-result-${index}`).parentElement!;

describe("StepsDisplay layout", () => {
  beforeEach(() => {
    stepLayoutState.layout = "STACKED";
    toggleLayout.mockClear();
    sharedItemsQuery.mockReturnValue({ data: [], isLoading: false });
  });

  it("stacks each step over its expected result by default", () => {
    render(<StepsDisplay steps={steps} />);

    expect(screen.getByTestId("steps-display")).toHaveAttribute(
      "data-step-layout",
      "STACKED"
    );
    expect(pairOf(0)).toHaveClass("flex-col");
    expect(pairOf(0)).not.toHaveClass("@2xl:grid-cols-2");
    expect(screen.getByTestId("step-layout-toggle")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("puts the step and expected result in two columns when side by side", () => {
    stepLayoutState.layout = "SIDE_BY_SIDE";
    render(<StepsDisplay steps={steps} />);

    expect(screen.getByTestId("steps-display")).toHaveAttribute(
      "data-step-layout",
      "SIDE_BY_SIDE"
    );
    // The grid only applies from the container breakpoint up, so a narrow
    // panel still stacks.
    expect(pairOf(0)).toHaveClass("grid", "grid-cols-1", "@2xl:grid-cols-2");
    expect(pairOf(1)).toHaveClass("@2xl:grid-cols-2");
    expect(screen.getByTestId("step-layout-toggle")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("flips the layout from the toggle", async () => {
    const user = userEvent.setup();
    render(<StepsDisplay steps={steps} />);

    await user.click(screen.getByTestId("step-layout-toggle"));

    expect(toggleLayout).toHaveBeenCalledTimes(1);
  });

  it("lays out shared step items the same way", () => {
    stepLayoutState.layout = "SIDE_BY_SIDE";
    sharedItemsQuery.mockReturnValue({
      data: [
        {
          id: 10,
          order: 0,
          step: doc("Shared step"),
          expectedResult: doc("Shared expected"),
        },
      ],
      isLoading: false,
    });
    render(
      <StepsDisplay
        steps={[
          {
            id: 3,
            step: null,
            expectedResult: null,
            order: 0,
            sharedStepGroupId: 7,
            sharedStepGroup: { name: "Login", isDeleted: false },
          },
        ]}
      />
    );

    const sharedItem = screen
      .getByText(doc("Shared step"))
      .closest(".border-2.border-primary\\/20.rounded-lg")!;
    expect(sharedItem).toHaveClass("@2xl:grid-cols-2");
  });

  it("keeps old and new steps aligned with their expected results in a diff", () => {
    stepLayoutState.layout = "SIDE_BY_SIDE";
    render(
      <StepsDisplay
        steps={[steps[0]]}
        previousSteps={[
          { ...steps[0], step: doc("Open the old app") },
          steps[1],
        ]}
      />
    );

    // The changed step shows both versions inside its own column.
    expect(screen.getByText(doc("Open the old app"))).toBeInTheDocument();
    expect(screen.getByText(doc("Open the app"))).toBeInTheDocument();
    expect(pairOf(0)).toHaveClass("@2xl:grid-cols-2");

    // The deleted trailing step is rendered as a pair too.
    const deletedPair = screen
      .getByText(doc("Sign in"))
      .closest(".grid.grid-cols-1")!;
    expect(deletedPair).toHaveClass("@2xl:grid-cols-2");
    expect(screen.getByText(doc("Signed in"))).toBeInTheDocument();
  });
});
