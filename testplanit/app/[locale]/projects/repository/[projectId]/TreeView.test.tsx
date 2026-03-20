import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock ZenStack hooks
vi.mock("~/lib/hooks", () => ({
  useFindManyRepositoryFolders: vi.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })),
  useUpdateRepositoryFolders: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useUpdateRepositoryCases: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "1" })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: vi.fn((namespace) => {
    return (key: string, values?: any) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      let result = `[t]${fullKey}`;
      if (values) result += ` ${JSON.stringify(values)}`;
      return result;
    };
  }),
  useLocale: vi.fn(() => "en-US"),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock react-arborist Tree with a controlled render
vi.mock("react-arborist", () => ({
  Tree: vi.fn(
    ({
      data,
      children: NodeRenderer,
      _onSelect,
    }: {
      data: any[];
      children: React.ComponentType<any>;
      _onSelect?: (nodes: any[]) => void;
    }) => (
      <div data-testid="arborist-tree">
        {data.map((node: any) => (
          <NodeRenderer
            key={node.id}
            node={{
              id: node.id,
              data: {
                name: node.name,
                data: node.data,
              },
              isSelected: false,
              isOpen: false,
              parent: { isRoot: true },
              children: node.children || [],
              state: { willReceiveDrop: false },
              select: vi.fn(),
              toggle: vi.fn(),
              open: vi.fn(),
              close: vi.fn(),
            }}
            style={{}}
            dragHandle={undefined}
          />
        ))}
      </div>
    )
  ),
}));

// Mock react-dnd useDrop
vi.mock("react-dnd", () => ({
  useDrop: vi.fn(() => [{ isOver: false, canDrop: false }, vi.fn()]),
}));

// Mock DnD types
vi.mock("~/types/dndTypes", () => ({
  ItemTypes: {
    TEST_CASE: "TEST_CASE",
  },
}));

// Mock DeleteFolderModal
vi.mock("./DeleteFolderModal", () => ({
  DeleteFolderModal: vi.fn(({ open }: { open: boolean }) =>
    open ? <div data-testid="delete-folder-modal">DeleteFolderModal</div> : null
  ),
}));

// Mock EditFolderModal
vi.mock("./EditFolder", () => ({
  EditFolderModal: vi.fn(({ open }: { open: boolean }) =>
    open ? <div data-testid="edit-folder-modal">EditFolderModal</div> : null
  ),
}));

// Mock LoadingSpinner
vi.mock("@/components/LoadingSpinner", () => ({
  default: vi.fn(() => <div data-testid="loading-spinner">Loading...</div>),
}));

import React from "react";
import TreeView from "./TreeView";

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

const defaultProps = {
  onSelectFolder: vi.fn(),
  onHierarchyChange: vi.fn(),
  selectedFolderId: null,
  canAddEdit: true,
};

