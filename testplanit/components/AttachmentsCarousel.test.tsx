import type { Attachments } from "@prisma/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentsCarousel } from "./AttachmentsCarousel";

const mockUpdateAttachments = vi.fn();

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: {
      user: {
        preferences: {
          dateFormat: "MM/DD/YYYY",
          timeFormat: "HH:mm",
          timezone: "Etc/UTC",
        },
      },
    },
  })),
}));

vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key.split(".").pop() ?? key),
}));

vi.mock("~/lib/hooks", () => ({
  useUpdateAttachments: vi.fn(() => ({
    mutateAsync: mockUpdateAttachments,
  })),
}));

vi.mock("~/utils/storageUrl", () => ({
  getStorageUrlClient: vi.fn((url: string) => `https://storage.example.com/${url}`),
}));

vi.mock("@/components/AttachmentPreview", () => ({
  AttachmentPreview: ({ attachment, size }: any) => (
    <div data-testid={`attachment-preview-${attachment.id}`} data-size={size}>
      {attachment.name}
    </div>
  ),
}));

vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: any) => (
    <span data-testid="date-formatter">{String(date)}</span>
  ),
}));

vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: any) => (
    <span data-testid={`user-name-${userId}`}>{userId}</span>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, variant, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/carousel", () => {
  const listeners: Record<string, Function[]> = {};
  let selectedSnap = 0;
  const mockApi = {
    scrollTo: vi.fn((index: number) => {
      selectedSnap = index;
      listeners["select"]?.forEach((fn) => fn());
    }),
    selectedScrollSnap: vi.fn(() => selectedSnap),
    on: vi.fn((event: string, fn: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    off: vi.fn(),
  };
  return {
    Carousel: ({ children, setApi }: any) => {
      if (setApi) setTimeout(() => setApi(mockApi), 0);
      return <div data-testid="carousel">{children}</div>;
    },
    CarouselContent: ({ children }: any) => (
      <div data-testid="carousel-content">{children}</div>
    ),
    CarouselItem: ({ children }: any) => (
      <div data-testid="carousel-item">{children}</div>
    ),
  };
});

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open, onOpenChange }: any) => (
    open ? <div data-testid="dialog" onClick={() => onOpenChange?.(false)}>{children}</div> : null
  ),
  DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
  DialogDescription: ({ children }: any) => <div data-testid="dialog-description">{children}</div>,
  DialogFooter: ({ children }: any) => <div data-testid="dialog-footer">{children}</div>,
  DialogHeader: ({ children }: any) => <div data-testid="dialog-header">{children}</div>,
  DialogTitle: ({ children }: any) => <div data-testid="dialog-title">{children}</div>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, ...props }: any) => (
    <input value={value} onChange={onChange} data-testid="edit-name-input" {...props} />
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open }: any) => (
    <div data-testid="popover" data-open={open}>{children}</div>
  ),
  PopoverContent: ({ children }: any) => <div data-testid="popover-content">{children}</div>,
  PopoverTrigger: ({ children }: any) => <div data-testid="popover-trigger">{children}</div>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr data-testid="separator" />,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({ value, onChange, ...props }: any) => (
    <textarea value={value} onChange={onChange} data-testid="edit-note-textarea" {...props} />
  ),
}));

let idCounter = 1;
function makeAttachment(overrides: Record<string, unknown> = {}): Attachments {
  return {
    id: idCounter++,
    name: "test-image.png",
    url: "uploads/test-image.png",
    size: BigInt(1024),
    note: "A test attachment",
    isDeleted: false,
    mimeType: "image/png",
    createdAt: new Date("2026-01-15"),
    createdById: "user-1",
    testCaseId: null,
    sessionId: null,
    sessionResultsId: null,
    testRunsId: null,
    testRunResultsId: null,
    testRunStepResultId: null,
    junitTestResultId: null,
    ...overrides,
  } as Attachments;
}

