import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, any>) =>
    params ? `${key}:${Object.values(params).join("·")}` : key,
  // AttachmentsDisplay -> DateFormatter reads this directly (25-19); the
  // mock above only covers useTranslations, so without this a real mount of
  // AttachmentsDisplay throws the moment it renders a "created" timestamp.
  useLocale: () => "en-US",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// LinkedRequirementCasesPanel's useRequirementCaseLinks hook calls
// useQueryClient() unconditionally on every render (not just on
// link/unlink), so this file needs a QueryClient stand-in even though none
// of its own tests exercise the link/unlink flow directly (that is
// LinkedRequirementCasesPanel.test.tsx's job).
const mockInvalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

vi.mock("next-auth/react", () => ({
  // preferences (25-19) -- AttachmentsDisplay -> DateFormatter reads
  // session.user.preferences.{dateFormat,timeFormat,timezone} directly and
  // throws inside date-fns' format() on an undefined format string. Same
  // shape components/AttachmentsDisplay.test.tsx's own mock already uses.
  useSession: () => ({
    data: {
      user: {
        id: "user-1",
        preferences: {
          dateFormat: "MM/dd/yyyy",
          timeFormat: "HH:mm",
          timezone: "Etc/UTC",
        },
      },
    },
  }),
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("~/utils/storageUrl", () => ({
  getStorageUrlClient: (url: string) => `https://storage.example.com/${url}`,
}));

const { mockFetchSignedUrl } = vi.hoisted(() => ({
  mockFetchSignedUrl: vi.fn(),
}));
vi.mock("~/utils/fetchSignedUrl", () => ({
  fetchSignedUrl: mockFetchSignedUrl,
}));

// Same simplified always-rendered-content convention AttachmentsDisplay.test.tsx
// already established for this exact primitive -- avoids depending on
// Radix's real open/portal behavior for a plain click-to-confirm affordance.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children }: any) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: any) => (
    <div data-testid="popover-content">{children}</div>
  ),
}));

vi.mock("@/components/AttachmentPreview", () => ({
  AttachmentPreview: ({ attachment }: any) => (
    <div data-testid={`attachment-preview-${attachment.id}`} />
  ),
}));

// AttachmentsCarousel is a viewer, not part of any claim this file makes --
// mocked so "opens the carousel" tests can assert on what it was mounted
// with, without depending on its own internal editing/paging UI.
vi.mock("@/components/AttachmentsCarousel", () => ({
  AttachmentsCarousel: ({ attachments, initialIndex, onClose }: any) => (
    <div
      data-testid="attachments-carousel"
      data-attachment-id={attachments[initialIndex]?.id}
    >
      <button
        type="button"
        data-testid="attachments-carousel-close"
        onClick={onClose}
      >
        close
      </button>
    </div>
  ),
}));

// Stand-in for the file picker: a button that hands a fixed File to
// onFileSelect, mirroring the tiptap-note-simulate-edit convention below.
vi.mock("@/components/UploadAttachments", () => ({
  default: ({ onFileSelect, disabled }: any) => (
    <div data-testid="requirement-attachments-upload">
      <button
        type="button"
        data-testid="requirement-attachments-upload-simulate-select"
        disabled={disabled}
        onClick={() =>
          onFileSelect([
            new File(["contents"], "spec.pdf", { type: "application/pdf" }),
          ])
        }
      >
        simulate select
      </button>
    </div>
  ),
}));

// Same testid + data-readonly convention MilestoneFormControls.test.tsx
// already established for this exact component. `data-content` is this
// file's own addition, needed to assert the parsed doc TipTapEditor was
// actually handed. The simulate-edit button stands in for a real editor
// keystroke -- the mock has no rich-text surface of its own to type into.
vi.mock("@/components/tiptap/TipTapEditor", () => ({
  default: ({ readOnly, content, onUpdate }: any) => (
    <div
      data-testid="tiptap-note"
      data-readonly={String(!!readOnly)}
      data-content={JSON.stringify(content)}
    >
      <button
        type="button"
        data-testid="tiptap-note-simulate-edit"
        onClick={() =>
          onUpdate?.({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Edited" }],
              },
            ],
          })
        }
      >
        simulate edit
      </button>
    </div>
  ),
}));

// The badge's own behavior (three states, detach action, admin gating) is
// RequirementProvenanceBadge.test.tsx's job (25-07) -- this file only needs
// to prove the panel renders it for the selected requirement.
vi.mock("./RequirementProvenanceBadge", () => ({
  RequirementProvenanceBadge: ({ requirement }: any) => (
    <div
      data-testid="requirement-provenance-badge"
      data-requirement-id={requirement.id}
    />
  ),
}));

// The coverage panel's own behavior (rows, inherited marking, cross-project
// links) is RequirementCoveragePanel.test.tsx's job (26-09) -- this file
// only needs to prove it mounts, and where.
vi.mock("./RequirementCoveragePanel", () => ({
  RequirementCoveragePanel: ({ requirementId }: any) => (
    <div
      data-testid="requirement-coverage-panel"
      data-requirement-id={requirementId}
    />
  ),
}));

