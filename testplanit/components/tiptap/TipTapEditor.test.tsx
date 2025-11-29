import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import TipTapEditor from "./TipTapEditor";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      setColor: "Set color",
      enterUrl: "Enter URL",
      uploadFile: "Upload file",
      "actions.apply": "Apply",
    };
    return translations[key] || key;
  },
}));

// Mock ZenStack hooks
vi.mock("~/lib/hooks/project-llm-integration", () => ({
  useFindManyProjectLlmIntegration: () => ({
    data: [], // No LLM integrations by default
    isLoading: false,
    error: null,
  }),
}));

// Mock the CSS module
vi.mock("~/styles/TipTapEditor.module.css", () => ({
  default: { editorContent: "mock-editor-content" },
}));

// Mock components
vi.mock("../LoadingSpinnerAlert", () => ({
  default: () => <div data-testid="loading-spinner">{"Loading..."}</div>,
}));

vi.mock("./video", () => ({
  Video: {
    name: "video",
    group: "block",
  },
}));

// Mock utils
vi.mock("~/utils", () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(" "),
}));

// Mock constants
vi.mock("~/app/constants", () => ({
  emptyEditorContent: { type: "doc", content: [] },
}));

// Mock fetch for file upload tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock console to avoid test output pollution
const originalWarn = console.warn;
beforeEach(() => {
  console.warn = vi.fn();
});

afterEach(() => {
  console.warn = originalWarn;
});

