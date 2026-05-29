import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UploadAttachments from "./UploadAttachments";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(
    () => (key: string, _args?: any) => key.split(".").pop() ?? key
  ),
}));

// Mock next/image
vi.mock("next/image", () => ({
  default: ({ src, alt, ...props }: any) => (
    <img src={src} alt={alt} {...props} />
  ),
}));

// Mock UI components
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, type, asChild, ...props }: any) => {
    if (asChild) {
      return <>{children}</>;
    }
    return (
      <button
        type={type || "button"}
        onClick={onClick}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  },
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => (
    <div className={className} data-testid="card">
      {children}
    </div>
  ),
  CardHeader: ({ children }: any) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardContent: ({ children, ...props }: any) => (
    <div data-testid="card-content" {...props}>
      {children}
    </div>
  ),
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: any) => (
    <div className={className} data-testid="scroll-area">
      {children}
    </div>
  ),
}));

// Mock URL.createObjectURL
global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
global.URL.revokeObjectURL = vi.fn();

const createMockFile = (
  name: string,
  size = 1024,
  type = "image/png"
): File => {
  const file = new File(["mock content"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("UploadAttachments", () => {
  const mockOnFileSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the file input element", () => {
    render(<UploadAttachments onFileSelect={mockOnFileSelect} />);
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();
  });

  it("renders the card with title in normal (non-compact) mode", () => {
    render(<UploadAttachments onFileSelect={mockOnFileSelect} />);
    expect(screen.getByTestId("card")).toBeInTheDocument();
  });

  it("renders in compact mode without Card wrapper", () => {
    render(
      <UploadAttachments onFileSelect={mockOnFileSelect} compact={true} />
    );
    expect(screen.queryByTestId("card")).not.toBeInTheDocument();
  });

  it("file input accepts multiple files by default", () => {
    render(<UploadAttachments onFileSelect={mockOnFileSelect} />);
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(fileInput.multiple).toBe(true);
  });

  it("file input is single when multiple=false", () => {
    render(
      <UploadAttachments onFileSelect={mockOnFileSelect} multiple={false} />
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(fileInput.multiple).toBe(false);
  });

  it("file input is disabled when disabled=true", () => {
    render(
      <UploadAttachments onFileSelect={mockOnFileSelect} disabled={true} />
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(fileInput.disabled).toBe(true);
  });

  it("calls onFileSelect when files are selected via input", async () => {
    render(<UploadAttachments onFileSelect={mockOnFileSelect} />);
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = createMockFile("test-file.png");
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    // onFileSelect is called via useEffect when selectedFiles changes
    expect(mockOnFileSelect).toHaveBeenCalledWith([file]);
  });

  it("shows selected file names after file selection", async () => {
    render(
      <UploadAttachments onFileSelect={mockOnFileSelect} previews={false} />
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = createMockFile("my-report.pdf", 2048, "application/pdf");
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    expect(screen.getByText("my-report.pdf")).toBeInTheDocument();
  });

  it("removes file when remove button is clicked", async () => {
    render(
      <UploadAttachments onFileSelect={mockOnFileSelect} previews={false} />
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const file = createMockFile("removable.txt", 512, "text/plain");
    Object.defineProperty(fileInput, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(fileInput);

    expect(screen.getByText("removable.txt")).toBeInTheDocument();

    // Click the remove button (XCircle button)
    const removeButton = screen.getByRole("button", { name: /cancel|remove/i });
    fireEvent.click(removeButton);

    expect(screen.queryByText("removable.txt")).not.toBeInTheDocument();
  });

  it("respects accept prop on file input", () => {
    render(
      <UploadAttachments onFileSelect={mockOnFileSelect} accept="image/*" />
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;
    expect(fileInput.accept).toBe("image/*");
  });

  it("renders upload label/trigger button", () => {
    render(<UploadAttachments onFileSelect={mockOnFileSelect} />);
    // Label that wraps the upload button should be present
    const label = document.querySelector("label");
    expect(label).toBeInTheDocument();
  });

  it("shows compact upload label text in compact mode", () => {
    render(
      <UploadAttachments onFileSelect={mockOnFileSelect} compact={true} />
    );
    // In compact mode, renders a span with text
    const label = document.querySelector("label");
    expect(label).toBeInTheDocument();
  });

  it("seeds initial files from initialFiles prop", async () => {
    const initialFile = createMockFile("initial.png");
    render(
      <UploadAttachments
        onFileSelect={mockOnFileSelect}
        previews={false}
        initialFiles={[initialFile]}
      />
    );

    // The component seeds files from initialFiles via useEffect
    expect(mockOnFileSelect).toHaveBeenCalledWith([initialFile]);
  });

  it("shows error message for invalid file type when allowedTypes is set", () => {
    render(
      <UploadAttachments
        onFileSelect={mockOnFileSelect}
        allowedTypes={[".pdf"]}
      />
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const invalidFile = createMockFile("image.png", 1024, "image/png");
    Object.defineProperty(fileInput, "files", {
      value: [invalidFile],
      configurable: true,
    });
    fireEvent.change(fileInput);

    expect(screen.getByText("invalidFileType")).toBeInTheDocument();
  });

  it("does not show error for valid file type", () => {
    render(
      <UploadAttachments
        onFileSelect={mockOnFileSelect}
        allowedTypes={[".png"]}
      />
    );
    const fileInput = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement;

    const validFile = createMockFile("image.png", 1024, "image/png");
    Object.defineProperty(fileInput, "files", {
      value: [validFile],
      configurable: true,
    });
    fireEvent.change(fileInput);

    expect(screen.queryByText("invalidFileType")).not.toBeInTheDocument();
  });

  // ─── Link mode ──────────────────────────────────────────────────────────
  // The `allowLinks` prop is opt-in (defaults to false) so the import
  // wizards that mount UploadAttachments file-only stay untouched.

  describe("link mode (allowLinks)", () => {
    it("does not render the Add Link button when allowLinks is false", () => {
      render(<UploadAttachments onFileSelect={mockOnFileSelect} />);
      // Two `addButton` instances would mean the form-submit button is
      // also rendered; we just want to confirm the opt-in button is absent.
      expect(screen.queryAllByText("addButton")).toHaveLength(0);
    });

    it("renders the Add Link button when allowLinks is true", () => {
      const onLinksChange = vi.fn();
      render(
        <UploadAttachments
          onFileSelect={mockOnFileSelect}
          allowLinks
          onLinksChange={onLinksChange}
        />
      );
      // The toggle button — the form-submit button is hidden until clicked.
      expect(screen.getAllByText("addButton").length).toBeGreaterThan(0);
    });

    it("expands the inline link form when the toggle is clicked", () => {
      const onLinksChange = vi.fn();
      render(
        <UploadAttachments
          onFileSelect={mockOnFileSelect}
          allowLinks
          onLinksChange={onLinksChange}
        />
      );
      // Before clicking: form fields are not in the DOM.
      expect(screen.queryByText("urlLabel")).not.toBeInTheDocument();

      fireEvent.click(screen.getAllByText("addButton")[0]);

      // After clicking: URL, name, and note fields appear.
      expect(screen.getByText("urlLabel")).toBeInTheDocument();
      expect(screen.getByText("nameLabel")).toBeInTheDocument();
      expect(screen.getByText("noteLabel")).toBeInTheDocument();
    });

    it("rejects an invalid URL and surfaces the error message", () => {
      const onLinksChange = vi.fn();
      render(
        <UploadAttachments
          onFileSelect={mockOnFileSelect}
          allowLinks
          onLinksChange={onLinksChange}
        />
      );
      fireEvent.click(screen.getAllByText("addButton")[0]);

      // Submit Add button is disabled when URL is empty; type a non-URL.
      const urlInput = document.getElementById(
        // The component generates ids of shape `<fileInputId>-link-url`.
        // Targeting by query rather than by id since useId() is opaque.
        document.querySelector('input[type="url"]')!.id
      ) as HTMLInputElement;
      fireEvent.change(urlInput, { target: { value: "not a url" } });
      // The Add button is the SECOND `addButton` (toggle + submit, in order).
      const buttons = screen.getAllByText("addButton");
      const submit = buttons[buttons.length - 1].closest(
        "button"
      ) as HTMLButtonElement;
      // Invalid URL → button disabled, callback never fires.
      expect(submit.disabled).toBe(true);
      expect(onLinksChange).not.toHaveBeenCalled();
    });

    it("emits a link on submit with mimeType text/uri-list and size = url length", () => {
      const onLinksChange = vi.fn();
      render(
        <UploadAttachments
          onFileSelect={mockOnFileSelect}
          allowLinks
          onLinksChange={onLinksChange}
        />
      );
      fireEvent.click(screen.getAllByText("addButton")[0]);

      const urlInput = document.querySelector(
        'input[type="url"]'
      ) as HTMLInputElement;
      const nameInput = document.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;

      const URL = "https://example.com/runbook";
      fireEvent.change(urlInput, { target: { value: URL } });
      fireEvent.change(nameInput, { target: { value: "Runbook" } });

      const buttons = screen.getAllByText("addButton");
      const submit = buttons[buttons.length - 1].closest(
        "button"
      ) as HTMLButtonElement;
      fireEvent.click(submit);

      expect(onLinksChange).toHaveBeenCalledWith([
        {
          url: URL,
          name: "Runbook",
          note: undefined,
          mimeType: "text/uri-list",
          size: URL.length,
        },
      ]);
    });

    it("defaults the display name to the URL when blank", () => {
      const onLinksChange = vi.fn();
      render(
        <UploadAttachments
          onFileSelect={mockOnFileSelect}
          allowLinks
          onLinksChange={onLinksChange}
        />
      );
      fireEvent.click(screen.getAllByText("addButton")[0]);

      const urlInput = document.querySelector(
        'input[type="url"]'
      ) as HTMLInputElement;
      fireEvent.change(urlInput, {
        target: { value: "https://example.com/x" },
      });

      const buttons = screen.getAllByText("addButton");
      const submit = buttons[buttons.length - 1].closest(
        "button"
      ) as HTMLButtonElement;
      fireEvent.click(submit);

      expect(onLinksChange).toHaveBeenCalledWith([
        expect.objectContaining({
          url: "https://example.com/x",
          name: "https://example.com/x",
        }),
      ]);
    });

    it("de-dupes by URL — pasting the same link twice yields one entry", () => {
      const onLinksChange = vi.fn();
      render(
        <UploadAttachments
          onFileSelect={mockOnFileSelect}
          allowLinks
          onLinksChange={onLinksChange}
        />
      );

      const addOnce = () => {
        fireEvent.click(screen.getAllByText("addButton")[0]);
        const urlInput = document.querySelector(
          'input[type="url"]'
        ) as HTMLInputElement;
        fireEvent.change(urlInput, {
          target: { value: "https://example.com/dup" },
        });
        const buttons = screen.getAllByText("addButton");
        const submit = buttons[buttons.length - 1].closest(
          "button"
        ) as HTMLButtonElement;
        fireEvent.click(submit);
      };

      addOnce();
      addOnce();

      // The most recent onLinksChange payload should still contain one entry.
      const last =
        onLinksChange.mock.calls[onLinksChange.mock.calls.length - 1][0];
      expect(last).toHaveLength(1);
    });

    it("does not invoke onLinksChange when no link has ever been added", () => {
      // Mount-suppress: parent shouldn't see a spurious empty-array call.
      const onLinksChange = vi.fn();
      render(
        <UploadAttachments
          onFileSelect={mockOnFileSelect}
          allowLinks
          onLinksChange={onLinksChange}
        />
      );
      expect(onLinksChange).not.toHaveBeenCalled();
    });
  });
});
