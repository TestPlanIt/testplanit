/**
 * Saved views on the repository FilterBar.
 *
 * Contract under test:
 * - the menu lists this user's saved views for the project;
 * - saving captures the LIVE state (predicates + grouping axis + search)
 *   under a name;
 * - applying hands the parsed criteria to the host's predicate setter, so the
 *   URL updates and the applied view stays shareable by link;
 * - a view whose dimensions no longer exist applies its surviving parts and
 *   says what it skipped, instead of failing;
 * - saving is unavailable where filter state is memory-only (the case-
 *   selection dialog), because there is no URL to reproduce;
 * - focus returns to the menu trigger after apply and after delete.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";

const { savedViewsHolder, saveViewSpy, renameViewSpy, deleteViewSpy } =
  vi.hoisted(() => ({
    savedViewsHolder: {
      current: {
        views: [] as any[],
        unreadableCount: 0,
        isLoading: false,
        lastOptions: undefined as any,
      },
    },
    saveViewSpy: vi.fn(),
    renameViewSpy: vi.fn(),
    deleteViewSpy: vi.fn(),
  }));

const { toastSuccessSpy, toastWarningSpy, toastErrorSpy } = vi.hoisted(() => ({
  toastSuccessSpy: vi.fn(),
  toastWarningSpy: vi.fn(),
  toastErrorSpy: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessSpy,
    warning: toastWarningSpy,
    error: toastErrorSpy,
    info: vi.fn(),
  },
}));

// The hook (and its ShareLink persistence) has its own tests; the menu is
// asserted against its contract.
vi.mock("~/hooks/useSavedRepositoryViews", () => ({
  useSavedRepositoryViews: (options: any) => {
    savedViewsHolder.current.lastOptions = options;
    return {
      views: savedViewsHolder.current.views,
      unreadableCount: savedViewsHolder.current.unreadableCount,
      isLoading: savedViewsHolder.current.isLoading,
      refetch: vi.fn(),
      saveView: saveViewSpy,
      renameView: renameViewSpy,
      deleteView: deleteViewSpy,
      isSaving: false,
      isMutating: false,
    };
  },
}));

import { SavedViewsMenu } from "./SavedViewsMenu";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const registry = buildFilterDimensions();

const templatesIn12: FilterPredicate = {
  dimension: "templates",
  operator: "in",
  values: [1, 2],
};
const tagsAny: FilterPredicate = {
  dimension: "tags",
  operator: "any",
  values: [],
};

const makeView = (overrides: Record<string, unknown> = {}) => ({
  id: "view-1",
  title: "Smoke, not automated",
  description: null,
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  criteria: {
    projectId: 42,
    predicates: [templatesIn12],
    axis: "states",
    search: "login",
  },
  droppedPredicateCount: 0,
  axisDropped: false,
  ...overrides,
});

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 42,
    registry,
    predicates: [tagsAny] as FilterPredicate[],
    axis: "folders",
    onApply: vi.fn(),
    ...overrides,
  };
}

function openMenu() {
  fireEvent.click(screen.getByTestId("saved-views-trigger"));
}

beforeEach(() => {
  vi.clearAllMocks();
  savedViewsHolder.current = {
    views: [makeView()],
    unreadableCount: 0,
    isLoading: false,
  } as any;
  saveViewSpy.mockResolvedValue("view-new");
  renameViewSpy.mockResolvedValue(undefined);
  deleteViewSpy.mockResolvedValue(undefined);
});

describe("SavedViewsMenu", () => {
  it("labels the icon-only trigger and lists the user's saved views", () => {
    render(<SavedViewsMenu {...makeProps()} />);

    const trigger = screen.getByTestId("saved-views-trigger");
    expect(trigger).toHaveAttribute(
      "aria-label",
      "repository.savedViews.title"
    );

    openMenu();

    expect(screen.getByTestId("saved-views-list")).toBeInTheDocument();
    expect(screen.getByText("Smoke, not automated")).toBeInTheDocument();
    // Each row's actions are reachable by name, not by icon alone.
    expect(screen.getByTestId("saved-view-rename")).toHaveAttribute(
      "aria-label",
      "repository.savedViews.rename"
    );
    expect(screen.getByTestId("saved-view-delete")).toHaveAttribute(
      "aria-label",
      "repository.savedViews.delete"
    );
  });

  it("reports views that could not be read instead of hiding them silently", () => {
    savedViewsHolder.current.unreadableCount = 2;
    render(<SavedViewsMenu {...makeProps()} />);
    openMenu();

    expect(screen.getByTestId("saved-views-unreadable")).toBeInTheDocument();
  });

  it("offers an empty state before anything is saved", () => {
    savedViewsHolder.current.views = [];
    render(<SavedViewsMenu {...makeProps()} />);
    openMenu();

    expect(screen.getByTestId("saved-views-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("saved-views-list")).not.toBeInTheDocument();
  });

  it("saves the live filters and grouping axis under a name, never search", async () => {
    render(<SavedViewsMenu {...makeProps()} />);
    openMenu();
    fireEvent.click(screen.getByTestId("save-view-button"));

    const nameInput = await screen.findByTestId("saved-view-name-input");
    expect(nameInput).toHaveValue("");
    fireEvent.change(nameInput, { target: { value: "  Checkout smoke  " } });
    fireEvent.change(screen.getByTestId("saved-view-description-input"), {
      target: { value: "What the release check covers" },
    });
    fireEvent.click(screen.getByTestId("saved-view-save-submit"));

    await waitFor(() => expect(saveViewSpy).toHaveBeenCalledTimes(1));
    expect(saveViewSpy).toHaveBeenCalledWith({
      name: "Checkout smoke",
      description: "What the release check covers",
      criteria: {
        predicates: [tagsAny],
        axis: "folders",
        // A view describes filters and grouping; the selection dialog's
        // search box is surface-local and is never captured.
        search: "",
      },
    });
    expect(toastSuccessSpy).toHaveBeenCalled();
  });

  it("refuses an empty name without calling through to persistence", async () => {
    render(<SavedViewsMenu {...makeProps()} />);
    openMenu();
    fireEvent.click(screen.getByTestId("save-view-button"));

    fireEvent.click(await screen.findByTestId("saved-view-save-submit"));

    expect(await screen.findByTestId("saved-view-error")).toHaveTextContent(
      "repository.savedViews.nameRequired"
    );
    expect(saveViewSpy).not.toHaveBeenCalled();
  });

  it("applies a view through the host's predicate setter and returns focus", async () => {
    const props = makeProps();
    render(<SavedViewsMenu {...props} />);
    openMenu();
    fireEvent.click(screen.getByTestId("saved-view-item"));

    expect(props.onApply).toHaveBeenCalledWith({
      projectId: 42,
      predicates: [templatesIn12],
      axis: "states",
      search: "login",
    });
    expect(toastSuccessSpy).toHaveBeenCalledWith(
      "repository.savedViews.applied"
    );
    expect(toastWarningSpy).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(screen.getByTestId("saved-views-trigger")).toHaveFocus()
    );
  });

  it("applies the surviving parts of a degraded view and says what it skipped", () => {
    savedViewsHolder.current.views = [
      makeView({
        // Two persisted predicates referenced a deleted custom field and the
        // grouping axis pointed at it too — the hook already dropped them.
        criteria: {
          projectId: 42,
          predicates: [tagsAny],
          axis: null,
          search: "",
        },
        droppedPredicateCount: 2,
        axisDropped: true,
      }),
    ];
    const props = makeProps();
    render(<SavedViewsMenu {...props} />);
    openMenu();
    fireEvent.click(screen.getByTestId("saved-view-item"));

    // The view still applies — degraded, not refused.
    expect(props.onApply).toHaveBeenCalledWith({
      projectId: 42,
      predicates: [tagsAny],
      axis: null,
      search: "",
    });
    expect(toastSuccessSpy).not.toHaveBeenCalled();
    expect(toastWarningSpy).toHaveBeenCalledWith(
      "repository.savedViews.applied",
      {
        description:
          "repository.savedViews.droppedFilters repository.savedViews.droppedGrouping",
      }
    );
  });

  it("disables saving when there is nothing worth saving", () => {
    render(<SavedViewsMenu {...makeProps({ predicates: [], axis: null })} />);
    openMenu();

    expect(screen.getByTestId("save-view-button")).toBeDisabled();
    expect(screen.getByTestId("save-view-disabled-hint")).toHaveTextContent(
      "repository.savedViews.nothingToSave"
    );
  });

  it("renames a view from the menu", async () => {
    render(<SavedViewsMenu {...makeProps()} />);
    openMenu();
    fireEvent.click(screen.getByTestId("saved-view-rename"));

    const input = await screen.findByTestId("saved-view-rename-input");
    expect(input).toHaveValue("Smoke, not automated");
    fireEvent.change(input, { target: { value: "Release smoke" } });
    fireEvent.click(screen.getByTestId("saved-view-rename-submit"));

    await waitFor(() =>
      expect(renameViewSpy).toHaveBeenCalledWith({
        id: "view-1",
        name: "Release smoke",
        description: "",
      })
    );
  });

  it("deletes a view behind a confirmation and returns focus to the trigger", async () => {
    render(<SavedViewsMenu {...makeProps()} />);
    openMenu();
    fireEvent.click(screen.getByTestId("saved-view-delete"));

    fireEvent.click(await screen.findByTestId("saved-view-delete-confirm"));

    await waitFor(() => expect(deleteViewSpy).toHaveBeenCalledWith("view-1"));
    await waitFor(() =>
      expect(screen.getByTestId("saved-views-trigger")).toHaveFocus()
    );
  });

  it("defers the saved-views query until the menu is opened", () => {
    render(<SavedViewsMenu {...makeProps()} />);
    expect(savedViewsHolder.current.lastOptions.enabled).toBe(false);

    openMenu();
    expect(savedViewsHolder.current.lastOptions.enabled).toBe(true);
  });
});
