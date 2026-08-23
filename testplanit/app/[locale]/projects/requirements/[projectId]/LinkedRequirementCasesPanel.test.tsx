import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

const mockRepositoryCasesFindMany = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    repositoryCases: {
      useFindMany: (...args: any[]) => mockRepositoryCasesFindMany(...args),
    },
  }),
}));

// Same simplified always-rendered-content convention
// RequirementDetailPanel.test.tsx already established for this exact
// primitive -- avoids depending on Radix's real open/portal behavior for a
// plain click-to-confirm affordance.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children }: any) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: any) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

// A stand-in combobox: exposes the fetcher and lets a test pick any
// candidate directly, matching ConfigurationGroupLinkField.test.tsx's own
// established convention for this exact primitive.
let capturedFetchOptions:
  ((q: string, p: number, s: number) => Promise<any>) | null = null;
let capturedPick: ((option: any) => void) | null = null;
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({ fetchOptions, onValueChange, renderTrigger }: any) => {
    capturedFetchOptions = fetchOptions;
    capturedPick = onValueChange;
    return renderTrigger({ value: null, defaultContent: <span>pick</span> });
  },
}));

vi.mock("@/components/tables/CaseDisplay", () => ({
  CaseDisplay: ({ name }: any) => (
    <span data-testid="case-display">{name}</span>
  ),
}));

vi.mock("@/components/TestCaseNameDisplay", () => ({
  TestCaseNameDisplay: ({ testCase }: any) => (
    <span data-testid={`case-name-${testCase.id}`}>{testCase.name}</span>
  ),
}));

vi.mock("@/components/search/ProjectNameDisplay", () => ({
  ProjectNameDisplay: ({ projectName }: any) => (
    <span data-testid="project-name">{projectName}</span>
  ),
}));

import { LinkedRequirementCasesPanel } from "./LinkedRequirementCasesPanel";

function decodeQueryParam(url: string, param: string): any {
  const raw = new URL(url, "http://localhost").searchParams.get(param);
  return raw ? JSON.parse(raw) : null;
}

function setLinkedCases(rows: any[]) {
  mockRepositoryCasesFindMany.mockReturnValue({
    data: rows,
    isLoading: false,
    refetch: vi.fn(),
  });
}