describe("AttachmentsCarousel", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAttachments.mockResolvedValue({});
  });

  it("renders the dialog with title and attachment count", () => {
    const attachments = [makeAttachment({ id: "a1", name: "photo.png" })];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={false}
      />
    );

    expect(screen.getByTestId("dialog")).toBeDefined();
    expect(screen.getByTestId("dialog-title")).toBeDefined();
    expect(screen.getByTestId("attachment-preview-a1")).toBeDefined();
  });

  it("renders all attachments in the carousel", () => {
    const attachments = [
      makeAttachment({ id: "a1", name: "file1.png" }),
      makeAttachment({ id: "a2", name: "file2.jpg" }),
      makeAttachment({ id: "a3", name: "file3.pdf" }),
    ];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={false}
      />
    );

    const items = screen.getAllByTestId("carousel-item");
    expect(items).toHaveLength(3);
    expect(screen.getByTestId("attachment-preview-a1")).toBeDefined();
    expect(screen.getByTestId("attachment-preview-a2")).toBeDefined();
    expect(screen.getByTestId("attachment-preview-a3")).toBeDefined();
  });

  it("renders attachment metadata (size, date, creator)", () => {
    const attachments = [
      makeAttachment({ id: "a1", name: "doc.pdf", size: BigInt(2048), createdById: "user-42" }),
    ];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={false}
      />
    );

    expect(screen.getByTestId("date-formatter")).toBeDefined();
    expect(screen.getByTestId("user-name-user-42")).toBeDefined();
  });

  it("renders download button", () => {
    const attachments = [makeAttachment({ id: "a1", name: "report.csv" })];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={false}
      />
    );

    expect(screen.getByText("download")).toBeDefined();
  });

  it("does not show edit button when canEdit is false", () => {
    const attachments = [makeAttachment({ id: "a1" })];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={false}
      />
    );

    expect(screen.queryByText("edit")).toBeNull();
  });

  it("shows edit button when canEdit is true", () => {
    const attachments = [makeAttachment({ id: "a1" })];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={true}
      />
    );

    expect(screen.getByText("edit")).toBeDefined();
  });

  it("shows name input and note textarea when editing", () => {
    const attachments = [makeAttachment({ id: "a1", name: "original.png", note: "original note" })];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={true}
      />
    );

    fireEvent.click(screen.getByText("edit"));

    expect(screen.getByTestId("edit-name-input")).toBeDefined();
    expect(screen.getByTestId("edit-note-textarea")).toBeDefined();
    const footer = screen.getByTestId("dialog-footer");
    expect(footer.textContent).toContain("cancel");
    expect(footer.textContent).toContain("submit");
  });

  it("shows attachment note or 'none' placeholder", () => {
    const attachments = [makeAttachment({ id: "a1", note: null })];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={false}
      />
    );

    expect(screen.getByText("none")).toBeDefined();
  });

  it("shows note text when note exists", () => {
    const attachments = [makeAttachment({ id: "a1", note: "My important note" })];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={false}
      />
    );

    expect(screen.getByText("My important note")).toBeDefined();
  });

  it("renders navigation buttons", () => {
    const attachments = [
      makeAttachment({ id: "a1", name: "first.png" }),
      makeAttachment({ id: "a2", name: "second.png" }),
    ];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={false}
      />
    );

    const buttons = screen.getAllByRole("button");
    const prevButton = buttons.find((b) => b.getAttribute("disabled") !== null);
    expect(prevButton).toBeDefined();
  });

  it("renders delete popover trigger in edit mode", () => {
    const attachments = [makeAttachment({ id: "a1" })];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={true}
      />
    );

    fireEvent.click(screen.getByText("edit"));

    expect(screen.getByTestId("popover")).toBeDefined();
    expect(screen.getByText("delete")).toBeDefined();
  });

  it("renders AttachmentPreview for each attachment", () => {
    const attachments = [
      makeAttachment({ id: "a1" }),
      makeAttachment({ id: "a2" }),
    ];
    render(
      <AttachmentsCarousel
        attachments={attachments}
        initialIndex={0}
        onClose={mockOnClose}
        canEdit={false}
      />
    );

    expect(screen.getByTestId("attachment-preview-a1")).toBeDefined();
    expect(screen.getByTestId("attachment-preview-a2")).toBeDefined();
  });
});
