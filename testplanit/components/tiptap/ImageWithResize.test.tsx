import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock @tiptap/react NodeViewWrapper
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children, className, style }: any) => (
    <div data-testid="node-view-wrapper" className={className} style={style}>
      {children}
    </div>
  ),
  ReactNodeViewRenderer: (component: any) => component,
}));

// Mock @tiptap/extension-image
vi.mock("@tiptap/extension-image", () => ({
  Image: {
    extend: (config: any) => ({
      ...config,
      name: "image-with-resize",
    }),
  },
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  AlignLeft: () => <svg data-testid="icon-align-left" />,
  AlignCenter: () => <svg data-testid="icon-align-center" />,
  AlignRight: () => <svg data-testid="icon-align-right" />,
  Maximize: () => <svg data-testid="icon-maximize" />,
  Minimize: () => <svg data-testid="icon-minimize" />,
  RectangleHorizontal: () => <svg data-testid="icon-rectangle-horizontal" />,
  RotateCw: () => <svg data-testid="icon-rotate-cw" />,
  Smartphone: () => <svg data-testid="icon-smartphone" />,
  Square: () => <svg data-testid="icon-square" />,
  Trash2: () => <svg data-testid="icon-trash2" />,
}));

// We need to import the module-level ResizableImageComponent.
// Since it's not exported, we test via rendering after mocking ReactNodeViewRenderer
// to capture the component reference.

// Create a simple wrapper to render ResizableImageComponent directly.
// The component is defined in the module and used by ImageWithResize.
// We'll import it as a dynamic module-level const via the module's closure.

// Helper to create default props for ResizableImageComponent
function createDefaultProps(overrides: any = {}) {
  return {
    node: {
      attrs: {
        src: "https://example.com/test.jpg",
        alt: "Test image",
        title: "Test title",
        width: "200px",
        height: "auto",
        align: "center",
        rotation: "0",
      },
    },
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    editor: { isEditable: true },
    ...overrides,
  };
}

// To access ResizableImageComponent, we use a trick:
// ReactNodeViewRenderer is mocked to just return the component, so we
// can call addNodeView() from ImageWithResize and get the component back.
async function getResizableImageComponent() {
  const { ImageWithResize } = await import("./ImageWithResize");
  // ImageWithResize is the result of Image.extend({ addNodeView() { return ReactNodeViewRenderer(ResizableImageComponent) } })
  // Since ReactNodeViewRenderer is mocked to return its argument, we call addNodeView() to get the component.
  const nodeViewFn = (ImageWithResize as any).addNodeView?.();
  return nodeViewFn;
}

