import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportBarChart } from "./ReportBarChart";
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
    datum: vi.fn().mockReturnThis(),
    node: vi.fn(() => ({
      getBBox: () => ({ x: 0, y: 0, width: 50, height: 20 }),
      getTotalLength: () => 100,
    })),
  })),
  scaleBand: vi.fn(() => {
    const fn = vi.fn((_val: any) => 0) as any;
    fn.domain = vi.fn().mockReturnThis();
    fn.range = vi.fn().mockReturnThis();
    fn.padding = vi.fn().mockReturnThis();
    fn.bandwidth = vi.fn(() => 40);
    return fn;
  }),
  scaleLinear: vi.fn(() => {
    const fn = vi.fn((val: any) => val) as any;
    fn.domain = vi.fn().mockReturnThis();
    fn.range = vi.fn().mockReturnThis();
    fn.nice = vi.fn().mockReturnThis();
    return fn;
  }),
  max: vi.fn(() => 100),
  axisBottom: vi.fn(() => vi.fn().mockReturnThis()),
  axisLeft: vi.fn(() => vi.fn().mockReturnThis()),
  easeBackOut: { overshoot: vi.fn(() => (t: number) => t) },
  easeQuadOut: vi.fn((t: number) => t),
}));

describe("ReportBarChart", () => {
  const mockData: SimpleChartDataPoint[] = [
    { id: "a", name: "Category A", value: 30, formattedValue: "30" },
    { id: "b", name: "Category B", value: 50, formattedValue: "50", color: "#ef4444" },
    { id: "c", name: "Category C", value: 20, formattedValue: "20", color: "#22c55e" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders SVG element without crashing", () => {
    const { container } = render(<ReportBarChart data={mockData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with empty data array without crashing", () => {
    const { container } = render(<ReportBarChart data={[]} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with single data point", () => {
    const singlePoint: SimpleChartDataPoint[] = [
      { id: "x", name: "Single", value: 42, formattedValue: "42" },
    ];
    const { container } = render(<ReportBarChart data={singlePoint} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with multiple data points", () => {
    const { container } = render(<ReportBarChart data={mockData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("SVG has correct dimensions from useResponsiveSVG hook", () => {
    const { container } = render(<ReportBarChart data={mockData} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "400");
    expect(svg).toHaveAttribute("height", "300");
  });

  it("renders container with 100% width", () => {
    const { container } = render(<ReportBarChart data={mockData} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe("100%");
  });

  it("renders with data containing zero values", () => {
    const zeroData: SimpleChartDataPoint[] = [
      { id: "z", name: "Zero", value: 0, formattedValue: "0" },
      { id: "p", name: "Positive", value: 10, formattedValue: "10" },
    ];
    const { container } = render(<ReportBarChart data={zeroData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
