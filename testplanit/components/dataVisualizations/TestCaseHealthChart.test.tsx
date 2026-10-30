import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestCaseHealthChart } from "./TestCaseHealthChart";
import type { HealthStatus } from "~/utils/testCaseHealthUtils";

// Mock next-intl
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));

// Mock useResponsiveSVG hook
vi.mock("~/hooks/useResponsiveSVG", () => ({
  default: () => ({ width: 400, height: 300 }),
}));

// Mock D3 with chainable mocks (pie, arc, scaleLinear, etc. used in health chart)
vi.mock("d3", () => ({
  select: vi.fn(() => ({
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
  })),
  pie: vi.fn(() => {
    const fn = vi.fn((data: any[]) =>
      data.map((d: any, i: number) => ({
        data: d,
        value: d.count,
        index: i,
        startAngle: (i / data.length) * 2 * Math.PI,
        endAngle: ((i + 1) / data.length) * 2 * Math.PI,
        padAngle: 0,
      }))
    ) as any;
    fn.value = vi.fn().mockReturnThis();
    fn.sort = vi.fn().mockReturnThis();
    return fn;
  }),
  arc: vi.fn(() => {
    const fn = vi.fn(() => "M0,0") as any;
    fn.innerRadius = vi.fn().mockReturnThis();
    fn.outerRadius = vi.fn().mockReturnThis();
    fn.centroid = vi.fn(() => [0, 0]);
    return fn;
  }),
  scaleLinear: vi.fn(() => {
    const fn = vi.fn((val: any) => val * 10) as any;
    fn.domain = vi.fn().mockReturnThis();
    fn.range = vi.fn().mockReturnThis();
    return fn;
  }),
  easeBackOut: { overshoot: vi.fn(() => (t: number) => t) },
  easeQuadOut: vi.fn((t: number) => t),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Activity: () => <svg data-testid="icon-activity" />,
  AlertTriangle: () => <svg data-testid="icon-alert-triangle" />,
  CheckCircle2: () => <svg data-testid="icon-check-circle" />,
  Clock: () => <svg data-testid="icon-clock" />,
  HelpCircle: () => <svg data-testid="icon-help-circle" />,
}));

// Mock shadcn tooltip to avoid pointer-events complexity
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({
    children,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <>{children}</>,
}));

// Mock testCaseHealthUtils (only need the type)
vi.mock("~/utils/testCaseHealthUtils", () => ({}));

interface TestCaseHealthData {
  testCaseId: number;
  testCaseName: string;
  testCaseSource: string;
  createdAt: string;
  lastExecutedAt: string | null;
  daysSinceLastExecution: number | null;
  totalExecutions: number;
  passCount: number;
  failCount: number;
  passRate: number;
  healthStatus: HealthStatus;
  isStale: boolean;
  healthScore: number;
  project?: { id: number; name?: string };
}