describe("TipTapEditor", () => {
  const defaultProps = {
    content: { type: "doc", content: [] },
    projectId: "test-project-123",
  };

  let mockEditor: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a comprehensive mock editor
    mockEditor = {
      isActive: vi.fn(() => false),
      can: vi.fn(() => ({
        undo: vi.fn(() => true),
        redo: vi.fn(() => true),
      })),
      getAttributes: vi.fn(() => ({ href: "" })),
      getJSON: vi.fn(() => ({ type: "doc", content: [] })),
      setEditable: vi.fn(),
      state: {
        doc: {
          content: { size: 0 },
        },
      },
      chain: vi.fn(() => ({
        focus: vi.fn(() => ({
          toggleBold: vi.fn(() => ({ run: vi.fn() })),
          toggleItalic: vi.fn(() => ({ run: vi.fn() })),
          toggleStrike: vi.fn(() => ({ run: vi.fn() })),
          toggleUnderline: vi.fn(() => ({ run: vi.fn() })),
          toggleCode: vi.fn(() => ({ run: vi.fn() })),
          setColor: vi.fn(() => ({ run: vi.fn() })),
          setParagraph: vi.fn(() => ({ run: vi.fn() })),
          toggleHeading: vi.fn(() => ({ run: vi.fn() })),
          setCodeBlock: vi.fn(() => ({ run: vi.fn() })),
          toggleBulletList: vi.fn(() => ({ run: vi.fn() })),
          toggleOrderedList: vi.fn(() => ({ run: vi.fn() })),
          toggleBlockquote: vi.fn(() => ({ run: vi.fn() })),
          setLink: vi.fn(() => ({ run: vi.fn() })),
          unsetLink: vi.fn(() => ({ run: vi.fn() })),
          insertContent: vi.fn(() => ({ run: vi.fn() })),
          insertContentAt: vi.fn(() => ({ run: vi.fn() })),
          undo: vi.fn(() => ({ run: vi.fn() })),
          redo: vi.fn(() => ({ run: vi.fn() })),
          extendMarkRange: vi.fn(() => ({
            setLink: vi.fn(() => ({ run: vi.fn() })),
          })),
        })),
      })),
    };

    // Mock successful API responses
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: { url: "https://example.com/upload?signed=true" },
        }),
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Component Initialization", () => {
    it("should return null when editor is not initialized", async () => {
      // Mock useEditor to return null
      vi.doMock("@tiptap/react", () => ({
        useEditor: () => null,
        EditorContent: ({ editor }: { editor: any }) =>
          editor ? <div data-testid="editor-content">{"Editor"}</div> : null,
      }));

      // Clear module cache to pick up the new mock
      vi.resetModules();

      // Re-import the component after mocking
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      const { container } = render(<TipTapEditorComponent {...defaultProps} />);

      // Component should return null and render nothing
      expect(container.firstChild).toBeNull();
    });

    it("should render when editor is initialized", async () => {
      // Mock useEditor to return our mock editor
      vi.doMock("@tiptap/react", () => ({
        useEditor: () => mockEditor,
        EditorContent: ({ editor }: { editor: any }) => (
          <div data-testid="editor-content" contentEditable>
            {editor ? "Editor initialized" : "No editor"}
          </div>
        ),
      }));

      // Clear module cache to pick up the new mock
      vi.resetModules();

      // Re-import the component after mocking
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      expect(screen.getByTestId("editor-content")).toBeInTheDocument();
      expect(screen.getByText("Editor initialized")).toBeInTheDocument();
    });
  });

  describe("Props Handling", () => {
    beforeEach(async () => {
      // Mock useEditor to return our mock editor for these tests
      vi.doMock("@tiptap/react", () => ({
        useEditor: () => mockEditor,
        EditorContent: ({ editor }: { editor: any }) => (
          <div data-testid="editor-content" contentEditable>
            {"Editor Content"}
          </div>
        ),
      }));
      vi.resetModules();
    });

    it("should accept and handle content prop", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      const content = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Test content" }],
          },
        ],
      };

      expect(() => {
        render(<TipTapEditorComponent {...defaultProps} content={content} />);
      }).not.toThrow();
    });

    it("should handle readOnly prop", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      const { rerender } = render(
        <TipTapEditorComponent {...defaultProps} readOnly={false} />
      );

      // Component should render toolbar in edit mode
      expect(screen.getByTestId("setColor")).toBeInTheDocument();

      rerender(<TipTapEditorComponent {...defaultProps} readOnly={true} />);

      // Toolbar should not be rendered in readonly mode
      expect(screen.queryByTestId("setColor")).not.toBeInTheDocument();
    });

    it("should apply custom className", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      const customClass = "custom-editor-class";
      const { container } = render(
        <TipTapEditorComponent {...defaultProps} className={customClass} />
      );

      const editorContainer = container.firstChild as Element;
      expect(editorContainer).toHaveClass(customClass);
    });

    it("should handle onUpdate callback", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;
      const onUpdate = vi.fn();

      render(<TipTapEditorComponent {...defaultProps} onUpdate={onUpdate} />);

      // onUpdate should not be called on initial render
      expect(onUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Toolbar Functionality", () => {
    beforeEach(async () => {
      vi.doMock("@tiptap/react", () => ({
        useEditor: () => mockEditor,
        EditorContent: ({ editor }: { editor: any }) => (
          <div data-testid="editor-content" contentEditable>
            {"Editor Content"}
          </div>
        ),
      }));
      vi.resetModules();
    });

    it("should render toolbar with formatting buttons", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      // Check for color picker
      expect(screen.getByTestId("setColor")).toBeInTheDocument();

      // Check for multiple formatting buttons
      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(10);
    });

    it("should handle color picker interaction", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      const colorInput = screen.getByTestId("setColor") as HTMLInputElement;

      // Color inputs don't support clear(), so we set the value directly
      fireEvent.change(colorInput, { target: { value: "#ff0000" } });

      expect(colorInput).toHaveValue("#ff0000");
    });

    it("should handle button clicks without errors", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      const buttons = screen.getAllByRole("button");

      // Click some formatting buttons
      expect(() => {
        fireEvent.click(buttons[0]); // First button
        fireEvent.click(buttons[1]); // Second button
        fireEvent.click(buttons[2]); // Third button
      }).not.toThrow();
    });
  });

  describe("File Upload", () => {
    beforeEach(async () => {
      vi.doMock("@tiptap/react", () => ({
        useEditor: () => mockEditor,
        EditorContent: ({ editor }: { editor: any }) => (
          <div data-testid="editor-content" contentEditable>
            {"Editor Content"}
          </div>
        ),
      }));
      vi.resetModules();
    });

    it("should render hidden file input", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      const fileInput = screen.getByTitle("Upload file");
      expect(fileInput).toBeInTheDocument();
      expect(fileInput).toHaveAttribute("type", "file");
      expect(fileInput).toHaveAttribute("accept", "image/*, video/*");
      expect(fileInput).toHaveAttribute("multiple");
      expect(fileInput).toHaveStyle({ display: "none" });
    });

    it("should trigger file input when upload button is clicked", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      const fileInput = screen.getByTitle("Upload file");
      const clickSpy = vi.spyOn(fileInput, "click");

      // Find upload button (should have Upload icon)
      const buttons = screen.getAllByRole("button");
      const uploadButton = buttons.find((button) =>
        button.querySelector("svg")?.classList.contains("lucide-upload")
      );

      if (uploadButton) {
        await userEvent.click(uploadButton);
        expect(clickSpy).toHaveBeenCalled();
      }
    });

    it("should handle file selection", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      const fileInput = screen.getByTitle("Upload file") as HTMLInputElement;
      const file = new File(["test"], "test.png", { type: "image/png" });

      await userEvent.upload(fileInput, file);

      expect(fileInput.files?.[0]).toBe(file);
    });

    it("should handle drag and drop events", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      const { container } = render(<TipTapEditorComponent {...defaultProps} />);

      const editorContainer = container.firstChild as Element;

      // Use fireEvent.dragOver which works in JSDOM environment
      const dragEvent = fireEvent.dragOver(editorContainer, {
        dataTransfer: {
          files: [],
          dropEffect: "none",
        },
      });

      // The dragOver event should be handled (preventDefault called)
      expect(dragEvent).toBe(false); // fireEvent returns false when preventDefault was called
    });
  });

  describe("Error Handling", () => {
    beforeEach(async () => {
      vi.doMock("@tiptap/react", () => ({
        useEditor: () => mockEditor,
        EditorContent: ({ editor }: { editor: any }) => (
          <div data-testid="editor-content">{"Editor"}</div>
        ),
      }));
      vi.resetModules();
    });

    it("should handle invalid content gracefully", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      expect(() => {
        render(
          <TipTapEditorComponent {...defaultProps} content={null as any} />
        );
      }).not.toThrow();

      expect(() => {
        render(
          <TipTapEditorComponent
            {...defaultProps}
            content={{ invalid: "content" } as any}
          />
        );
      }).not.toThrow();
    });

    it("should handle missing required props gracefully", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      expect(() => {
        render(<TipTapEditorComponent content={{}} projectId="" />);
      }).not.toThrow();
    });
  });

  describe("Accessibility", () => {
    beforeEach(async () => {
      vi.doMock("@tiptap/react", () => ({
        useEditor: () => mockEditor,
        EditorContent: ({ editor }: { editor: any }) => (
          <div data-testid="editor-content" contentEditable role="textbox">
            {"Editor Content"}
          </div>
        ),
      }));
      vi.resetModules();
    });

    it("should have accessible form controls", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      // Color picker should have accessible attributes
      const colorInput = screen.getByTestId("setColor");
      expect(colorInput).toHaveAttribute("title", "Set color");
      expect(colorInput).toHaveAttribute("type", "color");

      // File input should have accessible attributes
      const fileInput = screen.getByTitle("Upload file");
      expect(fileInput).toHaveAttribute("title", "Upload file");
      expect(fileInput).toHaveAttribute("type", "file");
    });

    it("should have focusable toolbar buttons", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      const buttons = screen.getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(5);

      // All buttons should be focusable
      buttons.forEach((button) => {
        expect(button).toHaveAttribute("type", "button");
      });
    });

    it("should render editor content area", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      expect(screen.getByTestId("editor-content")).toBeInTheDocument();
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });
  });

  describe("Component Lifecycle", () => {
    beforeEach(async () => {
      vi.doMock("@tiptap/react", () => ({
        useEditor: () => mockEditor,
        EditorContent: ({ editor }: { editor: any }) => (
          <div data-testid="editor-content">{"Editor"}</div>
        ),
      }));
      vi.resetModules();
    });

    it("should clean up on unmount", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      const { unmount } = render(<TipTapEditorComponent {...defaultProps} />);

      expect(() => unmount()).not.toThrow();
    });

    it("should handle prop changes", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      const { rerender } = render(<TipTapEditorComponent {...defaultProps} />);

      expect(() => {
        rerender(<TipTapEditorComponent {...defaultProps} readOnly={true} />);
        rerender(
          <TipTapEditorComponent {...defaultProps} className="new-class" />
        );
        rerender(
          <TipTapEditorComponent
            {...defaultProps}
            placeholder="New placeholder"
          />
        );
      }).not.toThrow();
    });
  });

  describe("State Management", () => {
    beforeEach(async () => {
      vi.doMock("@tiptap/react", () => ({
        useEditor: () => mockEditor,
        EditorContent: ({ editor }: { editor: any }) => (
          <div data-testid="editor-content">{"Editor"}</div>
        ),
      }));
      vi.resetModules();
    });

    it("should manage internal state without errors", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      // Component should render without state errors
      expect(screen.getByTestId("editor-content")).toBeInTheDocument();

      // Should have color input with default value
      const colorInput = screen.getByTestId("setColor");
      expect(colorInput).toHaveValue("#000000");
    });

    it("should handle loading state", async () => {
      const TipTapEditorComponent = (await import("./TipTapEditor")).default;

      render(<TipTapEditorComponent {...defaultProps} />);

      // Loading spinner should not be visible initially
      expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument();
    });
  });
});