const {
  mockUseFindFirst,
  mockUpdateMutateAsync,
  mockAttachmentsFindMany,
  mockCreateAttachmentMutateAsync,
  mockUpdateAttachmentMutateAsync,
  mockRepositoryCasesFindMany,
  mockRepositoryCaseIssueFindMany,
  mockRequirementIssueReferenceFindMany,
} = vi.hoisted(() => ({
  mockUseFindFirst: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockAttachmentsFindMany: vi.fn(),
  mockCreateAttachmentMutateAsync: vi.fn(),
  mockUpdateAttachmentMutateAsync: vi.fn(),
  mockRepositoryCasesFindMany: vi.fn(),
  mockRepositoryCaseIssueFindMany: vi.fn(),
  mockRequirementIssueReferenceFindMany: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    issue: {
      useFindFirst: mockUseFindFirst,
      useUpdate: () => ({ mutateAsync: mockUpdateMutateAsync }),
      // COV-05's requirement-side content timestamp, read by
      // LinkedRequirementCasesPanel (27-11) -- not exercised by this file's
      // own assertions, only needed so the panel renders without crashing.
      useFindUnique: () => ({ data: undefined }),
    },
    attachments: {
      useFindMany: mockAttachmentsFindMany,
      useCreate: () => ({ mutateAsync: mockCreateAttachmentMutateAsync }),
      useUpdate: () => ({ mutateAsync: mockUpdateAttachmentMutateAsync }),
    },
    // LinkedRequirementCasesPanel's own read -- its full behavior is
    // covered by LinkedRequirementCasesPanel.test.tsx; this file only needs
    // it to render without crashing (empty list, matching every fixture
    // below).
    repositoryCases: {
      useFindMany: mockRepositoryCasesFindMany,
    },
    // COV-05's requirement-side suspect-flag inputs, mounted inside
    // LinkedRequirementCasesPanel (27-11) -- again only needed here to
    // render without crashing; the flag's own behavior is
    // LinkedRequirementCasesPanel.test.tsx's job.
    repositoryCaseIssue: {
      useFindMany: mockRepositoryCaseIssueFindMany,
      useUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
    },
    // RequirementReferencesPanel's own read -- its full behavior is covered
    // by RequirementReferencesPanel.test.tsx; this file only needs it to
    // render without crashing (empty list, matching every fixture below).
    requirementIssueReference: {
      useFindMany: mockRequirementIssueReferenceFindMany,
    },
    // useIssueColors() (hooks/useIssueColors.ts) calls this directly -- it
    // is not otherwise part of this file's fixture surface. Without it,
    // mounting IssueStatusDisplay/IssuePriorityDisplay in display mode
    // (25-17) crashes every test in this file. An empty `data` array is
    // enough: getStatusStyle/getPriorityStyle fall back to their default
    // styles and the badge still renders its text.
    color: {
      useFindMany: () => ({ data: [], isLoading: false }),
    },
    // AttachmentsDisplay -> UserNameCell (components/tables/UserNameCell.tsx)
    // calls this directly to render a "Created By" cell (25-19). A falsy
    // user is safe -- UserNameCell returns null on it.
    user: {
      useFindFirst: () => ({ data: undefined }),
    },
  }),
}));

import RequirementDetailPanel from "./RequirementDetailPanel";

const sampleDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
};

const nativeRequirement = {
  id: 1,
  name: "Req Native",
  // Equal to `name` -- what CreateRequirementDialog.tsx and
  // RequirementsListView.tsx:469 actually write for a native requirement.
  // A fixture whose native row carries a distinct title tests a state the
  // product cannot produce.
  title: "Req Native",
  status: "open",
  priority: "medium",
  note: null,
  isRequirement: true,
  integrationId: null,
  requirementDetachedAt: null,
  externalKey: null,
  externalUrl: null,
  issueTypeIconUrl: null,
};

const lockedRequirement = {
  ...nativeRequirement,
  id: 2,
  name: "Req Synced",
  title: "Req Synced Title",
  note: sampleDoc,
  integrationId: 9,
  externalKey: "REQ-100",
  externalUrl: "https://jira.example.com/browse/REQ-100",
};

const detachedRequirement = {
  ...lockedRequirement,
  id: 3,
  requirementDetachedAt: new Date().toISOString(),
};

// PROV-03 parity fixture: title === name. `detachedRequirement` above
// derives from `lockedRequirement` and so carries a title distinct from its
// name -- fine for the tests that use it directly, but Task 1 (25-17) drops
// `title` from the rendered field set whenever the title does not differ
// from the name, so a "same shape" map comparison against `nativeRequirement`
// (whose title also equals its name) needs a detached fixture that agrees.
const detachedRequirementSameTitle = {
  ...detachedRequirement,
  title: detachedRequirement.name,
};

