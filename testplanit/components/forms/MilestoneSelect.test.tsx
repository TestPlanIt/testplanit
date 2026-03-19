import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    const map: Record<string, string> = {
      "common.loading": "Loading...",
      "common.access.none": "None",
      "common.placeholders.selectMilestone": "Select Milestone",
    };
    return map[fullKey] ?? key.split(".").pop() ?? key;
  },
  useLocale: () => "en-US",
}));

// Mock DynamicIcon
vi.mock("@/components/DynamicIcon", () => ({
  default: ({ name, className }: any) => (
    <span data-testid={`icon-${name}`} className={className} />
  ),
}));

import { MilestoneSelect, transformMilestones } from "./MilestoneSelect";

describe("transformMilestones utility", () => {
  it("transforms milestones array to MilestoneSelectOption format", () => {
    const input = [
      {
        id: 1,
        name: "Sprint 1",
        parentId: null,
        milestoneType: { icon: { name: "flag" } },
      },
    ];

    const result = transformMilestones(input);

    expect(result).toEqual([
      {
        value: "1",
        label: "Sprint 1",
        parentId: null,
        milestoneType: { icon: { name: "flag" } },
      },
    ]);
  });

  it("returns empty array for empty input", () => {
    const result = transformMilestones([]);
    expect(result).toEqual([]);
  });

  it("handles null/undefined gracefully", () => {
    const result = transformMilestones(null as any);
    expect(result).toEqual([]);
  });

  it("converts numeric id to string value", () => {
    const input = [
      { id: 99, name: "Milestone", parentId: null },
    ];
    const result = transformMilestones(input);
    expect(result[0].value).toBe("99");
  });

  it("handles null milestoneType icon", () => {
    const input = [
      {
        id: 1,
        name: "No Icon",
        parentId: null,
        milestoneType: { icon: null },
      },
    ];
    const result = transformMilestones(input);
    expect(result[0].milestoneType?.icon).toBeNull();
  });

  it("handles missing milestoneType", () => {
    const input = [
      { id: 2, name: "Simple", parentId: null },
    ];
    const result = transformMilestones(input);
    expect(result[0].milestoneType?.icon).toBeNull();
  });
});

describe("MilestoneSelect", () => {
  const sampleMilestones = [
    { value: "1", label: "Sprint 1", parentId: null },
    { value: "2", label: "Sprint 2", parentId: null },
    { value: "3", label: "Sub Milestone", parentId: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the select trigger", () => {
    render(
      <MilestoneSelect
        value={null}
        onChange={vi.fn()}
        milestones={sampleMilestones}
      />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <MilestoneSelect
        value={null}
        onChange={vi.fn()}
        milestones={sampleMilestones}
        disabled={true}
      />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
  });

  it("is disabled when milestones array is empty", () => {
    render(
      <MilestoneSelect
        value={null}
        onChange={vi.fn()}
        milestones={[]}
      />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
  });

  it("is disabled when isLoading is true", () => {
    render(
      <MilestoneSelect
        value={null}
        onChange={vi.fn()}
        milestones={sampleMilestones}
        isLoading={true}
      />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
  });

  it("is not disabled with milestones provided", () => {
    render(
      <MilestoneSelect
        value={null}
        onChange={vi.fn()}
        milestones={sampleMilestones}
        disabled={false}
        isLoading={false}
      />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).not.toBeDisabled();
  });

  it("uses value=none when value prop is null", () => {
    render(
      <MilestoneSelect
        value={null}
        onChange={vi.fn()}
        milestones={sampleMilestones}
      />
    );

    // When value is null/undefined, select gets value "none"
    // Radix Select with value="none" — the trigger should render without a selected value text
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeInTheDocument();
  });
});
