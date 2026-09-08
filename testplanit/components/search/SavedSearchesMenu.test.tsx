import { beforeEach, describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor, within } from "~/test/test-utils";
import { SearchableEntityType } from "~/types/search";

import { SavedSearchesMenu } from "./SavedSearchesMenu";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateShareLink: vi.fn(),
  refetch: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    shareLink: {
      useFindMany: (...args: unknown[]) => mocks.findMany(...args),
      useUpdate: () => ({
        mutateAsync: mocks.updateShareLink,
        isPending: false,
      }),
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

// The save flow has its own test; stub it so this suite doesn't pull in the
// create hooks/session, and we can assert it opens.
vi.mock("./SaveSearchDialog", () => ({
  SaveSearchDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="save-dialog-mock" /> : null,
}));

// The global next-intl mock (vitest.setup.tsx) uses a hand-pasted message
// subset that predates these keys; resolve against the real en-US catalog so
// labels render as shipped.
vi.mock("next-intl", async () => {
  const messages = (await import("../../messages/en-US.json")).default;
  const get = (k: string) =>
    k
      .split(".")
      .reduce<any>((acc, part) => (acc ? acc[part] : undefined), messages);
  return {
    useTranslations: () => (key: string, params?: Record<string, unknown>) => {
      let msg = get(key);
      if (typeof msg !== "string") return key;
      if (params) {
        for (const [p, v] of Object.entries(params)) {
          msg = msg.split(`{${p}}`).join(String(v));
        }
      }
      return msg;
    },
  };
});

// Radix Popover relies on pointer-capture APIs jsdom lacks; render its parts
// inline so the menu is always present for assertions.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

const criteria = {
  query: "q-current",
  selectedEntities: [SearchableEntityType.TEST_RUN],
  currentProjectOnly: false,
  filters: {},
};

const validConfig = {
  version: 1,
  query: "q-alpha",
  selectedEntities: [SearchableEntityType.TEST_RUN],
  currentProjectOnly: false,
  filters: { testRun: { isCompleted: true } },
};

function renderMenu(
  props: Partial<React.ComponentProps<typeof SavedSearchesMenu>> = {}
) {
  return render(
    <SavedSearchesMenu
      criteria={criteria}
      canSave
      onLoad={vi.fn()}
      {...props}
    />
  );
}

function mockSavedSearches(
  items: Array<{
    id: string;
    title: string | null;
    description: string | null;
    entityConfig: unknown;
  }>
) {
  mocks.findMany.mockReturnValue({
    data: items,
    isLoading: false,
    refetch: mocks.refetch,
  });
}

describe("SavedSearchesMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateShareLink.mockResolvedValue(undefined);
  });

  it("shows Save search first and an empty state with no saved searches", () => {
    mockSavedSearches([]);
    renderMenu();
    expect(screen.getByTestId("save-search-button")).toBeEnabled();
    expect(screen.getByText("No saved searches yet")).toBeInTheDocument();
  });

  it("disables Save search when there is nothing to save", () => {
    mockSavedSearches([]);
    renderMenu({ canSave: false });
    expect(screen.getByTestId("save-search-button")).toBeDisabled();
  });

  it("opens the save dialog from the Save search option", () => {
    mockSavedSearches([]);
    renderMenu();
    expect(screen.queryByTestId("save-dialog-mock")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("save-search-button"));
    expect(screen.getByTestId("save-dialog-mock")).toBeInTheDocument();
  });

  it("queries only the viewer's SEARCH shares", () => {
    mockSavedSearches([]);
    renderMenu();
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      entityType: "SEARCH",
      isDeleted: false,
      isRevoked: false,
    });
  });

  it("loads a saved search by parsing its entityConfig into criteria", () => {
    const onLoad = vi.fn();
    mockSavedSearches([
      {
        id: "a",
        title: "Alpha",
        description: "desc",
        entityConfig: validConfig,
      },
    ]);
    renderMenu({ onLoad });

    fireEvent.click(screen.getByText("Alpha"));

    expect(onLoad).toHaveBeenCalledTimes(1);
    const loaded = onLoad.mock.calls[0][0];
    expect(loaded.query).toBe("q-alpha");
    expect(loaded.selectedEntities).toEqual([SearchableEntityType.TEST_RUN]);
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it("surfaces an error and skips onLoad for a corrupt saved search", () => {
    const onLoad = vi.fn();
    mockSavedSearches([
      {
        id: "b",
        title: "Bad",
        description: null,
        entityConfig: { version: 99 },
      },
    ]);
    renderMenu({ onLoad });

    fireEvent.click(screen.getByText("Bad"));

    expect(onLoad).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalled();
  });

  it("edits a saved search's name and description", async () => {
    mockSavedSearches([
      {
        id: "a",
        title: "Alpha",
        description: "old desc",
        entityConfig: validConfig,
      },
    ]);
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const nameInput = await screen.findByTestId("saved-search-edit-name-input");
    const descInput = screen.getByTestId("saved-search-edit-description-input");
    expect(nameInput).toHaveValue("Alpha");
    expect(descInput).toHaveValue("old desc");

    fireEvent.change(nameInput, { target: { value: "Alpha v2" } });
    fireEvent.change(descInput, { target: { value: "new desc" } });

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Save"));

    await waitFor(() => {
      expect(mocks.updateShareLink).toHaveBeenCalledWith({
        where: { id: "a" },
        data: { title: "Alpha v2", description: "new desc" },
      });
    });
  });

  it("soft-deletes a saved search after confirmation", async () => {
    mockSavedSearches([
      { id: "a", title: "Alpha", description: null, entityConfig: validConfig },
    ]);
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByText("Delete"));

    await waitFor(() => {
      expect(mocks.updateShareLink).toHaveBeenCalledWith({
        where: { id: "a" },
        data: { isDeleted: true },
      });
    });
  });
});
