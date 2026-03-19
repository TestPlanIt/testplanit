import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlakyTestsBubbleChart } from "./FlakyTestsBubbleChart";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) => {
    if (params) return `${key}: ${JSON.stringify(params)}`;
    return key;
  },
  useLocale: () => "en",
}));

// Mock useResponsiveSVG hook
vi.mock("~/hooks/useResponsiveSVG", () => ({
  default: () => ({ width: 400, height: 300 }),
}));

// Mock navigation
vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Mock D3 with chainable mocks including force simulation
vi.mock("d3", () => {
  const selectionChain = {
    selectAll: vi.fn().mockReturnThis(),
    remove: vi.fn().mockReturnThis(),
    append: vi.fn().mockReturnThis(),
    attr: vi.fn().mockReturnThis(),
    style: vi.fn().mockReturnThis(),
    data: vi.fn().mockReturnThis(),
    datum: vi.fn().mockReturnThis(),
    enter: vi.fn().mockReturnThis(),
    each: vi.fn().mockReturnThis(),
    on: vi.fn().mockReturnThis(),
    transition: vi.fn().mockReturnThis(),
    duration: vi.fn().mockReturnThis(),
    delay: vi.fn().mockReturnThis(),
    ease: vi.fn().mockReturnThis(),
    call: vi.fn().mockReturnThis(),
    join: vi.fn().mockReturnThis(),
    html: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    node: vi.fn(() => null),
  };

  return {
    select: vi.fn(() => ({ ...selectionChain })),
    scaleLinear: vi.fn(() => {
      const fn = vi.fn((val: any) => val) as any;
      fn.domain = vi.fn().mockReturnThis();
      fn.range = vi.fn().mockReturnThis();
      fn.nice = vi.fn().mockReturnThis();
      return fn;
    }),
    scaleSqrt: vi.fn(() => {
      const fn = vi.fn((val: any) => Math.sqrt(val) * 10) as any;
      fn.domain = vi.fn().mockReturnThis();
      fn.range = vi.fn().mockReturnThis();
      return fn;
    }),
    scaleSequential: vi.fn(() => {
      const fn = vi.fn(() => "#ff0000") as any;
      fn.domain = vi.fn().mockReturnThis();
      return fn;
    }),
    max: vi.fn(() => 10),
    axisBottom: vi.fn(() => {
      const fn = vi.fn().mockReturnThis() as any;
      fn.ticks = vi.fn().mockReturnThis();
      fn.tickFormat = vi.fn().mockReturnThis();
      fn.tickSize = vi.fn().mockReturnThis();
      return fn;
    }),
    axisLeft: vi.fn(() => {
      const fn = vi.fn().mockReturnThis() as any;
      fn.ticks = vi.fn().mockReturnThis();
      fn.tickFormat = vi.fn().mockReturnThis();
      fn.tickSize = vi.fn().mockReturnThis();
      return fn;
    }),
    interpolateRdYlGn: vi.fn((t: number) => `rgba(${Math.round(t * 255)},100,100,1)`),
    easeBackOut: { overshoot: vi.fn(() => (t: number) => t) },
    easeQuadOut: vi.fn((t: number) => t),
  };
});

describe("FlakyTestsBubbleChart", () => {
  const executionBase = [
    { resultId: 1, testRunId: 1, statusName: "Failed", statusColor: "#ef4444", isSuccess: false, isFailure: true, executedAt: "2024-01-15T10:00:00Z" },
    { resultId: 2, testRunId: 2, statusName: "Passed", statusColor: "#22c55e", isSuccess: true, isFailure: false, executedAt: "2024-01-14T10:00:00Z" },
    { resultId: 3, testRunId: 3, statusName: "Failed", statusColor: "#ef4444", isSuccess: false, isFailure: true, executedAt: "2024-01-13T10:00:00Z" },
  ];

  const mockFlakyData = [
    {
      testCaseId: 1,
      testCaseName: "Test A - Login flow",
      testCaseSource: "manual",
      flipCount: 5,
      executions: executionBase,
    },
    {
      testCaseId: 2,
      testCaseName: "Test B - Checkout",
      testCaseSource: "automated",
      flipCount: 3,
      executions: [
        { resultId: 4, testRunId: 4, statusName: "Failed", statusColor: "#ef4444", isSuccess: false, isFailure: true, executedAt: "2024-01-16T10:00:00Z" },
        { resultId: 5, testRunId: 5, statusName: "Passed", statusColor: "#22c55e", isSuccess: true, isFailure: false, executedAt: "2024-01-15T10:00:00Z" },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders SVG element without crashing with flaky test data", () => {
    const { container } = render(
      <FlakyTestsBubbleChart data={mockFlakyData} consecutiveRuns={10} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders 'no flaky tests' message when data is empty array", () => {
    render(
      <FlakyTestsBubbleChart data={[]} consecutiveRuns={10} />
    );
    // FlakyTestsBubbleChart renders a div message when data.length === 0
    expect(screen.getByText("noFlakyTests")).toBeInTheDocument();
  });

  it("renders SVG with single flaky test entry", () => {
    const singleTest = [mockFlakyData[0]];
    const { container } = render(
      <FlakyTestsBubbleChart data={singleTest} consecutiveRuns={10} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with zero flip count gracefully", () => {
    const zeroFlipData = [
      {
        testCaseId: 3,
        testCaseName: "Stable Test",
        testCaseSource: "manual",
        flipCount: 0,
        executions: [
          { resultId: 6, testRunId: 6, statusName: "Passed", statusColor: "#22c55e", isSuccess: true, isFailure: false, executedAt: "2024-01-10T10:00:00Z" },
        ],
      },
    ];
    const { container } = render(
      <FlakyTestsBubbleChart data={zeroFlipData} consecutiveRuns={10} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with totalCount prop showing backlog count", () => {
    const { container } = render(
      <FlakyTestsBubbleChart
        data={mockFlakyData}
        consecutiveRuns={10}
        totalCount={50}
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with projectId prop", () => {
    const { container } = render(
      <FlakyTestsBubbleChart
        data={mockFlakyData}
        consecutiveRuns={10}
        projectId={42}
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with cross-project data (tests with project property)", () => {
    const crossProjectData = mockFlakyData.map((t) => ({
      ...t,
      project: { id: 1, name: "My Project" },
    }));
    const { container } = render(
      <FlakyTestsBubbleChart data={crossProjectData} consecutiveRuns={10} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with data that has no executions array", () => {
    const noExecData = [
      {
        testCaseId: 4,
        testCaseName: "No Exec Test",
        testCaseSource: "manual",
        flipCount: 2,
        executions: [],
      },
    ];
    const { container } = render(
      <FlakyTestsBubbleChart data={noExecData} consecutiveRuns={10} />
    );
    // With empty executions, bubbleData will be empty, so SVG still renders
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
