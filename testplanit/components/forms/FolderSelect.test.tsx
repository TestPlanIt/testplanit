import { render, screen } from "@testing-library/react";
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

import { FolderSelect, transformFolders } from "./FolderSelect";

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
      <FolderSelect
        value={null}
        onChange={vi.fn()}
        folders={sampleFolders}
      />
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
      <FolderSelect
        value={null}
        onChange={vi.fn()}
        folders={sampleFolders}
      />
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
    render(
      <FolderSelect
        value={null}
        onChange={vi.fn()}
        folders={[]}
      />
    );

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
});