// Shared existing-attachment fixture for the 25-19 attachments gap closure
// tests below.
const existingAttachment = {
  id: 501,
  issueId: 2,
  name: "existing-spec.pdf",
  url: "requirements/existing-spec.pdf",
  mimeType: "application/pdf",
  size: 2048,
  isDeleted: false,
  createdAt: new Date().toISOString(),
  createdById: "user-1",
};

function setRequirement(row: any) {
  mockUseFindFirst.mockReturnValue({ data: row, isLoading: false });
}

// COV-05 (27-11) gave LinkedRequirementCasesPanel -- mounted for real in
// every test below -- its own real useRequirementCoveringCases() call
// (useQueryClient is mocked above, but that only intercepts the PUBLIC
// export; useQuery's own module-internal reference to it still needs a
// real QueryClientProvider ancestor). retry: false keeps a stubbed-away
// fetch failure from retrying and slowing teardown.
function renderPanel(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
  return {
    ...utils,
    // The plain `rerender` RTL hands back re-renders under a NEW element
    // tree unless that tree is wrapped in the SAME QueryClientProvider
    // instance -- this keeps the client (and so the mocked hook's identity)
    // stable across a re-render, which is what makes "the row changed
    // underneath us" (mockUseFindFirst.mockReturnValue + rerender)
    // observable at all.
    rerenderWithProvider: (nextUi: React.ReactElement) =>
      utils.rerender(
        <QueryClientProvider client={client}>{nextUi}</QueryClientProvider>
      ),
  };
}

// Only reports an entry for a field the panel actually rendered -- a native
// requirement's Title field is gone entirely (Task 1, 25-17), so a map that
// assumed all three fields exist would throw before this even gets to
// compare anything.
function getFieldDisabledMap(): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const name of ["title", "status", "priority"] as const) {
    const el = screen.queryByTestId(`requirement-field-${name}`);
    if (el) {
      map[name] = (el as HTMLInputElement).disabled;
    }
  }
  return map;
}

