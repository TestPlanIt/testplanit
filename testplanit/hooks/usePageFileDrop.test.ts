import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePageFileDrop } from "./usePageFileDrop";

// --- Mocks ---

const { mockToast } = vi.hoisted(() => ({
  mockToast: { error: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { error: mockToast.error },
}));

// --- Helpers ---

function createDragEvent(type: string, files?: File[]): DragEvent {
  const event = new Event(type, { bubbles: true }) as DragEvent;

  const dataTransfer = {
    types: files ? ["Files"] : [],
    files: files ? files : [],
    dropEffect: "none",
  };

  Object.defineProperty(event, "dataTransfer", {
    value: dataTransfer,
    writable: true,
  });
  Object.defineProperty(event, "preventDefault", {
    value: vi.fn(),
  });

  return event;
}

function createFile(name: string, type = "text/plain"): File {
  return new File(["content"], name, { type });
}

describe("usePageFileDrop", () => {
  const defaultOptions = {
    acceptedExtensions: [".csv", ".xml"],
    enabled: true,
    onDrop: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with isDragActive=false", () => {
    const { result } = renderHook(() => usePageFileDrop(defaultOptions));

    expect(result.current.isDragActive).toBe(false);
  });

  it("should expose isDragActive property", () => {
    const { result } = renderHook(() => usePageFileDrop(defaultOptions));

    expect(result.current).toHaveProperty("isDragActive");
    expect(typeof result.current.isDragActive).toBe("boolean");
  });

  describe("drag state tracking", () => {
    it("should set isDragActive=true on dragenter with Files type", () => {
      const { result } = renderHook(() => usePageFileDrop(defaultOptions));

      act(() => {
        document.dispatchEvent(createDragEvent("dragenter", [createFile("test.csv")]));
      });

      expect(result.current.isDragActive).toBe(true);
    });

    it("should keep isDragActive=true on multiple dragenter events (counter)", () => {
      const { result } = renderHook(() => usePageFileDrop(defaultOptions));

      act(() => {
        document.dispatchEvent(createDragEvent("dragenter", [createFile("test.csv")]));
        document.dispatchEvent(createDragEvent("dragenter", [createFile("test.csv")]));
      });

      // Still active — counter went from 0→1→2
      expect(result.current.isDragActive).toBe(true);
    });

    it("should set isDragActive=false after matching dragleave", () => {
      const { result } = renderHook(() => usePageFileDrop(defaultOptions));

      act(() => {
        document.dispatchEvent(createDragEvent("dragenter", [createFile("test.csv")]));
      });

      expect(result.current.isDragActive).toBe(true);

      act(() => {
        document.dispatchEvent(createDragEvent("dragleave", [createFile("test.csv")]));
      });

      expect(result.current.isDragActive).toBe(false);
    });

    it("should only clear isDragActive when counter reaches 0 after multiple enters", () => {
      const { result } = renderHook(() => usePageFileDrop(defaultOptions));

      // Enter twice
      act(() => {
        document.dispatchEvent(createDragEvent("dragenter", [createFile("test.csv")]));
        document.dispatchEvent(createDragEvent("dragenter", [createFile("test.csv")]));
      });

      // Leave once — counter=1, still active
      act(() => {
        document.dispatchEvent(createDragEvent("dragleave", [createFile("test.csv")]));
      });

      expect(result.current.isDragActive).toBe(true);

      // Leave again — counter=0, no longer active
      act(() => {
        document.dispatchEvent(createDragEvent("dragleave", [createFile("test.csv")]));
      });

      expect(result.current.isDragActive).toBe(false);
    });

    it("should not set isDragActive=true when dragenter has no Files type", () => {
      const { result } = renderHook(() => usePageFileDrop(defaultOptions));

      act(() => {
        document.dispatchEvent(createDragEvent("dragenter")); // No files
      });

      expect(result.current.isDragActive).toBe(false);
    });

    it("should reset isDragActive=false on drop", () => {
      const { result } = renderHook(() => usePageFileDrop(defaultOptions));

      act(() => {
        document.dispatchEvent(createDragEvent("dragenter", [createFile("test.csv")]));
      });

      expect(result.current.isDragActive).toBe(true);

      act(() => {
        document.dispatchEvent(createDragEvent("drop", [createFile("test.csv")]));
      });

      expect(result.current.isDragActive).toBe(false);
    });
  });

  describe("when disabled", () => {
    it("should not respond to dragenter when enabled=false", () => {
      const { result } = renderHook(() =>
        usePageFileDrop({ ...defaultOptions, enabled: false })
      );

      act(() => {
        document.dispatchEvent(createDragEvent("dragenter", [createFile("test.csv")]));
      });

      expect(result.current.isDragActive).toBe(false);
    });

    it("should not call onDrop when enabled=false", () => {
      const onDrop = vi.fn();
      renderHook(() =>
        usePageFileDrop({ ...defaultOptions, enabled: false, onDrop })
      );

      act(() => {
        document.dispatchEvent(createDragEvent("drop", [createFile("test.csv")]));
      });

      expect(onDrop).not.toHaveBeenCalled();
    });

    it("should not add event listeners when enabled=false", () => {
      const addEventListenerSpy = vi.spyOn(document, "addEventListener");

      renderHook(() =>
        usePageFileDrop({ ...defaultOptions, enabled: false })
      );

      // Should not add the drag event listeners
      const dragListenerCalls = addEventListenerSpy.mock.calls
        .map((call) => call[0])
        .filter((type) => ["dragenter", "dragleave", "dragover", "drop"].includes(type));

      expect(dragListenerCalls).toHaveLength(0);

      addEventListenerSpy.mockRestore();
    });
  });

  describe("file handling", () => {
    it("should call onDrop with valid files on drop", () => {
      const onDrop = vi.fn();
      renderHook(() => usePageFileDrop({ ...defaultOptions, onDrop }));

      const csvFile = createFile("report.csv");

      act(() => {
        document.dispatchEvent(createDragEvent("drop", [csvFile]));
      });

      expect(onDrop).toHaveBeenCalledWith([csvFile]);
    });

    it("should call onDrop with multiple valid files", () => {
      const onDrop = vi.fn();
      renderHook(() => usePageFileDrop({ ...defaultOptions, onDrop }));

      const file1 = createFile("report1.csv");
      const file2 = createFile("report2.csv");

      act(() => {
        document.dispatchEvent(createDragEvent("drop", [file1, file2]));
      });

      expect(onDrop).toHaveBeenCalledWith([file1, file2]);
    });

    it("should filter out invalid file types and only call onDrop with valid ones", () => {
      const onDrop = vi.fn();
      renderHook(() => usePageFileDrop({ ...defaultOptions, onDrop }));

      const csvFile = createFile("report.csv");
      const pdfFile = createFile("document.pdf");

      act(() => {
        document.dispatchEvent(createDragEvent("drop", [csvFile, pdfFile]));
      });

      // Only valid file passed to onDrop
      expect(onDrop).toHaveBeenCalledWith([csvFile]);
    });

    it("should show toast error when all dropped files are invalid", () => {
      const onDrop = vi.fn();
      renderHook(() => usePageFileDrop({ ...defaultOptions, onDrop }));

      const pdfFile = createFile("document.pdf");

      act(() => {
        document.dispatchEvent(createDragEvent("drop", [pdfFile]));
      });

      expect(onDrop).not.toHaveBeenCalled();
      expect(mockToast.error).toHaveBeenCalledTimes(1);
    });

    it("should use custom unsupportedMessage for error toast", () => {
      const onDrop = vi.fn();
      const customMessage = "Only CSV files are supported";
      renderHook(() =>
        usePageFileDrop({
          ...defaultOptions,
          onDrop,
          unsupportedMessage: customMessage,
        })
      );

      act(() => {
        document.dispatchEvent(createDragEvent("drop", [createFile("document.pdf")]));
      });

      expect(mockToast.error).toHaveBeenCalledWith(customMessage);
    });

    it("should show default error message when unsupportedMessage not provided", () => {
      const onDrop = vi.fn();
      renderHook(() =>
        usePageFileDrop({
          acceptedExtensions: [".csv"],
          enabled: true,
          onDrop,
          // No unsupportedMessage
        })
      );

      act(() => {
        document.dispatchEvent(createDragEvent("drop", [createFile("document.pdf")]));
      });

      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringContaining(".csv")
      );
    });

    it("should not call onDrop when dropped files list is empty", () => {
      const onDrop = vi.fn();
      renderHook(() => usePageFileDrop({ ...defaultOptions, onDrop }));

      act(() => {
        // Drop event with empty files
        const event = createDragEvent("drop");
        (event.dataTransfer as any).files = [];
        document.dispatchEvent(event);
      });

      expect(onDrop).not.toHaveBeenCalled();
    });

    it("should match file extensions case-insensitively", () => {
      const onDrop = vi.fn();
      renderHook(() =>
        usePageFileDrop({
          acceptedExtensions: [".CSV"],
          enabled: true,
          onDrop,
        })
      );

      // lowercase extension file should still be accepted
      const csvFile = createFile("data.csv");

      act(() => {
        document.dispatchEvent(createDragEvent("drop", [csvFile]));
      });

      expect(onDrop).toHaveBeenCalledWith([csvFile]);
    });
  });

  describe("event listener cleanup", () => {
    it("should remove event listeners on unmount", () => {
      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      const { unmount } = renderHook(() => usePageFileDrop(defaultOptions));

      unmount();

      const removedTypes = removeEventListenerSpy.mock.calls.map((call) => call[0]);
      expect(removedTypes).toContain("dragenter");
      expect(removedTypes).toContain("dragleave");
      expect(removedTypes).toContain("dragover");
      expect(removedTypes).toContain("drop");

      removeEventListenerSpy.mockRestore();
    });

    it("should reset isDragActive to false when enabled becomes false", () => {
      let _enabled = true;
      const { result, rerender } = renderHook(
        ({ en }: { en: boolean }) =>
          usePageFileDrop({ ...defaultOptions, enabled: en }),
        { initialProps: { en: true } }
      );

      // Set drag active
      act(() => {
        document.dispatchEvent(createDragEvent("dragenter", [createFile("test.csv")]));
      });

      expect(result.current.isDragActive).toBe(true);

      // Disable the hook
      rerender({ en: false });

      // isDragActive should be reset
      expect(result.current.isDragActive).toBe(false);
    });
  });
});