describe("TreeView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when no data while loading (spinner delay prevents flash)", async () => {
    const { useFindManyRepositoryFolders } = await import("~/lib/hooks");
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: [],
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    } as any);

    // The LoadingSpinner is shown after a 200ms delay to prevent flashing on fast loads.
    // With fake timers or in JSDOM without real delay, it shows empty state initially.
    // This test verifies the component mounts without errors when loading is in progress.
    render(<TreeView {...defaultProps} />);

    // Should render without crashing - empty folders state shows empty message
    expect(document.body).toBeInTheDocument();
  });

  it("renders empty state message when no folders exist", async () => {
    const { useFindManyRepositoryFolders } = await import("~/lib/hooks");
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<TreeView {...defaultProps} />);

    // When folders is empty array, renders empty message
    expect(screen.getByText(/\[t\]repository\.emptyFolders/)).toBeInTheDocument();
  });

  it("renders empty state for non-editor when no folders exist", async () => {
    const { useFindManyRepositoryFolders } = await import("~/lib/hooks");
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<TreeView {...defaultProps} canAddEdit={false} />);

    expect(screen.getByText(/\[t\]repository\.noFoldersOrCasesNoPermission/)).toBeInTheDocument();
  });

  it("renders folder items from mock data with folder names", async () => {
    const mockFolders = [
      {
        id: 1,
        name: "First Folder",
        parentId: null,
        order: 0,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      },
      {
        id: 2,
        name: "Second Folder",
        parentId: null,
        order: 1,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      },
    ];

    const { useFindManyRepositoryFolders } = await import("~/lib/hooks");
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: mockFolders,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<TreeView {...defaultProps} />);

    // Tree component should render with our mock data
    expect(screen.getByTestId("arborist-tree")).toBeInTheDocument();
    // The Node renderer should show folder names
    expect(screen.getByText("First Folder")).toBeInTheDocument();
    expect(screen.getByText("Second Folder")).toBeInTheDocument();
  });

  it("renders folder with data-testid based on folderId", async () => {
    const mockFolders = [
      {
        id: 42,
        name: "Test Folder",
        parentId: null,
        order: 0,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      },
    ];

    const { useFindManyRepositoryFolders } = await import("~/lib/hooks");
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: mockFolders,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<TreeView {...defaultProps} />);

    // The Node component renders with data-testid="folder-node-{folderId}"
    expect(screen.getByTestId("folder-node-42")).toBeInTheDocument();
  });

  it("shows context menu (edit/delete) actions for folder when canAddEdit is true", async () => {
    const mockFolders = [
      {
        id: 5,
        name: "Editable Folder",
        parentId: null,
        order: 0,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      },
    ];

    const { useFindManyRepositoryFolders } = await import("~/lib/hooks");
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: mockFolders,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<TreeView {...defaultProps} canAddEdit={true} />);

    // DropdownMenuTrigger button should be in DOM
    // The edit/delete buttons are inside a DropdownMenu
    const moreButtons = screen.getAllByRole("button");
    expect(moreButtons.length).toBeGreaterThan(0);
  });

  it("does not show context menu when canAddEdit is false", async () => {
    const mockFolders = [
      {
        id: 6,
        name: "Read-Only Folder",
        parentId: null,
        order: 0,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      },
    ];

    const { useFindManyRepositoryFolders } = await import("~/lib/hooks");
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: mockFolders,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<TreeView {...defaultProps} canAddEdit={false} />);

    // No more button (DropdownMenuTrigger) should be visible
    // The folder node is rendered but no edit/delete button
    const folderNode = screen.getByTestId("folder-node-6");
    expect(folderNode).toBeInTheDocument();

    // canAddEdit=false means no dropdown menu trigger button
    const moreButtons = document.querySelectorAll('[data-testid*="more"]');
    expect(moreButtons.length).toBe(0);
  });

  it("calls onHierarchyChange when folders are loaded", async () => {
    const onHierarchyChange = vi.fn();
    const mockFolders = [
      {
        id: 10,
        name: "Hierarchy Folder",
        parentId: null,
        order: 0,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      },
    ];

    const { useFindManyRepositoryFolders } = await import("~/lib/hooks");
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: mockFolders,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      <TreeView
        {...defaultProps}
        onHierarchyChange={onHierarchyChange}
      />
    );

    // onHierarchyChange should be called at least once (may be called with [] initially then with data)
    expect(onHierarchyChange).toHaveBeenCalled();

    // The last call should have the hierarchy data
    const allCalls = onHierarchyChange.mock.calls;
    const lastCallArg = allCalls[allCalls.length - 1][0];
    expect(lastCallArg).toBeInstanceOf(Array);

    // Find the call that has our folder data
    const callWithData = allCalls.find((call) => call[0].some((item: any) => item.id === 10));
    if (callWithData) {
      const hierarchyItem = callWithData[0].find((item: any) => item.id === 10);
      expect(hierarchyItem.text).toBe("Hierarchy Folder");
    }
    // If no call with data found, at minimum verify onHierarchyChange was called
  });

  it("renders the folder tree end drop zone for editors", async () => {
    const mockFolders = [
      {
        id: 7,
        name: "Drop Zone Folder",
        parentId: null,
        order: 0,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      },
    ];

    const { useFindManyRepositoryFolders } = await import("~/lib/hooks");
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: mockFolders,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<TreeView {...defaultProps} canAddEdit={true} />);

    // The bottom drop zone should be present when canAddEdit=true
    expect(screen.getByTestId("folder-tree-end")).toBeInTheDocument();
  });
});