describe("RequirementDetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateMutateAsync.mockResolvedValue({});
    mockAttachmentsFindMany.mockReturnValue({ data: [], isLoading: false });
    mockCreateAttachmentMutateAsync.mockResolvedValue({ id: 501 });
    mockUpdateAttachmentMutateAsync.mockResolvedValue({});
    mockFetchSignedUrl.mockResolvedValue(
      "https://storage.example.com/spec.pdf"
    );
    mockRepositoryCasesFindMany.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    });
    mockRepositoryCaseIssueFindMany.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    });
    mockRequirementIssueReferenceFindMany.mockReturnValue({
      data: [],
      isLoading: false,
      refetch: vi.fn(),
    });
    // LinkedRequirementCasesPanel's useRequirementCoveringCases (27-11) now
    // fires a real fetch to the covering-cases route on every render --
    // answered here so it resolves cleanly instead of rejecting; every
    // other path this file exercises still goes through a mocked ZenStack
    // hook or mocked mutateAsync, never this fetch.
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes("/covering-cases")) {
        return {
          ok: true,
          json: async () => ({ requirementId: 0, cases: [] }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as any;
  });

  it("renders the provenance badge for the selected requirement", () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);

    const badge = screen.getByTestId("requirement-provenance-badge");
    expect(badge).toHaveAttribute("data-requirement-id", "1");
  });

  it("renders the Tiptap editor bound to Issue.note", () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);

    const editor = screen.getByTestId("tiptap-note");
    expect(editor).toBeInTheDocument();
    expect(JSON.parse(editor.getAttribute("data-content")!)).toEqual(sampleDoc);
  });

  it("parses a legacy string note and a structured JSON note identically", () => {
    const legacyRow = {
      ...lockedRequirement,
      id: 4,
      note: JSON.stringify(sampleDoc),
    };
    setRequirement(legacyRow);
    const { unmount } = renderPanel(
      <RequirementDetailPanel projectId="7" requirementId={4} />
    );
    const legacyContent = screen
      .getByTestId("tiptap-note")
      .getAttribute("data-content");
    unmount();

    const structuredRow = { ...lockedRequirement, id: 5, note: sampleDoc };
    setRequirement(structuredRow);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={5} />);
    const structuredContent = screen
      .getByTestId("tiptap-note")
      .getAttribute("data-content");

    expect(JSON.parse(legacyContent!)).toEqual(JSON.parse(structuredContent!));
  });

  it("keeps the note editable on a synced, non-detached requirement", () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);

    expect(screen.getByTestId("tiptap-note")).toHaveAttribute(
      "data-readonly",
      "true"
    );

    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    expect(screen.getByTestId("tiptap-note")).toHaveAttribute(
      "data-readonly",
      "false"
    );
    // The scalar fields stay disabled (locked); the note does not -- proves
    // the lock and the note's editability are governed independently.
    expect(getFieldDisabledMap().title).toBe(true);
  });

  it("disables the locked fields on a synced, non-detached requirement", () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const disabledMap = getFieldDisabledMap();
    expect(Object.values(disabledMap).every((v) => v === true)).toBe(true);
  });

  it("enables the same fields on a detached requirement", () => {
    setRequirement(detachedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={3} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const disabledMap = getFieldDisabledMap();
    expect(Object.values(disabledMap).every((v) => v === false)).toBe(true);
  });

  it("enables the same fields on a native requirement, identically to a detached one", () => {
    // Uses `detachedRequirementSameTitle`, not the plain `detachedRequirement`
    // above -- that fixture's title genuinely differs from its name (it
    // derives from `lockedRequirement`), which would give its map an extra
    // `title` key `nativeRequirement`'s map does not have. Both fixtures
    // compared here have title === name, so both maps are {status, priority}
    // and this stays a like-with-like comparison.
    setRequirement(detachedRequirementSameTitle);
    const { unmount } = renderPanel(
      <RequirementDetailPanel projectId="7" requirementId={3} />
    );
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));
    const detachedMap = getFieldDisabledMap();
    unmount();

    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));
    const nativeMap = getFieldDisabledMap();

    // Map equality, not a per-row assertion -- this is what makes PROV-03's
    // "one state, not two code paths" claim testable rather than merely
    // inspectable: two fixtures reaching the same values through different
    // logic would still fail this comparison if the maps diverged in shape.
    expect(nativeMap).toEqual(detachedMap);
    expect(Object.values(nativeMap).every((v) => v === false)).toBe(true);
  });

  it("does not render a Title field for a native requirement -- the header already shows that string", () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);

    expect(
      screen.queryByTestId("requirement-field-title")
    ).not.toBeInTheDocument();

    // The predicate is not edit-mode-scoped -- it must stay absent there too.
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));
    expect(
      screen.queryByTestId("requirement-field-title")
    ).not.toBeInTheDocument();
  });

  it("still renders the locked Title field on a synced requirement whose title differs from its key", () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const titleField = screen.getByTestId(
      "requirement-field-title"
    ) as HTMLInputElement;
    expect(titleField).toBeInTheDocument();
    expect(titleField.disabled).toBe(true);
  });

  it("renders the requirement's type icon in the detail header", () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);

    const header = screen.getByTestId("requirement-detail-header");
    // No `issueTypeName`/`issueTypeIconUrl` on this fixture -- IssueTypeIcon
    // falls back to its default Lucide icon, labelled "Issue icon". The
    // point of this test is that SOME type icon renders in the header at
    // all, matching the list rows (RequirementsListColumns.tsx) -- not
    // which specific icon a given issue type maps to (that mapping is
    // IssueTypeIcon's own concern).
    expect(within(header).getByLabelText("Issue icon")).toBeInTheDocument();
  });

  it("renders Status and Priority as badges in display mode, not as disabled inputs", () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);

    // Assert on rendered text, not a class name -- colour is
    // useIssueColors' business and is stubbed to an empty color list here.
    expect(screen.getByTestId("requirement-display-status")).toHaveTextContent(
      "open"
    );
    expect(
      screen.getByTestId("requirement-display-priority")
    ).toHaveTextContent("medium");
    // Presence of the display testids alone would pass with both renderings
    // stacked -- the edit-mode Inputs must be genuinely absent.
    expect(
      screen.queryByTestId("requirement-field-status")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("requirement-field-priority")
    ).not.toBeInTheDocument();
  });

  it("renders Status and Priority as editable inputs in edit mode", () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    // The inverse of the display-mode assertion above -- pins the claim in
    // both directions rather than only proving one mode.
    expect(screen.getByTestId("requirement-field-status")).toBeInTheDocument();
    expect(
      screen.getByTestId("requirement-field-priority")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("requirement-display-status")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("requirement-display-priority")
    ).not.toBeInTheDocument();
  });

  it("orders the edit-mode actions Save then Cancel", () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const saveButton = screen.getByTestId("requirement-detail-save");
    const cancelButton = screen.getByTestId("requirement-detail-cancel");

    // Document ORDER, not merely presence -- a test that only asserts both
    // exist would pass with them swapped (mirrors the coverage-panel
    // ordering test's own convention below).
    expect(
      saveButton.compareDocumentPosition(cancelButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("saves the note through the ZenStack issue update hook, not a bespoke route", async () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const saveButton = screen.getByTestId(
      "requirement-detail-save"
    ) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true); // no dirty state yet

    fireEvent.click(screen.getByTestId("tiptap-note-simulate-edit"));
    expect(saveButton.disabled).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          note: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Edited" }],
              },
            ],
          },
        },
      });
    });
    // The note save itself must never reach a REST route -- narrowed to
    // "no /api/issues call" (27-11: the sibling LinkedRequirementCasesPanel
    // now legitimately fetches its own covering-cases route on every
    // render, so a blanket "fetch was never called" assertion no longer
    // isolates the note-save path specifically).
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/issues"),
      expect.anything()
    );
  });

  // UAT Scenario 2 regression (2026-08-25): a priority-only save on a
  // null-note requirement must NOT include `note` in the payload. The form
  // loads a null note as the canonical empty doc, so unconditionally
  // sending it rewrote NULL -> empty-doc -- and `note` is a watched column
  // of the contentUpdatedAt trigger, so the phantom write armed the suspect
  // flag on a save that never touched content (COV-05 D-02).
  //
  // 25-18: this test now guards TWO vectors, not one -- the phantom note
  // write above, AND the stale scalar write-back (25-UAT gap 1). Before
  // 25-18 the payload unconditionally carried `title` and `status` too,
  // even though the user only ever touched `priority`; the expected payload
  // below is now `dirtyFields`-gated down to exactly what was typed.
  it("omits an unchanged note from a priority-only save payload", async () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    fireEvent.change(screen.getByTestId("requirement-field-priority"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByTestId("requirement-detail-save"));

    await waitFor(() => {
      expect(mockUpdateMutateAsync).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          priority: "high",
        },
      });
    });
    const payload = mockUpdateMutateAsync.mock.calls[0][0].data;
    expect("note" in payload).toBe(false);
    expect("title" in payload).toBe(false);
    expect("status" in payload).toBe(false);
  });

  // 25-19 RED (Task 1, Step 1): today RequirementAttachments renders its
  // upload control and remove affordance unconditionally -- display mode is
  // not view-only. Run this against HEAD before touching the component.
  it("renders attachments read-only in display mode", () => {
    setRequirement(lockedRequirement);
    mockAttachmentsFindMany.mockReturnValue({
      data: [existingAttachment],
      isLoading: false,
    });
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);

    const section = screen.getByTestId("requirement-attachments");
    expect(
      within(section).queryByTestId("requirement-attachments-upload")
    ).not.toBeInTheDocument();
    expect(
      within(section).queryByText("common.actions.delete")
    ).not.toBeInTheDocument();
    // Display mode's read-only Name field renders the same string a second
    // time (a plain div, not an input) alongside the clickable title --
    // getAllByText, not getByText, matching AttachmentsDisplay.test.tsx's
    // own convention for this exact component.
    expect(
      within(section).getAllByText("existing-spec.pdf").length
    ).toBeGreaterThan(0);
  });

  it("offers upload and staged removal only in edit mode", () => {
    setRequirement(lockedRequirement);
    mockAttachmentsFindMany.mockReturnValue({
      data: [existingAttachment],
      isLoading: false,
    });
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    // The inverse of the display-mode test above -- pins the gate in both
    // directions rather than only proving one mode.
    const section = screen.getByTestId("requirement-attachments");
    expect(
      within(section).getByTestId("requirement-attachments-upload")
    ).toBeInTheDocument();
    expect(
      within(section).getByText("common.actions.delete")
    ).toBeInTheDocument();
  });

  it("stages a removal without writing anything", () => {
    setRequirement(lockedRequirement);
    mockAttachmentsFindMany.mockReturnValue({
      data: [existingAttachment],
      isLoading: false,
    });
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const section = screen.getByTestId("requirement-attachments");
    fireEvent.click(within(section).getByText("common.actions.delete"));

    // A pending badge alone would pass even if a write also fired -- assert
    // the mutation itself was never reached.
    expect(
      within(section).getByText("common.status.pendingDelete")
    ).toBeInTheDocument();
    expect(mockUpdateAttachmentMutateAsync).not.toHaveBeenCalled();
  });

  // The operator asked explicitly (2026-08-26) for the test-case
  // click-to-view-larger convention on requirement attachments too -- pinned
  // in both directions since the click goes through a different
  // AttachmentsDisplay mount (read-only vs. deferred) in each mode.
  it("opens the attachments carousel when an attachment is clicked, in both modes", () => {
    setRequirement(lockedRequirement);
    mockAttachmentsFindMany.mockReturnValue({
      data: [existingAttachment],
      isLoading: false,
    });
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    const section = screen.getByTestId("requirement-attachments");

    // Display mode's read-only Name field duplicates the title text -- the
    // FIRST match is always the clickable title (renders earlier in the
    // DOM), same convention AttachmentsDisplay.test.tsx uses for this exact
    // component.
    fireEvent.click(within(section).getAllByText("existing-spec.pdf")[0]);
    expect(screen.getByTestId("attachments-carousel")).toHaveAttribute(
      "data-attachment-id",
      "501"
    );
    fireEvent.click(screen.getByTestId("attachments-carousel-close"));
    expect(
      screen.queryByTestId("attachments-carousel")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("requirement-detail-edit"));
    fireEvent.click(within(section).getAllByText("existing-spec.pdf")[0]);
    expect(screen.getByTestId("attachments-carousel")).toHaveAttribute(
      "data-attachment-id",
      "501"
    );
  });

  // Rewritten for 25-19: the trigger moved from "pick a file in display
  // mode" (immediate upload) to "pick a file in edit mode, then Save"
  // (staged, applied on submit) -- every substantive HIER-06 assertion
  // (fetchSignedUrl args, issue.connect, BigInt size, no legacy route)
  // survives unchanged.
  it("uploads an attachment through the signed-url path and creates an Attachments row with issueId", async () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    fireEvent.click(
      screen.getByTestId("requirement-attachments-upload-simulate-select")
    );
    fireEvent.click(screen.getByTestId("requirement-detail-save"));

    await waitFor(() => {
      expect(mockFetchSignedUrl).toHaveBeenCalledWith(
        expect.any(File),
        "/api/get-attachment-url/",
        expect.stringContaining("7")
      );
    });

    await waitFor(() => {
      expect(mockCreateAttachmentMutateAsync).toHaveBeenCalledWith({
        data: expect.objectContaining({
          issue: { connect: { id: 2 } },
          url: "https://storage.example.com/spec.pdf",
          name: "spec.pdf",
          mimeType: "application/pdf",
          size: expect.any(BigInt),
          createdBy: { connect: { id: "user-1" } },
        }),
      });
    });
    const payload = mockCreateAttachmentMutateAsync.mock.calls[0][0].data;
    expect(typeof payload.size).toBe("bigint");

    // The zero-consumer legacy upload route must never be reached -- the
    // signed-url path above is the entire upload mechanism.
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/upload-attachment"),
      expect.anything()
    );
  });

  it("enables Save when the only change is a staged attachment", () => {
    setRequirement(lockedRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const saveButton = screen.getByTestId(
      "requirement-detail-save"
    ) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true); // nothing dirty, nothing staged

    fireEvent.click(
      screen.getByTestId("requirement-attachments-upload-simulate-select")
    );
    expect(saveButton.disabled).toBe(false);
  });

  it("applies a staged removal as a soft delete on save", async () => {
    setRequirement(lockedRequirement);
    mockAttachmentsFindMany.mockReturnValue({
      data: [existingAttachment],
      isLoading: false,
    });
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const section = screen.getByTestId("requirement-attachments");
    fireEvent.click(within(section).getByText("common.actions.delete"));
    fireEvent.click(screen.getByTestId("requirement-detail-save"));

    await waitFor(() => {
      expect(mockUpdateAttachmentMutateAsync).toHaveBeenCalledWith({
        where: { id: 501 },
        data: { isDeleted: true },
      });
    });
  });

  it("discards staged attachment changes on cancel", () => {
    setRequirement(lockedRequirement);
    mockAttachmentsFindMany.mockReturnValue({
      data: [existingAttachment],
      isLoading: false,
    });
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const section = screen.getByTestId("requirement-attachments");
    fireEvent.click(within(section).getByText("common.actions.delete"));
    expect(
      within(section).getByText("common.status.pendingDelete")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("requirement-detail-cancel"));
    expect(mockUpdateAttachmentMutateAsync).not.toHaveBeenCalled();

    // Re-enter edit mode: asserting only that no write fired would pass
    // even while a stale staged delete was still armed and would fire on
    // the NEXT save -- this is the real bug the reset key prevents.
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));
    const reenteredSection = screen.getByTestId("requirement-attachments");
    expect(
      within(reenteredSection).queryByText("common.status.pendingDelete")
    ).not.toBeInTheDocument();
    expect(
      within(reenteredSection).getByText("existing-spec.pdf")
    ).toBeInTheDocument();
  });

  it("keeps staged attachment changes when the save fails", async () => {
    setRequirement(lockedRequirement);
    mockAttachmentsFindMany.mockReturnValue({
      data: [existingAttachment],
      isLoading: false,
    });
    mockUpdateAttachmentMutateAsync.mockRejectedValueOnce(new Error("network"));
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={2} />);
    fireEvent.click(screen.getByTestId("requirement-detail-edit"));

    const section = screen.getByTestId("requirement-attachments");
    fireEvent.click(within(section).getByText("common.actions.delete"));
    fireEvent.click(screen.getByTestId("requirement-detail-save"));

    await waitFor(() => {
      expect(mockUpdateAttachmentMutateAsync).toHaveBeenCalled();
    });

    // Still in edit mode (Cancel button present) with the staged delete
    // still visible -- a failed save must not exit edit mode or clear
    // staged state.
    expect(screen.getByTestId("requirement-detail-cancel")).toBeInTheDocument();
    expect(
      within(section).getByText("common.status.pendingDelete")
    ).toBeInTheDocument();
  });

  // A row clicked mid-edit must never let the previous row's staged
  // attachment work reach the newly selected requirement's own Save -- no
  // staged file, edit or delete should be able to cross a selection change.
  describe("requirement selection discards staged attachment work", () => {
    it("does not carry a staged file across a requirement selection change", async () => {
      setRequirement(lockedRequirement);
      const { rerenderWithProvider } = renderPanel(
        <RequirementDetailPanel projectId="7" requirementId={2} />
      );
      fireEvent.click(screen.getByTestId("requirement-detail-edit"));
      fireEvent.click(
        screen.getByTestId("requirement-attachments-upload-simulate-select")
      );

      mockAttachmentsFindMany.mockReturnValue({ data: [], isLoading: false });
      setRequirement(nativeRequirement);
      rerenderWithProvider(
        <RequirementDetailPanel projectId="7" requirementId={1} />
      );

      fireEvent.click(screen.getByTestId("requirement-detail-edit"));
      const saveButton = screen.getByTestId(
        "requirement-detail-save"
      ) as HTMLButtonElement;
      // Nothing dirty, nothing staged -- the switch itself must not leave
      // anything from requirement 2 armed against requirement 1.
      expect(saveButton.disabled).toBe(true);

      fireEvent.click(screen.getByTestId("tiptap-note-simulate-edit"));
      fireEvent.click(screen.getByTestId("requirement-detail-save"));

      await waitFor(() => {
        expect(mockUpdateMutateAsync).toHaveBeenCalled();
      });
      expect(mockFetchSignedUrl).not.toHaveBeenCalled();
      expect(mockCreateAttachmentMutateAsync).not.toHaveBeenCalled();
    });

    it("does not carry a staged removal across a requirement selection change", async () => {
      setRequirement(lockedRequirement);
      mockAttachmentsFindMany.mockReturnValue({
        data: [existingAttachment],
        isLoading: false,
      });
      const { rerenderWithProvider } = renderPanel(
        <RequirementDetailPanel projectId="7" requirementId={2} />
      );
      fireEvent.click(screen.getByTestId("requirement-detail-edit"));
      const section = screen.getByTestId("requirement-attachments");
      fireEvent.click(within(section).getByText("common.actions.delete"));

      mockAttachmentsFindMany.mockReturnValue({ data: [], isLoading: false });
      setRequirement(nativeRequirement);
      rerenderWithProvider(
        <RequirementDetailPanel projectId="7" requirementId={1} />
      );

      fireEvent.click(screen.getByTestId("requirement-detail-edit"));
      fireEvent.click(screen.getByTestId("tiptap-note-simulate-edit"));
      fireEvent.click(screen.getByTestId("requirement-detail-save"));

      await waitFor(() => {
        expect(mockUpdateMutateAsync).toHaveBeenCalled();
      });
      expect(mockUpdateAttachmentMutateAsync).not.toHaveBeenCalled();
    });
  });

  // 25-18 gap closure (25-UAT gap 1): the form used to seed exactly once per
  // requirementId and never again -- a rename made elsewhere (webhook,
  // another tab, the tree's own inline rename) updated the header (it reads
  // live query data) but left the form holding the value it loaded minutes
  // ago, and Edit -> Save on that stale form silently reverted the rename.
  describe("form freshness (25-18 gap closure)", () => {
    it("re-seeds the form when the requirement is renamed while the panel is idle", () => {
      setRequirement(lockedRequirement);
      const { rerenderWithProvider } = renderPanel(
        <RequirementDetailPanel projectId="7" requirementId={2} />
      );

      expect(screen.getByTestId("requirement-display-title")).toHaveTextContent(
        "Req Synced Title"
      );

      setRequirement({ ...lockedRequirement, title: "Renamed By Tracker" });
      rerenderWithProvider(
        <RequirementDetailPanel projectId="7" requirementId={2} />
      );

      // The header ("KEY: Title") already read live query data before this
      // plan -- this is not the broken half, but pinning it here proves the
      // fixture actually re-rendered with the new row.
      expect(screen.getByTestId("requirement-detail-header")).toHaveTextContent(
        "Req Synced: Renamed By Tracker"
      );
      expect(screen.getByTestId("requirement-display-title")).toHaveTextContent(
        "Renamed By Tracker"
      );

      fireEvent.click(screen.getByTestId("requirement-detail-edit"));
      expect(
        (screen.getByTestId("requirement-field-title") as HTMLInputElement)
          .value
      ).toBe("Renamed By Tracker");
    });

    it("re-seeds a native requirement's status without touching the row's other fields", () => {
      setRequirement(nativeRequirement);
      const { rerenderWithProvider } = renderPanel(
        <RequirementDetailPanel projectId="7" requirementId={1} />
      );

      setRequirement({ ...nativeRequirement, status: "closed" });
      rerenderWithProvider(
        <RequirementDetailPanel projectId="7" requirementId={1} />
      );

      fireEvent.click(screen.getByTestId("requirement-detail-edit"));
      expect(
        (screen.getByTestId("requirement-field-status") as HTMLInputElement)
          .value
      ).toBe("closed");
    });

    // This one passes against HEAD -- it is a guard against the FIX (an
    // unconditional reset), not against the bug. It is what stops a future
    // "simplification" of the re-seed effect from turning it into a plain
    // `form.reset` on every data change.
    it("does not reset the form while the user is editing", () => {
      setRequirement(nativeRequirement);
      const { rerenderWithProvider } = renderPanel(
        <RequirementDetailPanel projectId="7" requirementId={1} />
      );

      fireEvent.click(screen.getByTestId("requirement-detail-edit"));
      fireEvent.change(screen.getByTestId("requirement-field-priority"), {
        target: { value: "urgent-typed-value" },
      });

      // `status`, not `name` -- `buildResetValues` never reads `name`, so a
      // row change that only touches `name` would leave the form's own
      // snapshot unchanged and pass this assertion for the wrong reason
      // (nothing to re-seed FROM), not because the in-flight-edit guard
      // did its job.
      setRequirement({ ...nativeRequirement, status: "closed" });
      rerenderWithProvider(
        <RequirementDetailPanel projectId="7" requirementId={1} />
      );

      expect(
        (screen.getByTestId("requirement-field-priority") as HTMLInputElement)
          .value
      ).toBe("urgent-typed-value");
    });

    // The dangerous half of the gap: an external rename landing WHILE the
    // user is mid-edit must not resurrect itself on save. The re-seed is
    // correctly inert here (edit mode) -- it is the dirty-gated payload,
    // not the re-seed, that must stop the stale title from going out.
    it("never writes an untouched title back after an external rename", async () => {
      setRequirement(detachedRequirement);
      const { rerenderWithProvider } = renderPanel(
        <RequirementDetailPanel projectId="7" requirementId={3} />
      );

      fireEvent.click(screen.getByTestId("requirement-detail-edit"));

      setRequirement({ ...detachedRequirement, title: "Renamed Elsewhere" });
      rerenderWithProvider(
        <RequirementDetailPanel projectId="7" requirementId={3} />
      );

      fireEvent.change(screen.getByTestId("requirement-field-priority"), {
        target: { value: "high" },
      });
      fireEvent.click(screen.getByTestId("requirement-detail-save"));

      await waitFor(() => {
        expect(mockUpdateMutateAsync).toHaveBeenCalled();
      });
      const payload = mockUpdateMutateAsync.mock.calls[0][0].data;
      expect(payload).toEqual({ priority: "high" });
      expect("title" in payload).toBe(false);
    });
  });

  // 25-18 gap closure (25-UAT gap 7): "a user cannot delete a req from the
  // details view; they should be able to from there ... just like test
  // cases." The panel owns no delete logic of its own -- it only ever
  // calls the handed-in `onRequestDelete`, which is the workspace's own
  // route to the list's existing `DeleteRequirementModal` + descendant
  // count.
  describe("delete affordance (25-18 gap closure)", () => {
    it("offers a Delete action in edit mode when the viewer can delete", () => {
      setRequirement(nativeRequirement);
      const onRequestDelete = vi.fn();
      renderPanel(
        <RequirementDetailPanel
          projectId="7"
          requirementId={1}
          onRequestDelete={onRequestDelete}
        />
      );

      expect(
        screen.queryByTestId("requirement-detail-delete")
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("requirement-detail-edit"));

      const deleteButton = screen.getByTestId("requirement-detail-delete");
      expect(deleteButton).toBeInTheDocument();
      fireEvent.click(deleteButton);
      expect(onRequestDelete).toHaveBeenCalledTimes(1);
    });

    it("renders no Delete action when onRequestDelete is absent (viewer cannot delete)", () => {
      setRequirement(nativeRequirement);
      renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);

      fireEvent.click(screen.getByTestId("requirement-detail-edit"));

      expect(
        screen.queryByTestId("requirement-detail-delete")
      ).not.toBeInTheDocument();
    });
  });
});

describe("RequirementDetailPanel (Phase 26 coverage additions)", () => {
  it("mounts the coverage panel above the linked-cases panel", () => {
    setRequirement(nativeRequirement);
    renderPanel(<RequirementDetailPanel projectId="7" requirementId={1} />);

    const coveragePanel = screen.getByTestId("requirement-coverage-panel");
    const linkedCasesPanel = screen.getByTestId("requirement-linked-cases");

    expect(coveragePanel).toHaveAttribute("data-requirement-id", "1");
    // Document ORDER, not merely presence -- "above" is the claim, and a
    // test that only asserts both exist would pass with them swapped.
    expect(
      coveragePanel.compareDocumentPosition(linkedCasesPanel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // The linked-cases panel's own behavior is untouched by this mount --
    // it still renders its add-link affordance (its full add/unlink
    // behavior is LinkedRequirementCasesPanel.test.tsx's job).
    expect(
      screen.getByTestId("requirement-linked-cases-add")
    ).toBeInTheDocument();
  });
});