describe("TestCaseHealthChart", () => {
  const mockHealthData: TestCaseHealthData[] = [
    {
      testCaseId: 1,
      testCaseName: "Login Test",
      testCaseSource: "manual",
      createdAt: "2024-01-01T00:00:00Z",
      lastExecutedAt: "2024-01-15T10:00:00Z",
      daysSinceLastExecution: 5,
      totalExecutions: 20,
      passCount: 18,
      failCount: 2,
      passRate: 0.9,
      healthStatus: "healthy",
      isStale: false,
      healthScore: 85,
    },
    {
      testCaseId: 2,
      testCaseName: "Checkout Test",
      testCaseSource: "automated",
      createdAt: "2024-01-01T00:00:00Z",
      lastExecutedAt: null,
      daysSinceLastExecution: null,
      totalExecutions: 0,
      passCount: 0,
      failCount: 0,
      passRate: 0,
      healthStatus: "never_executed",
      isStale: false,
      healthScore: 0,
    },
    {
      testCaseId: 3,
      testCaseName: "Payment Test",
      testCaseSource: "automated",
      createdAt: "2023-06-01T00:00:00Z",
      lastExecutedAt: "2024-01-01T10:00:00Z",
      daysSinceLastExecution: 95,
      totalExecutions: 50,
      passCount: 0,
      failCount: 50,
      passRate: 0,
      healthStatus: "always_failing",
      isStale: true,
      healthScore: 10,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing with health data", () => {
    const { container } = render(<TestCaseHealthChart data={mockHealthData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders 'no data' message when data is empty", () => {
    render(<TestCaseHealthChart data={[]} />);
    expect(screen.getByText("noData")).toBeInTheDocument();
  });

  it("renders summary stats cards with data", () => {
    const { container } = render(<TestCaseHealthChart data={mockHealthData} />);
    // The component renders a flex column layout with stat cards and chart
    expect(container.firstChild).not.toBeNull();
  });

  it("draws the tiles from the server summary when one is given, not from the rows on screen", () => {
    render(
      <TestCaseHealthChart
        data={mockHealthData}
        summary={{
          total: 76770,
          counts: {
            healthy: 45306,
            never_executed: 29875,
            always_passing: 1489,
            always_failing: 100,
          },
          staleCount: 12000,
          needsAttention: 41975,
          healthy: 46795,
          avgHealthScore: 63,
        }}
      />
    );
    // Total tests tile: the summary's total, not data.length (3).
    expect(screen.getByText("76,770")).toBeInTheDocument();
    expect(screen.getByText("41,975")).toBeInTheDocument();
    expect(screen.getByText("12,000")).toBeInTheDocument();
    expect(screen.getByText("46,795")).toBeInTheDocument();
    expect(screen.getByText("63")).toBeInTheDocument();
  });

  it("computes the same tiles from the rows when no summary is given", () => {
    render(<TestCaseHealthChart data={mockHealthData} />);
    // 3 rows: total 3, and needs attention 3 (1 always_failing, 1
    // never_executed, 1 stale) — so "3" appears on more than one tile.
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(2);
    // avg of 85, 0, 10 = 32
    expect(screen.getByText("32")).toBeInTheDocument();
  });

  it("treats an empty summary as no data even when a page of rows is present", () => {
    render(
      <TestCaseHealthChart
        data={mockHealthData}
        summary={{
          total: 0,
          counts: {
            healthy: 0,
            never_executed: 0,
            always_passing: 0,
            always_failing: 0,
          },
          staleCount: 0,
          needsAttention: 0,
          healthy: 0,
          avgHealthScore: 0,
        }}
      />
    );
    expect(screen.getByText("noData")).toBeInTheDocument();
  });

  it("renders with a single test case health entry", () => {
    const singleData = [mockHealthData[0]];
    const { container } = render(<TestCaseHealthChart data={singleData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with all healthy test cases", () => {
    const healthyData: TestCaseHealthData[] = [
      { ...mockHealthData[0], healthStatus: "healthy" },
      { ...mockHealthData[0], testCaseId: 4, healthStatus: "healthy" },
    ];
    const { container } = render(<TestCaseHealthChart data={healthyData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with all never_executed test cases", () => {
    const neverData: TestCaseHealthData[] = [
      { ...mockHealthData[1], testCaseId: 5 },
      { ...mockHealthData[1], testCaseId: 6 },
    ];
    const { container } = render(<TestCaseHealthChart data={neverData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with mixed health statuses", () => {
    const mixedData: TestCaseHealthData[] = [
      { ...mockHealthData[0], healthStatus: "healthy" },
      { ...mockHealthData[1], testCaseId: 7, healthStatus: "never_executed" },
      { ...mockHealthData[2], testCaseId: 8, healthStatus: "always_failing" },
      { ...mockHealthData[0], testCaseId: 9, healthStatus: "always_passing" },
    ];
    const { container } = render(<TestCaseHealthChart data={mixedData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with stale tests", () => {
    const staleData: TestCaseHealthData[] = mockHealthData.map((d) => ({
      ...d,
      isStale: true,
    }));
    const { container } = render(<TestCaseHealthChart data={staleData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with projectId prop", () => {
    const { container } = render(
      <TestCaseHealthChart data={mockHealthData} projectId={42} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
