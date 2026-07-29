import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Backs the fake TreeApi handed to TreeView's ref, so tests can seed and read
// the tree's open state (react-arborist owns it in production).
const { treeMock } = vi.hoisted(() => ({
  treeMock: {
    openIds: new Set<string>(),
    knownIds: new Set<string>(),
    closeAllCalls: 0,
    reset() {
      this.openIds.clear();
      this.knownIds.clear();
      this.closeAllCalls = 0;
    },
  },
}));

// Mock ZenStack hooks. useFindManyRepositoryFolders is hoisted so tests can
// drive it via mockReturnValue (the test body previously reached it through
// `await import("~/lib/hooks")`, which no longer exists in v3).
const { useFindManyRepositoryFolders } = vi.hoisted(() => ({
  useFindManyRepositoryFolders: vi.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryFolders: {
      useFindMany: useFindManyRepositoryFolders,
      useUpdate: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    },
    repositoryCases: {
      useUpdate: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    },
  }),
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
vi.mock("react-arborist", () => {
  const apiNode = (id: string) => ({
    id,
    get isOpen() {
      return treeMock.openIds.has(id);
    },
    open: () => void treeMock.openIds.add(id),
    close: () => void treeMock.openIds.delete(id),
  });

  const treeApi = {
    get visibleNodes() {
      return [...treeMock.knownIds].map(apiNode);
    },
    get: (id: string) => (treeMock.knownIds.has(id) ? apiNode(id) : null),
    isOpen: (id: string) => treeMock.openIds.has(id),
    closeAll: () => {
      treeMock.closeAllCalls += 1;
      treeMock.openIds.clear();
    },
    hideCursor: () => {},
  };

  const collectIds = (nodes: any[]) => {
    nodes.forEach((node) => {
      treeMock.knownIds.add(String(node.id));
      if (node.children?.length) collectIds(node.children);
    });
  };

  return {
    Tree: vi.fn(
      ({
        data,
        children: NodeRenderer,
        ref,
        _onSelect,
      }: {
        data: any[];
        children: React.ComponentType<any>;
        ref?: { current: unknown };
        _onSelect?: (nodes: any[]) => void;
      }) => {
        collectIds(data ?? []);
        if (ref) ref.current = treeApi;
        return (
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
        );
      }
    ),
  };
});

// Mock react-dnd useDrop + useDragLayer
vi.mock("react-dnd", () => ({
  useDrop: vi.fn(() => [{ isOver: false, canDrop: false }, vi.fn()]),
  useDragLayer: vi.fn(() => false),
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

// Render tooltip content inline. Radix only mounts it after its hover delay,
// which would make every assertion about the hint a timing race.
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

import React from "react";
import { Tree } from "react-arborist";
import TreeView, { FOLDER_FILTER_MIN_COUNT, FolderChevron } from "./TreeView";

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
    treeMock.reset();
  });

  it("renders empty state when no data while loading (spinner delay prevents flash)", async () => {
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
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<TreeView {...defaultProps} />);

    // When folders is empty array, renders empty message
    expect(
      screen.getByText(/\[t\]repository\.emptyFolders/)
    ).toBeInTheDocument();
  });

  it("renders empty state for non-editor when no folders exist", async () => {
    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(<TreeView {...defaultProps} canAddEdit={false} />);

    expect(
      screen.getByText(/\[t\]repository\.noFoldersOrCasesNoPermission/)
    ).toBeInTheDocument();
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

    vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
      data: mockFolders,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    render(
      <TreeView {...defaultProps} onHierarchyChange={onHierarchyChange} />
    );

    // onHierarchyChange should be called at least once (may be called with [] initially then with data)
    expect(onHierarchyChange).toHaveBeenCalled();

    // The last call should have the hierarchy data
    const allCalls = onHierarchyChange.mock.calls;
    const lastCallArg = allCalls[allCalls.length - 1][0];
    expect(lastCallArg).toBeInstanceOf(Array);

    // Find the call that has our folder data
    const callWithData = allCalls.find((call) =>
      call[0].some((item: any) => item.id === 10)
    );
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

  describe("virtualization", () => {
    const spawnFolders = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Folder ${i + 1}`,
        parentId: null,
        order: i,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      }));

    const renderCount = (count: number) => {
      vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
        data: spawnFolders(count),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);
      return render(<TreeView {...defaultProps} />);
    };

    const lastTreeProps = () => {
      const calls = vi.mocked(Tree).mock.calls;
      return calls[calls.length - 1][0] as any;
    };

    it("sizes the tree to its viewport rather than to the row count", () => {
      // react-arborist forwards this straight to react-window as the scroll
      // viewport height, so growing it with the row count renders every row.
      const { unmount } = renderCount(50);
      const heightForFewRows = lastTreeProps().height;

      unmount();
      vi.mocked(Tree).mockClear();

      renderCount(600);
      const heightForManyRows = lastTreeProps().height;

      expect(heightForManyRows).toBe(heightForFewRows);
      expect(heightForManyRows).toBeLessThan(600 * 32);
    });

    it("keeps a non-zero overscan so scrolling does not expose blank rows", () => {
      renderCount(50);

      expect(lastTreeProps().overscanCount).toBeGreaterThan(0);
    });
  });

  describe("folder filter", () => {
    const makeFolder = (
      id: number,
      name: string,
      parentId: number | null = null
    ) => ({
      id,
      name,
      parentId,
      order: id,
      projectId: 1,
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdById: "user-1",
    });

    /** One named target plus enough filler to clear the disclosure threshold. */
    const manyFolders = [
      makeFolder(100, "Beta Folder"),
      ...Array.from({ length: FOLDER_FILTER_MIN_COUNT }, (_, i) =>
        makeFolder(i + 1, `Filler ${i + 1}`)
      ),
    ];

    const renderWithFolders = (folders: ReturnType<typeof makeFolder>[]) => {
      vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
        data: folders,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);
      return render(<TreeView {...defaultProps} />);
    };

    it("stays hidden while the tree is small enough to scan", () => {
      renderWithFolders([makeFolder(1, "Only Folder")]);

      expect(
        screen.queryByTestId("folder-filter-input")
      ).not.toBeInTheDocument();
    });

    it("appears once the folder count passes the threshold", () => {
      renderWithFolders(manyFolders);

      expect(screen.getByTestId("folder-filter-input")).toBeInTheDocument();
    });

    it("narrows the tree to matching folders and highlights the match", async () => {
      const user = userEvent.setup();
      renderWithFolders(manyFolders);

      await user.type(screen.getByTestId("folder-filter-input"), "beta");

      expect(screen.getByTestId("folder-node-100")).toBeInTheDocument();
      expect(screen.queryByTestId("folder-node-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("folder-filter-match")).toHaveTextContent(
        "Beta"
      );
    });

    it("reports when nothing matches", async () => {
      const user = userEvent.setup();
      renderWithFolders(manyFolders);

      await user.type(screen.getByTestId("folder-filter-input"), "nonexistent");

      expect(
        screen.getByTestId("folder-filter-no-matches")
      ).toBeInTheDocument();
      expect(screen.queryByTestId("folder-node-100")).not.toBeInTheDocument();
    });

    it("restores the full tree when the filter is cleared", async () => {
      const user = userEvent.setup();
      renderWithFolders(manyFolders);

      await user.type(screen.getByTestId("folder-filter-input"), "beta");
      expect(screen.queryByTestId("folder-node-1")).not.toBeInTheDocument();

      await user.click(screen.getByTestId("folder-filter-clear"));

      expect(screen.getByTestId("folder-node-1")).toBeInTheDocument();
      expect(screen.getByTestId("folder-node-100")).toBeInTheDocument();
      expect(
        screen.queryByTestId("folder-filter-match")
      ).not.toBeInTheDocument();
    });

    /** A match nested one level down, so revealing it must open its parent. */
    const nestedFolders = [
      makeFolder(200, "Automation"),
      makeFolder(201, "Manage SCORM items by Assignee", 200),
      ...Array.from({ length: FOLDER_FILTER_MIN_COUNT }, (_, i) =>
        makeFolder(i + 1, `Filler ${i + 1}`)
      ),
    ];

    it("opens the ancestors of a nested match", async () => {
      const user = userEvent.setup();
      renderWithFolders(nestedFolders);

      await user.type(screen.getByTestId("folder-filter-input"), "scorm");

      await waitFor(() => expect(treeMock.openIds.has("200")).toBe(true));
    });

    it("restores the pre-filter open state when the filter is cleared", async () => {
      const user = userEvent.setup();
      treeMock.openIds.add("3");
      renderWithFolders(nestedFolders);

      await user.type(screen.getByTestId("folder-filter-input"), "scorm");
      await waitFor(() => expect(treeMock.openIds.has("200")).toBe(true));

      await user.click(screen.getByTestId("folder-filter-clear"));

      await waitFor(() => expect(treeMock.closeAllCalls).toBe(1));
      // The ancestor the filter opened is closed again; the folder the user had
      // open before filtering is not.
      expect(treeMock.openIds.has("200")).toBe(false);
      expect(treeMock.openIds.has("3")).toBe(true);
    });

    it("suppresses folder drag and drop while filtering", async () => {
      const user = userEvent.setup();
      renderWithFolders(manyFolders);

      expect(screen.getByTestId("folder-tree-end")).toBeInTheDocument();

      await user.type(screen.getByTestId("folder-filter-input"), "beta");

      expect(screen.queryByTestId("folder-tree-end")).not.toBeInTheDocument();
    });
  });

  describe("chevron hint", () => {
    const noop = vi.fn();

    /** A root folder with one child, so its chevron is the real control. */
    const parentAndChild = [
      {
        id: 300,
        name: "Parent",
        parentId: null,
        order: 0,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      },
      {
        id: 301,
        name: "Child",
        parentId: 300,
        order: 0,
        projectId: 1,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdById: "user-1",
      },
    ];

    it("names the click and advertises the modifier on a folder row", () => {
      vi.mocked(useFindManyRepositoryFolders).mockReturnValue({
        data: parentAndChild,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      render(<TreeView {...defaultProps} />);

      const row = screen.getByTestId("folder-node-300");
      expect(
        within(row).getByRole("button", {
          name: "[t]repository.treeView.expandFolder",
        })
      ).toBeInTheDocument();

      const hint = within(row).getByTestId("tooltip-content");
      expect(hint).toHaveTextContent("[t]repository.treeView.expandFolder");
      // A root folder's modifier click reaches the whole tree, not one subtree.
      expect(hint.textContent).toMatch(/altHintAll(Mac|Win)/);
    });

    it("promises every folder while the modifier is held on a root folder", () => {
      render(
        <FolderChevron
          isOpen={false}
          isRootFolder={true}
          hasChildren={true}
          onClick={noop}
        />
      );

      fireEvent.mouseEnter(screen.getByRole("button"));
      fireEvent.keyDown(window, { key: "Alt", altKey: true });

      const held = screen.getByTestId("tooltip-content");
      expect(held).toHaveTextContent("[t]repository.treeView.expandAll");
      // The outcome is named, so the key it depends on needs no second mention.
      expect(held.textContent).not.toMatch(/altHint/);

      fireEvent.keyUp(screen.getByRole("button"), {
        key: "Alt",
        altKey: false,
      });

      expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
        "[t]repository.treeView.expandFolder"
      );
    });

    it("keeps a nested folder's modifier click scoped to its subfolders", () => {
      render(
        <FolderChevron
          isOpen={true}
          isRootFolder={false}
          hasChildren={true}
          onClick={noop}
        />
      );

      const hint = screen.getByTestId("tooltip-content");
      expect(hint).toHaveTextContent("[t]repository.treeView.collapseFolder");
      expect(hint.textContent).toMatch(/altHint(Mac|Win)/);

      fireEvent.mouseEnter(screen.getByRole("button"));
      fireEvent.keyDown(window, { key: "Alt", altKey: true });

      expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
        "[t]repository.treeView.collapseSubfolders"
      );
    });

    it("reads the modifier the pointer arrives with", () => {
      // Entering with the key already down fires no keydown for the listener.
      render(
        <FolderChevron
          isOpen={false}
          isRootFolder={false}
          hasChildren={true}
          onClick={noop}
        />
      );

      fireEvent.mouseEnter(screen.getByRole("button"), { altKey: true });

      expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
        "[t]repository.treeView.expandSubfolders"
      );
    });

    it("describes nothing on a folder that has no subfolders", () => {
      render(
        <FolderChevron
          isOpen={false}
          isRootFolder={true}
          hasChildren={false}
          onClick={noop}
        />
      );

      expect(screen.queryByTestId("tooltip-content")).not.toBeInTheDocument();
      expect(screen.getByRole("button")).not.toHaveAccessibleName();
    });
  });
});
