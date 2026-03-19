import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportSunburstChart, SunburstHierarchyNode } from "./ReportSunburstChart";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

// Mock useResponsiveSVG hook
vi.mock("~/hooks/useResponsiveSVG", () => ({
  default: () => ({ width: 400, height: 300 }),
}));

// Mock duration utility
vi.mock("~/utils/duration", () => ({
  toHumanReadable: (_val: number, _opts?: any) => "1m",
}));

// Mock D3 with chainable mocks, including hierarchy and partition for sunburst
vi.mock("d3", () => {
  const descendants = vi.fn(() => [
    {
      data: { name: "A", id: "a", value: 10, color: "#ff0000" },
      depth: 1,
      value: 10,
      x0: 0, x1: Math.PI,
      y0: 0, y1: 50,
      children: undefined,
      parent: null,
    },
    {
      data: { name: "B", id: "b", value: 20, color: undefined },
      depth: 1,
      value: 20,
      x0: Math.PI, x1: 2 * Math.PI,
      y0: 0, y1: 50,
      children: undefined,
      parent: null,
    },
  ]);

  const hierarchyResult = {
    sum: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    each: vi.fn().mockReturnThis(),
    descendants,
    leaves: vi.fn(() => []),
    value: 30,
    depth: 0,
    x0: 0, x1: 2 * Math.PI,
    y0: 0, y1: 50,
    children: [],
    data: { name: "root", id: "root" },
  };

  const partitionResult = {
    sum: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    each: vi.fn().mockReturnThis(),
    descendants: vi.fn(() => [...hierarchyResult.descendants()]),
    leaves: vi.fn(() => []),
    value: 30,
    x0: 0, x1: 2 * Math.PI,
    y0: 0, y1: 50,
    children: [],
    data: { name: "root", id: "root" },
  };

  const mockArc = vi.fn(() => "M0,0") as any;
  mockArc.startAngle = vi.fn().mockReturnThis();
  mockArc.endAngle = vi.fn().mockReturnThis();
  mockArc.padAngle = vi.fn().mockReturnThis();
  mockArc.padRadius = vi.fn().mockReturnThis();
  mockArc.innerRadius = vi.fn().mockReturnThis();
  mockArc.outerRadius = vi.fn().mockReturnThis();
  mockArc.centroid = vi.fn(() => [0, 0]);

  return {
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
      node: vi.fn(() => ({
        getBBox: () => ({ x: 0, y: 0, width: 50, height: 20 }),
      })),
    })),
    hierarchy: vi.fn(() => hierarchyResult),
    partition: vi.fn(() => {
      const fn = vi.fn(() => partitionResult) as any;
      fn.size = vi.fn().mockReturnThis();
      return fn;
    }),
    arc: vi.fn(() => mockArc),
    scaleOrdinal: vi.fn(() => {
      const fn = vi.fn((_name: string) => "#3b82f6") as any;
      return fn;
    }),
    schemeTableau10: ["#4e79a7", "#f28e2b", "#e15759"],
    easeBackOut: { overshoot: vi.fn(() => (t: number) => t) },
    easeQuadOut: vi.fn((t: number) => t),
  };
});

describe("ReportSunburstChart", () => {
  const mockHierarchyData: SunburstHierarchyNode = {
    name: "root",
    id: "root",
    children: [
      { name: "A", id: "a", value: 10, color: "#ff0000" },
      { name: "B", id: "b", value: 20, color: "#00ff00" },
    ],
  };

  const deepHierarchyData: SunburstHierarchyNode = {
    name: "root",
    id: "root",
    children: [
      {
        name: "Level 1",
        id: "l1",
        children: [
          {
            name: "Level 2",
            id: "l2",
            children: [
              { name: "Leaf", id: "leaf", value: 5 },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders SVG element without crashing with valid hierarchy data", () => {
    const { container } = render(
      <ReportSunburstChart data={mockHierarchyData} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders without crashing when children is empty", () => {
    const emptyData: SunburstHierarchyNode = {
      name: "root",
      id: "root",
      children: [],
    };
    const { container } = render(<ReportSunburstChart data={emptyData} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders without crashing when children is undefined", () => {
    const noChildrenData: SunburstHierarchyNode = {
      name: "single",
      id: "single",
      value: 100,
    };
    const { container } = render(
      <ReportSunburstChart data={noChildrenData} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with deep nested hierarchy (3+ levels)", () => {
    const { container } = render(
      <ReportSunburstChart data={deepHierarchyData} />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with totalValue and totalLabel props", () => {
    const { container } = render(
      <ReportSunburstChart
        data={mockHierarchyData}
        totalValue={30}
        totalLabel="Total"
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders with isTimeBased flag", () => {
    const { container } = render(
      <ReportSunburstChart
        data={mockHierarchyData}
        isTimeBased={true}
        totalValue={3600}
        totalLabel="Average"
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders SVG with correct dimensions from hook", () => {
    const { container } = render(
      <ReportSunburstChart data={mockHierarchyData} />
    );
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "400");
    expect(svg).toHaveAttribute("height", "300");
  });

  it("renders container with relative positioning and 100% width", () => {
    const { container } = render(
      <ReportSunburstChart data={mockHierarchyData} />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.position).toBe("relative");
    expect(wrapper.style.width).toBe("100%");
  });
});