describe("ImageWithResize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("ImageWithResize extension", () => {
    it("exports ImageWithResize as an extension", async () => {
      const { ImageWithResize } = await import("./ImageWithResize");
      expect(ImageWithResize).toBeDefined();
    });
  });

  describe("ResizableImageComponent rendering", () => {
    it("renders an img element with the correct src from node attrs", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps();

      render(<Component {...props} />);

      const img = screen.getByRole("img");
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute("src", "https://example.com/test.jpg");
    });

    it("renders img with alt text from node attrs", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps();

      render(<Component {...props} />);

      const img = screen.getByRole("img");
      expect(img).toHaveAttribute("alt", "Test image");
    });

    it("applies width and height from node attrs as inline styles", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps({
        node: {
          attrs: {
            src: "https://example.com/test.jpg",
            alt: "some alt",
            title: "",
            width: "400px",
            height: "300px",
            align: "center",
            rotation: "0",
          },
        },
      });

      render(<Component {...props} />);

      const img = screen.getByRole("img");
      expect(img).toHaveStyle({ width: "400px", height: "300px" });
    });

    it("does not render toolbar initially (showToolbar is false)", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps();

      render(<Component {...props} />);

      // Toolbar buttons should not be present until hover
      expect(screen.queryByTitle("alignLeft")).not.toBeInTheDocument();
      expect(screen.queryByTitle("alignCenter")).not.toBeInTheDocument();
      expect(screen.queryByTitle("delete")).not.toBeInTheDocument();
    });
  });

  describe("Toolbar visibility on hover", () => {
    it("shows toolbar on mouse enter when editor is editable", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps();

      render(<Component {...props} />);

      // The inner div that has mouse handlers
      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;

      fireEvent.mouseEnter(innerDiv);

      // Toolbar should now be visible
      expect(screen.getByTitle("alignLeft")).toBeInTheDocument();
      expect(screen.getByTitle("alignCenter")).toBeInTheDocument();
      expect(screen.getByTitle("alignRight")).toBeInTheDocument();
    });

    it("shows size preset buttons in toolbar", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps();

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      expect(screen.getByTitle("sizeSmall")).toBeInTheDocument();
      expect(screen.getByTitle("sizeMedium")).toBeInTheDocument();
      expect(screen.getByTitle("sizeLarge")).toBeInTheDocument();
      expect(screen.getByTitle("sizeFull")).toBeInTheDocument();
    });

    it("shows rotate and delete buttons in toolbar", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps();

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      expect(screen.getByTitle("rotate")).toBeInTheDocument();
      expect(screen.getByTitle("delete")).toBeInTheDocument();
    });

    it("hides toolbar when editor is not editable (read-only)", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps({ editor: { isEditable: false } });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      // Toolbar should NOT appear in read-only mode
      expect(screen.queryByTitle("alignLeft")).not.toBeInTheDocument();
      expect(screen.queryByTitle("delete")).not.toBeInTheDocument();
    });

    it("hides toolbar after mouse leave with delay", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps();

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;

      fireEvent.mouseEnter(innerDiv);
      expect(screen.getByTitle("delete")).toBeInTheDocument();

      fireEvent.mouseLeave(innerDiv);

      // Toolbar should still be visible before timeout
      expect(screen.getByTitle("delete")).toBeInTheDocument();

      // Advance timers to trigger the hide timeout (200ms)
      act(() => {
        vi.advanceTimersByTime(250);
      });

      expect(screen.queryByTitle("delete")).not.toBeInTheDocument();
    });
  });

  describe("Toolbar interactions", () => {
    it("calls updateAttributes with align='left' when left alignment button is clicked", async () => {
      const Component = await getResizableImageComponent();
      const updateAttributes = vi.fn();
      const props = createDefaultProps({ updateAttributes });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("alignLeft"));
      expect(updateAttributes).toHaveBeenCalledWith({ align: "left" });
    });

    it("calls updateAttributes with align='center' when center alignment button is clicked", async () => {
      const Component = await getResizableImageComponent();
      const updateAttributes = vi.fn();
      const props = createDefaultProps({ updateAttributes });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("alignCenter"));
      expect(updateAttributes).toHaveBeenCalledWith({ align: "center" });
    });

    it("calls updateAttributes with align='right' when right alignment button is clicked", async () => {
      const Component = await getResizableImageComponent();
      const updateAttributes = vi.fn();
      const props = createDefaultProps({ updateAttributes });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("alignRight"));
      expect(updateAttributes).toHaveBeenCalledWith({ align: "right" });
    });

    it("calls deleteNode when delete button is clicked", async () => {
      const Component = await getResizableImageComponent();
      const deleteNode = vi.fn();
      const props = createDefaultProps({ deleteNode });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("delete"));
      expect(deleteNode).toHaveBeenCalledTimes(1);
    });

    it("calls updateAttributes with small width when small preset clicked", async () => {
      const Component = await getResizableImageComponent();
      const updateAttributes = vi.fn();
      const props = createDefaultProps({ updateAttributes });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("sizeSmall"));
      expect(updateAttributes).toHaveBeenCalledWith({ width: "200px", height: "auto" });
    });

    it("calls updateAttributes with medium width when medium preset clicked", async () => {
      const Component = await getResizableImageComponent();
      const updateAttributes = vi.fn();
      const props = createDefaultProps({ updateAttributes });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("sizeMedium"));
      expect(updateAttributes).toHaveBeenCalledWith({ width: "400px", height: "auto" });
    });

    it("calls updateAttributes with large width when large preset clicked", async () => {
      const Component = await getResizableImageComponent();
      const updateAttributes = vi.fn();
      const props = createDefaultProps({ updateAttributes });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("sizeLarge"));
      expect(updateAttributes).toHaveBeenCalledWith({ width: "600px", height: "auto" });
    });

    it("calls updateAttributes with full width when full preset clicked", async () => {
      const Component = await getResizableImageComponent();
      const updateAttributes = vi.fn();
      const props = createDefaultProps({ updateAttributes });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("sizeFull"));
      expect(updateAttributes).toHaveBeenCalledWith({ width: "100%", height: "auto" });
    });

    it("calls updateAttributes with rotation incremented by 90 when rotate button clicked", async () => {
      const Component = await getResizableImageComponent();
      const updateAttributes = vi.fn();
      const props = createDefaultProps({
        updateAttributes,
        node: {
          attrs: {
            src: "https://example.com/test.jpg",
            alt: "",
            title: "",
            width: "auto",
            height: "auto",
            align: "center",
            rotation: "0",
          },
        },
      });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("rotate"));
      expect(updateAttributes).toHaveBeenCalledWith({ rotation: "90" });
    });

    it("calls updateAttributes with null dimensions when reset size clicked", async () => {
      const Component = await getResizableImageComponent();
      const updateAttributes = vi.fn();
      const props = createDefaultProps({ updateAttributes });

      render(<Component {...props} />);

      const wrapper = screen.getByTestId("node-view-wrapper");
      const innerDiv = wrapper.firstChild as HTMLElement;
      fireEvent.mouseEnter(innerDiv);

      fireEvent.click(screen.getByTitle("resetSize"));
      expect(updateAttributes).toHaveBeenCalledWith({ width: null, height: null });
    });
  });

  describe("Resize handles", () => {
    it("renders resize handles when editor is editable and no rotation", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps();

      const { container } = render(<Component {...props} />);

      // Resize handles use specific cursor classes
      const handles = container.querySelectorAll(
        "[class*='cursor-nw-resize'], [class*='cursor-ne-resize'], [class*='cursor-sw-resize'], [class*='cursor-se-resize']"
      );
      expect(handles.length).toBe(4);
    });

    it("does not render resize handles when editor is not editable", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps({ editor: { isEditable: false } });

      const { container } = render(<Component {...props} />);

      const handles = container.querySelectorAll(
        "[class*='cursor-nw-resize'], [class*='cursor-ne-resize'], [class*='cursor-sw-resize'], [class*='cursor-se-resize']"
      );
      expect(handles.length).toBe(0);
    });

    it("does not render resize handles when image is rotated", async () => {
      const Component = await getResizableImageComponent();
      const props = createDefaultProps({
        node: {
          attrs: {
            src: "https://example.com/test.jpg",
            alt: "",
            title: "",
            width: "auto",
            height: "auto",
            align: "center",
            rotation: "90",
          },
        },
      });

      const { container } = render(<Component {...props} />);

      const handles = container.querySelectorAll(
        "[class*='cursor-nw-resize'], [class*='cursor-ne-resize'], [class*='cursor-sw-resize'], [class*='cursor-se-resize']"
      );
      expect(handles.length).toBe(0);
    });
  });
});
