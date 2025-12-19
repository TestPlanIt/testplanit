import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TestRunResultsDonut, {
  TestRunResultStatusItem,
} from "./TestRunResultsDonut";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) => {
    if (params) {
      return `${key}: ${JSON.stringify(params)}`;
    }
    return key;
  },
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
    attrTween: vi.fn().mockReturnThis(),
    html: vi.fn().mockReturnThis(),
    text: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    node: vi.fn(() => ({
      getBBox: () => ({ x: 0, y: 0, width: 50, height: 20 }),
    })),
  })),
  pie: vi.fn(() => {
    const fn = vi.fn((data) => data.map((d: any, i: number) => ({
      data: d,
      value: d.value,
      index: i,
      startAngle: 0,
      endAngle: Math.PI * 2,
      padAngle: 0,
    })));
    fn.value = vi.fn().mockReturnThis();
    fn.sort = vi.fn().mockReturnThis();
    return fn;
  }),
  arc: vi.fn(() => {
    const fn = vi.fn(() => "M0,0");
    fn.innerRadius = vi.fn().mockReturnThis();
    fn.outerRadius = vi.fn().mockReturnThis();
    fn.centroid = vi.fn(() => [0, 0]);
    return fn;
  }),
  sum: vi.fn((arr: any[], accessor: (d: any) => number) =>
    arr.reduce((sum, d) => sum + accessor(d), 0)
  ),
  interpolate: vi.fn(() => (t: number) => ({ startAngle: 0, endAngle: t * Math.PI * 2 })),
  easeBackOut: { overshoot: vi.fn(() => (t: number) => t) },
  easeQuadOut: vi.fn((t: number) => t),
}));

describe("TestRunResultsDonut", () => {
  const mockData: TestRunResultStatusItem[] = [
    { id: "passed", name: "Passed", value: 45, color: "#22c55e" },
    { id: "failed", name: "Failed", value: 10, color: "#ef4444" },
    { id: "skipped", name: "Skipped", value: 5, color: "#f59e0b" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing", () => {
    const { container } = render(<TestRunResultsDonut data={mockData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with empty data", () => {
    const { container } = render(<TestRunResultsDonut data={[]} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("applies default height when not zoomed", () => {
    const { container } = render(<TestRunResultsDonut data={mockData} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.minHeight).toBe("180px");
    expect(wrapper.style.maxHeight).toBe("180px");
  });

  it("applies zoomed height when isZoomed is true", () => {
    const { container } = render(
      <TestRunResultsDonut data={mockData} isZoomed={true} />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.minHeight).toBe("600px");
    expect(wrapper.style.maxHeight).toBe("600px");
  });

  it("applies custom height when provided", () => {
    const { container } = render(
      <TestRunResultsDonut data={mockData} height={400} />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.minHeight).toBe("400px");
    expect(wrapper.style.maxHeight).toBe("400px");
  });

  it("renders container with correct positioning", () => {
    const { container } = render(<TestRunResultsDonut data={mockData} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.position).toBe("relative");
    expect(wrapper.style.width).toBe("100%");
  });

  it("handles single data item", () => {
    const singleData: TestRunResultStatusItem[] = [
      { id: "passed", name: "Passed", value: 100, color: "#22c55e" },
    ];

    const { container } = render(<TestRunResultsDonut data={singleData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("handles data with zero values", () => {
    const zeroData: TestRunResultStatusItem[] = [
      { id: "passed", name: "Passed", value: 0, color: "#22c55e" },
      { id: "failed", name: "Failed", value: 0, color: "#ef4444" },
    ];

    const { container } = render(<TestRunResultsDonut data={zeroData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("handles data with large values", () => {
    const largeData: TestRunResultStatusItem[] = [
      { id: "passed", name: "Passed", value: 1000000, color: "#22c55e" },
      { id: "failed", name: "Failed", value: 500000, color: "#ef4444" },
    ];

    const { container } = render(<TestRunResultsDonut data={largeData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders SVG with correct dimensions from hook", () => {
    const { container } = render(<TestRunResultsDonut data={mockData} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "400");
    expect(svg).toHaveAttribute("height", "300");
  });
});