describe("LinkedRequirementCasesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedFetchOptions = null;
    capturedPick = null;
    setLinkedCases([]);
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/api/model/RepositoryCases/count")) {
        return { ok: true, json: async () => ({ data: 0 }) } as Response;
      }
      if (url.includes("/api/model/RepositoryCases/findMany")) {
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      }
      if (url.includes("/link") || url.includes("/unlink")) {
        return { ok: true, json: async () => ({ id: 1 }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;
  });

  it("lists the test cases linked to the requirement", () => {
    setLinkedCases([
      {
        id: 10,
        name: "Login works",
        source: "MANUAL",
        isDeleted: false,
        projectId: 7,
        project: { name: "Current Project", iconUrl: null },
      },
      {
        id: 11,
        name: "Logout works",
        source: "MANUAL",
        isDeleted: false,
        projectId: 7,
        project: { name: "Current Project", iconUrl: null },
      },
    ]);

    render(<LinkedRequirementCasesPanel projectId="7" requirementId={42} />);

    expect(screen.getByTestId("case-name-10")).toHaveTextContent("Login works");
    expect(screen.getByTestId("case-name-11")).toHaveTextContent(
      "Logout works"
    );
  });

  it("excludes already-linked cases from the add-link search results", async () => {
    setLinkedCases([
      {
        id: 10,
        name: "Login works",
        source: "MANUAL",
        isDeleted: false,
        projectId: 7,
        project: { name: "Current Project", iconUrl: null },
      },
    ]);

    render(<LinkedRequirementCasesPanel projectId="7" requirementId={42} />);

    fireEvent.click(screen.getByTestId("requirement-linked-cases-add"));

    expect(capturedFetchOptions).not.toBeNull();
    await act(async () => {
      await capturedFetchOptions!("", 0, 10);
    });

    const findManyCall = (global.fetch as any).mock.calls.find(
      ([url]: [string]) => url.includes("/api/model/RepositoryCases/findMany")
    );
    expect(findManyCall).toBeDefined();
    const params = decodeQueryParam(findManyCall[0], "q");
    // Asserts the `where` object the search actually sent, not merely that
    // fewer options rendered -- a client-side filter would pass the latter
    // for the wrong reason.
    expect(params.where.id.notIn).toEqual([10]);
  });

  it("commits a new link through the existing /api/issues/[issueId]/link route", async () => {
    render(<LinkedRequirementCasesPanel projectId="7" requirementId={42} />);

    fireEvent.click(screen.getByTestId("requirement-linked-cases-add"));
    expect(capturedPick).not.toBeNull();

    act(() => {
      capturedPick!({
        id: 99,
        name: "New case",
        source: "MANUAL",
        projectId: 7,
      });
    });

    fireEvent.click(screen.getByTestId("requirement-linked-cases-submit"));

    await waitFor(() => {
      const linkCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === "/api/issues/42/link"
      );
      expect(linkCall).toBeDefined();
      expect(linkCall[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(linkCall[1].body)).toEqual({
        entityType: "testCase",
        entityId: 99,
      });
    });
  });

  it("removes a link through the existing /api/issues/[issueId]/unlink route", async () => {
    setLinkedCases([
      {
        id: 55,
        name: "Removable case",
        source: "MANUAL",
        isDeleted: false,
        projectId: 7,
        project: { name: "Current Project", iconUrl: null },
      },
    ]);

    render(<LinkedRequirementCasesPanel projectId="7" requirementId={42} />);

    fireEvent.click(screen.getByTestId("requirement-linked-case-remove-55"));
    fireEvent.click(
      screen.getByTestId("requirement-linked-case-remove-confirm-55")
    );

    await waitFor(() => {
      const unlinkCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === "/api/issues/42/unlink"
      );
      expect(unlinkCall).toBeDefined();
      expect(unlinkCall[1]).toMatchObject({ method: "POST" });
      expect(JSON.parse(unlinkCall[1].body)).toEqual({
        entityType: "testCase",
        entityId: 55,
      });
    });
  });

  it("confirms removal in a popover and never uses a native confirm dialog", async () => {
    setLinkedCases([
      {
        id: 55,
        name: "Removable case",
        source: "MANUAL",
        isDeleted: false,
        projectId: 7,
        project: { name: "Current Project", iconUrl: null },
      },
    ]);
    const confirmSpy = vi.spyOn(window, "confirm");

    render(<LinkedRequirementCasesPanel projectId="7" requirementId={42} />);

    fireEvent.click(screen.getByTestId("requirement-linked-case-remove-55"));
    fireEvent.click(
      screen.getByTestId("requirement-linked-case-remove-confirm-55")
    );

    await waitFor(() => {
      expect(
        (global.fetch as any).mock.calls.some(
          ([url]: [string]) => url === "/api/issues/42/unlink"
        )
      ).toBe(true);
    });

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("remains usable on a synced, locked requirement — linking is not a locked field", async () => {
    // The panel takes no lock-related prop at all -- it is not gated on
    // isRequirementLocked, so the same add-link flow that works for any
    // requirement id also completes for one that represents a synced,
    // locked row. There is nothing here to disable.
    render(<LinkedRequirementCasesPanel projectId="7" requirementId={999} />);

    const addButton = screen.getByTestId(
      "requirement-linked-cases-add"
    ) as HTMLButtonElement;
    expect(addButton.disabled).toBe(false);

    fireEvent.click(addButton);
    act(() => {
      capturedPick!({
        id: 77,
        name: "Locked-requirement case",
        source: "MANUAL",
        projectId: 7,
      });
    });
    fireEvent.click(screen.getByTestId("requirement-linked-cases-submit"));

    await waitFor(() => {
      const linkCall = (global.fetch as any).mock.calls.find(
        ([url]: [string]) => url === "/api/issues/999/link"
      );
      expect(linkCall).toBeDefined();
    });
  });
});

// Test inventory scaffold for Phase 26's cross-project link addition.
// Titles only — converted by 26-09.
describe("LinkedRequirementCasesPanel (Phase 26 coverage additions)", () => {
  it.todo("links a cross-project row's project badge to the owning project");
});
