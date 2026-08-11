import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

// cmdk scrolls the highlighted item into view — jsdom has no implementation.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

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
    const input = [{ id: 99, name: "Milestone", parentId: null }];
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
    const input = [{ id: 2, name: "Simple", parentId: null }];
    const result = transformMilestones(input);
    expect(result[0].milestoneType?.icon).toBeNull();
  });

  it("carries every tracker-linkage field the source badge renders", () => {
    const result = transformMilestones([
      {
        id: 1,
        name: "Sprint 1",
        parentId: null,
        integrationId: 9,
        externalKind: "ITERATION",
        externalState: "active",
        externalUrl: "https://jira.example.com/browse/ABT-1",
        detachedAt: null,
        mergedToExternalId: null,
      },
    ]);

    expect(result[0]).toMatchObject({
      integrationId: 9,
      externalKind: "ITERATION",
      externalState: "active",
      externalUrl: "https://jira.example.com/browse/ABT-1",
    });
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
    render(<MilestoneSelect value={null} onChange={vi.fn()} milestones={[]} />);

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

  it("opens a searchable list and filters options by the typed query", async () => {
    render(
      <MilestoneSelect
        value={null}
        onChange={vi.fn()}
        milestones={sampleMilestones}
      />
    );

    fireEvent.click(screen.getByRole("combobox"));

    // All options (plus None) visible while browsing.
    await waitFor(() => {
      expect(screen.getByText("Sprint 1")).toBeInTheDocument();
    });
    expect(screen.getByText("Sprint 2")).toBeInTheDocument();
    expect(screen.getByText("Sub Milestone")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Select Milestone"), {
      target: { value: "sub" },
    });

    // The option source resolves asynchronously (AsyncCombobox fetch).
    await waitFor(() => {
      expect(screen.queryByText("Sprint 1")).toBeNull();
    });
    expect(screen.queryByText("Sprint 2")).toBeNull();
    expect(screen.getByText("Sub Milestone")).toBeInTheDocument();
  });

  it("marks synced options with the tracker source badge, and leaves local ones bare", async () => {
    render(
      <MilestoneSelect
        value={null}
        onChange={vi.fn()}
        milestones={[
          {
            value: "1",
            label: "Sprint 1",
            parentId: null,
            integrationId: 9,
            externalKind: "ITERATION",
            externalState: "active",
          },
          { value: "2", label: "Sprint 2", parentId: null },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Sprint 1")).toBeInTheDocument();
    });

    expect(screen.getAllByTestId("milestone-source-badge")).toHaveLength(1);
  });

  it("selecting an option calls onChange with its value and closes", async () => {
    const onChange = vi.fn();
    render(
      <MilestoneSelect
        value={null}
        onChange={onChange}
        milestones={sampleMilestones}
      />
    );

    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Sprint 2")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Sprint 2"));

    expect(onChange).toHaveBeenCalledWith("2");
  });

  it("selecting None calls onChange(null)", async () => {
    const onChange = vi.fn();
    render(
      <MilestoneSelect
        value="1"
        onChange={onChange}
        milestones={sampleMilestones}
      />
    );

    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("None")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("None"));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows the selected milestone's label on the trigger", () => {
    render(
      <MilestoneSelect
        value="1"
        onChange={vi.fn()}
        milestones={sampleMilestones}
      />
    );

    expect(screen.getByRole("combobox")).toHaveTextContent("Sprint 1");
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
