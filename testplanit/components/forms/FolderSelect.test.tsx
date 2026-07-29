import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    const map: Record<string, string> = {
      "common.loading": "Loading...",
      "repository.cases.selectFolder": "Select Folder",
      "repository.emptyFolders": "No folders available",
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

import {
  filterFolderOptions,
  flattenFolderOptions,
  FolderSelect,
  transformFolders,
} from "./FolderSelect";

describe("transformFolders utility", () => {
  it("transforms folders array to FolderSelectOption format", () => {
    const input = [
      { id: 1, name: "Root Folder", parentId: null },
      { id: 2, name: "Sub Folder", parentId: 1 },
    ];

    const result = transformFolders(input);

    expect(result).toEqual([
      { value: "1", label: "Root Folder", parentId: null },
      { value: "2", label: "Sub Folder", parentId: 1 },
    ]);
  });

  it("returns empty array for empty input", () => {
    const result = transformFolders([]);
    expect(result).toEqual([]);
  });

  it("handles null/undefined gracefully", () => {
    const result = transformFolders(null as any);
    expect(result).toEqual([]);
  });

  it("converts numeric id to string value", () => {
    const input = [{ id: 42, name: "My Folder", parentId: null }];
    const result = transformFolders(input);
    expect(result[0].value).toBe("42");
    expect(typeof result[0].value).toBe("string");
  });

  it("preserves parentId as null for root folders", () => {
    const input = [{ id: 1, name: "Root", parentId: null }];
    const result = transformFolders(input);
    expect(result[0].parentId).toBeNull();
  });

  it("preserves numeric parentId for nested folders", () => {
    const input = [{ id: 5, name: "Child", parentId: 3 }];
    const result = transformFolders(input);
    expect(result[0].parentId).toBe(3);
  });
});

describe("FolderSelect", () => {
  const sampleFolders = [
    { value: "1", label: "Folder A", parentId: null },
    { value: "2", label: "Folder B", parentId: null },
    { value: "3", label: "Sub Folder", parentId: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the select trigger", () => {
    render(
      <FolderSelect value={null} onChange={vi.fn()} folders={sampleFolders} />
    );

    // Radix Select renders a button with role="combobox"
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeInTheDocument();
  });

  it("displays the placeholder when no value is selected", () => {
    render(
      <FolderSelect
        value={null}
        onChange={vi.fn()}
        folders={sampleFolders}
        placeholder="Pick a folder"
      />
    );

    expect(screen.getByText("Pick a folder")).toBeInTheDocument();
  });

  it("uses translation default placeholder when no placeholder prop", () => {
    render(
      <FolderSelect value={null} onChange={vi.fn()} folders={sampleFolders} />
    );

    // Translation key "repository.cases.selectFolder" maps to "Select Folder" in test map
    expect(screen.getByText("Select Folder")).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <FolderSelect
        value={null}
        onChange={vi.fn()}
        folders={sampleFolders}
        disabled={true}
      />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
  });

  it("is disabled when folders array is empty", () => {
    render(<FolderSelect value={null} onChange={vi.fn()} folders={[]} />);

    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
  });

  it("is disabled when isLoading is true", () => {
    render(
      <FolderSelect
        value={null}
        onChange={vi.fn()}
        folders={sampleFolders}
        isLoading={true}
      />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
  });

  it("is not disabled when folders are provided and not loading", () => {
    render(
      <FolderSelect
        value={null}
        onChange={vi.fn()}
        folders={sampleFolders}
        disabled={false}
        isLoading={false}
      />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).not.toBeDisabled();
  });

  /** paddingInlineStart is level * 10 + 5, matching the tree's indentation. */
  const indentOf = (label: string) =>
    screen.getByText(label).parentElement?.style.paddingInlineStart;

  it("indents options by their depth in the hierarchy", async () => {
    render(
      <FolderSelect value={null} onChange={vi.fn()} folders={sampleFolders} />
    );

    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Folder A")).toBeInTheDocument();
    });

    expect(indentOf("Folder A")).toBe("5px");
    expect(indentOf("Folder B")).toBe("5px");
    expect(indentOf("Sub Folder")).toBe("15px");
  });

  it("filters by name and keeps the match's ancestors for context", async () => {
    render(
      <FolderSelect value={null} onChange={vi.fn()} folders={sampleFolders} />
    );

    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Folder B")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Select Folder"), {
      target: { value: "sub" },
    });

    await waitFor(() => {
      expect(screen.queryByText("Folder B")).toBeNull();
    });
    expect(screen.getByText("Sub Folder")).toBeInTheDocument();
    // Folder A is not a match; it stays so the indentation still reads.
    expect(screen.getByText("Folder A")).toBeInTheDocument();
    expect(indentOf("Sub Folder")).toBe("15px");
  });

  it("selecting a folder reports its id", async () => {
    const onChange = vi.fn();
    render(
      <FolderSelect value={null} onChange={onChange} folders={sampleFolders} />
    );

    fireEvent.click(screen.getByRole("combobox"));
    await waitFor(() => {
      expect(screen.getByText("Sub Folder")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Sub Folder"));

    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("shows the selected folder on the trigger without indentation", () => {
    render(
      <FolderSelect value="3" onChange={vi.fn()} folders={sampleFolders} />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Sub Folder");
    expect(indentOf("Sub Folder")).toBeFalsy();
  });
});

describe("flattenFolderOptions", () => {
  it("orders depth-first and records each folder's depth", () => {
    const flat = flattenFolderOptions([
      { value: "1", label: "A", parentId: null },
      { value: "2", label: "B", parentId: null },
      { value: "3", label: "A child", parentId: 1 },
      { value: "4", label: "A grandchild", parentId: 3 },
    ]);

    expect(flat.map((o) => [o.label, o.level])).toEqual([
      ["A", 0],
      ["A child", 1],
      ["A grandchild", 2],
      ["B", 0],
    ]);
  });

  it("keeps folders whose parent is absent from the list", () => {
    const flat = flattenFolderOptions([
      { value: "1", label: "Root", parentId: null },
      { value: "9", label: "Orphan", parentId: 404 },
    ]);

    expect(flat.map((o) => o.label)).toEqual(["Root", "Orphan"]);
    expect(flat.find((o) => o.label === "Orphan")?.level).toBe(0);
  });

  it("keeps a non-numeric sentinel option and its root placement", () => {
    const flat = flattenFolderOptions([
      { value: "__new__", label: "Create new folder", parentId: null },
      { value: "1", label: "Root", parentId: null },
    ]);

    expect(flat.map((o) => o.label)).toEqual(["Create new folder", "Root"]);
  });
});

describe("filterFolderOptions", () => {
  const flat = flattenFolderOptions([
    { value: "1", label: "Automation", parentId: null },
    { value: "2", label: "Manage SCORM", parentId: 1 },
    { value: "3", label: "Reporting", parentId: null },
  ]);

  it("returns everything for a blank query", () => {
    expect(filterFolderOptions(flat, "   ")).toHaveLength(3);
  });

  it("keeps matches with their ancestors, in hierarchy order", () => {
    expect(filterFolderOptions(flat, "scorm").map((o) => o.label)).toEqual([
      "Automation",
      "Manage SCORM",
    ]);
  });

  it("matches case-insensitively", () => {
    expect(filterFolderOptions(flat, "REPORT").map((o) => o.label)).toEqual([
      "Reporting",
    ]);
  });

  it("returns nothing when no name matches", () => {
    expect(filterFolderOptions(flat, "nonexistent")).toEqual([]);
  });
});
