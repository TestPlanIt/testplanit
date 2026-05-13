import { describe, expect, it, vi } from "vitest";

import { render, screen } from "~/test/test-utils";

import { IterationHeader } from "./IterationHeader";

describe("IterationHeader", () => {
  it("renders the iteration title heading element", () => {
    render(
      <IterationHeader
        rowIndex={2}
        total={10}
        status={null}
        hasResult={false}
        isRunCompleted={false}
        onMenuAction={vi.fn()}
      />
    );
    const header = screen.getByTestId("iteration-header");
    expect(header).toBeInTheDocument();
    // Title element should be present (i18n is mocked; assert on key path)
    expect(header.textContent).toContain("parameters.iterationHeaderTitle");
  });

  it("renders the status pip + name when a status is provided", () => {
    render(
      <IterationHeader
        rowIndex={0}
        total={5}
        status={{
          id: 1,
          name: "Passed",
          color: { value: "rgb(0, 200, 0)" },
          isSuccess: true,
          isFailure: false,
          isCompleted: true,
          systemName: "passed",
        }}
        hasResult={true}
        isRunCompleted={false}
        onMenuAction={vi.fn()}
      />
    );
    expect(screen.getByTestId("iteration-header-status")).toBeInTheDocument();
    expect(screen.getByTestId("iteration-status-pip")).toHaveAttribute(
      "data-glyph",
      "passed"
    );
    expect(screen.getByTestId("iteration-header-status").textContent).toContain(
      "Passed"
    );
  });

  it("exposes a menu trigger", () => {
    render(
      <IterationHeader
        rowIndex={0}
        total={5}
        status={null}
        hasResult={false}
        isRunCompleted={false}
        onMenuAction={vi.fn()}
      />
    );
    expect(
      screen.getByTestId("iteration-header-menu-trigger")
    ).toBeInTheDocument();
  });
});
