import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportLineChart } from "./ReportLineChart";
import type { SimpleChartDataPoint } from "./ReportChart";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock useResponsiveSVG hook
vi.mock("~/hooks/useResponsiveSVG", () => ({
  default: () => ({ width: 400, height: 300 }),
}));

// Mock D3 to avoid complex SVG rendering in tests
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
    html: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    node: vi.fn(() => ({
      getBBox: () => ({ x: 0, y: 0, width: 50, height: 20 }),
      getTotalLength: () => 100,
    })),
  })),
  scaleTime: vi.fn(() => {
    const fn = vi.fn((_val: any) => 0) as any;
    fn.domain = vi.fn().mockReturnThis();
    fn.range = vi.fn().mockReturnThis();
    return fn;
  }),
  scaleLinear: vi.fn(() => {
    const fn = vi.fn((val: any) => val) as any;
    fn.domain = vi.fn().mockReturnThis();
    fn.range = vi.fn().mockReturnThis();
    fn.nice = vi.fn().mockReturnThis();
    return fn;
  }),
  extent: vi.fn(() => [new Date("2024-01-01"), new Date("2024-12-31")]),
  max: vi.fn(() => 100),
  line: vi.fn(() => {
    const fn = vi.fn(() => "M0,0L100,100") as any;
    fn.x = vi.fn().mockReturnThis();
    fn.y = vi.fn().mockReturnThis();
    return fn;
  }),
  axisBottom: vi.fn(() => vi.fn().mockReturnThis()),
  axisLeft: vi.fn(() => vi.fn().mockReturnThis()),
  easeBackOut: { overshoot: vi.fn(() => (t: number) => t) },
  easeQuadOut: vi.fn((t: number) => t),
}));

describe("ReportLineChart", () => {
  const mockData: SimpleChartDataPoint[] = [
    { id: "2024-01-01", name: "2024-01-01", value: 10, formattedValue: "10" },
    { id: "2024-02-01", name: "2024-02-01", value: 25, formattedValue: "25" },
    { id: "2024-03-01", name: "2024-03-01", value: 15, formattedValue: "15" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders SVG element without crashing", () => {
    const { container } = render(<ReportLineChart data={mockData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with empty data gracefully", () => {
    const { container } = render(<ReportLineChart data={[]} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with time-series data points", () => {
    const { container } = render(<ReportLineChart data={mockData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("SVG has correct dimensions from useResponsiveSVG hook", () => {
    const { container } = render(<ReportLineChart data={mockData} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "400");
    expect(svg).toHaveAttribute("height", "300");
  });

  it("renders container with 100% width", () => {
    const { container } = render(<ReportLineChart data={mockData} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe("100%");
  });

  it("renders with single data point", () => {
    const singlePoint: SimpleChartDataPoint[] = [
      { id: "2024-01-01", name: "2024-01-01", value: 42, formattedValue: "42" },
    ];
    const { container } = render(<ReportLineChart data={singlePoint} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
