import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LatestResultsCell } from "./LatestResultsCell";
import type { TestResultExecution } from "~/lib/types/latestTestResults";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/StatusDotDisplay", () => ({
  default: ({ name }: { name: string }) => <span>{name}</span>,
}));

const execution = (
  overrides: Partial<TestResultExecution> = {}
): TestResultExecution => ({
  resultId: 1,
  testRunId: 10,
  statusName: "Passed",
  statusColor: "#22c55e",
  isSuccess: true,
  isFailure: false,
  executedAt: "2026-07-01T10:00:00.000Z",
  ...overrides,
});

const squares = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(".h-4.w-4"));

describe("LatestResultsCell", () => {
  it("renders one square per execution", () => {
    const { container } = render(
      <LatestResultsCell
        executions={[
          execution({ resultId: 1 }),
          execution({ resultId: 2 }),
          execution({ resultId: 3 }),
        ]}
        slots={5}
        projectId={7}
        testCaseId={42}
      />
    );

    expect(squares(container)).toHaveLength(5);
  });

  it("pads a short history with empty slots", () => {
    const { container } = render(
      <LatestResultsCell
        executions={[execution()]}
        slots={5}
        projectId={7}
        testCaseId={42}
      />
    );

    const empties = container.querySelectorAll(".bg-muted");
    expect(empties).toHaveLength(4);
  });

  it("never renders more squares than slots", () => {
    const { container } = render(
      <LatestResultsCell
        executions={Array.from({ length: 12 }, (_, i) =>
          execution({ resultId: i + 1 })
        )}
        slots={5}
        projectId={7}
        testCaseId={42}
      />
    );

    expect(squares(container)).toHaveLength(5);
  });

  it("fades older results so the newest reads first", () => {
    const { container } = render(
      <LatestResultsCell
        executions={[
          execution({ resultId: 1 }),
          execution({ resultId: 2 }),
          execution({ resultId: 3 }),
        ]}
        slots={3}
        projectId={7}
        testCaseId={42}
      />
    );

    const opacities = squares(container).map((el) =>
      Number(el.style.opacity || "1")
    );
    expect(opacities[0]).toBe(1);
    expect(opacities[1]).toBeLessThan(opacities[0]);
    expect(opacities[2]).toBeLessThan(opacities[1]);
  });

  it("links each result to the run it came from", () => {
    render(
      <LatestResultsCell
        executions={[execution({ resultId: 1, testRunId: 99 })]}
        slots={1}
        projectId={7}
        testCaseId={42}
      />
    );

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/projects/runs/7/99?selectedCase=42"
    );
  });

  it("does not link a result whose run was deleted", () => {
    render(
      <LatestResultsCell
        executions={[execution({ testRunId: null })]}
        slots={1}
        projectId={7}
        testCaseId={42}
      />
    );

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing but empty slots when there are no executions", () => {
    const { container } = render(
      <LatestResultsCell
        executions={[]}
        slots={5}
        projectId={7}
        testCaseId={42}
      />
    );

    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelectorAll(".bg-muted")).toHaveLength(5);
  });
});
