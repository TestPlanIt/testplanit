/* eslint-disable @next/next/no-img-element */
import { Image } from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import React, { useRef, useState, useEffect } from "react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Maximize,
  Minimize,
  RotateCw,
  Trash2,
  RectangleHorizontal,
  Square,
  Smartphone,
} from "lucide-react";
import { useTranslations } from "next-intl";

const ResizableImageComponent = (props: any) => {
  const { node, updateAttributes, deleteNode, editor } = props;
  const t = useTranslations("common.editor.image");
  const imageRef = useRef<HTMLImageElement>(null);
  const isResizingRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const currentSizeRef = useRef({ width: "", height: "" });
  const [showToolbar, setShowToolbar] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if editor is editable
  const isEditable = editor?.isEditable ?? true;

  // Handle toolbar visibility with delay
  const handleShowToolbar = () => {
    if (!isEditable) return;
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    setShowToolbar(true);
  };

  const handleHideToolbar = () => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowToolbar(false);
    }, 200); // Small delay to allow moving to toolbar
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent, corner: string) => {
    if (!isEditable) return;

    e.preventDefault();
    e.stopPropagation();
    isResizingRef.current = true;

    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) return;

    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      const deltaX = e.clientX - startPosRef.current.x;
      const deltaY = e.clientY - startPosRef.current.y;

      let newWidth = startPosRef.current.width;
      let newHeight = startPosRef.current.height;

      // Calculate new dimensions based on corner
      if (corner.includes("right")) {
        newWidth = startPosRef.current.width + deltaX;
      }
      if (corner.includes("left")) {
        newWidth = startPosRef.current.width - deltaX;
      }
      if (corner.includes("bottom")) {
        newHeight = startPosRef.current.height + deltaY;
      }
      if (corner.includes("top")) {
        newHeight = startPosRef.current.height - deltaY;
      }

      // Maintain aspect ratio when shift is held or when resizing from corners
      const aspectRatio =
        startPosRef.current.width / startPosRef.current.height;
      if (
        e.shiftKey ||
        ((corner.includes("top") || corner.includes("bottom")) &&
          (corner.includes("left") || corner.includes("right")))
      ) {
        // For corner resize, maintain aspect ratio based on the dominant direction
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          newHeight = newWidth / aspectRatio;
        } else {
          newWidth = newHeight * aspectRatio;
        }
      }

      // Minimum size
      newWidth = Math.max(50, newWidth);
      newHeight = Math.max(50, newHeight);

      currentSizeRef.current = {
        width: `${Math.round(newWidth)}px`,
        height: `${Math.round(newHeight)}px`,
      };

      // Update node attributes immediately for live preview
      updateAttributes({
        width: currentSizeRef.current.width,
        height: currentSizeRef.current.height,
      });
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isResizingRef.current = false;

      // Final update with current size
      if (currentSizeRef.current.width && currentSizeRef.current.height) {
        updateAttributes({
          width: currentSizeRef.current.width,
          height: currentSizeRef.current.height,
        });
      }

      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Use node attributes directly for dimensions
  const imageWidth = node.attrs.width || "auto";
  const imageHeight = node.attrs.height || "auto";
  const imageAlign = node.attrs.align || "center";

  // Toolbar control functions
  const handleAlign = (alignment: string) => {
    updateAttributes({ align: alignment });
  };

  const handleResetSize = () => {
    updateAttributes({
      width: null,
      height: null,
    });
  };

  const handleSetSize = (size: "small" | "medium" | "large" | "full") => {
    const sizes = {
      small: { width: "200px", height: "auto" },
      medium: { width: "400px", height: "auto" },
      large: { width: "600px", height: "auto" },
      full: { width: "100%", height: "auto" },
    };
    updateAttributes(sizes[size]);
  };

  const handleRotate = () => {
    const currentRotation = parseInt(node.attrs.rotation || "0");
    const newRotation = (currentRotation + 90) % 360;
    updateAttributes({ rotation: `${newRotation}` });
  };

  // Wrapper styles based on alignment
  const wrapperStyles: React.CSSProperties =
    imageAlign === "center"
      ? {
          display: "flex",
          justifyContent: "center",
          width: "100%",
          clear: "both",
        }
      : imageAlign === "right"
        ? {
            float: "right",
            clear: "right",
            marginLeft: "1rem",
          }
        : imageAlign === "left"
          ? {
              float: "left",
              clear: "left",
              marginRight: "1rem",
            }
          : {};

  return (
    <NodeViewWrapper className="relative" style={wrapperStyles}>
      <div
        className="relative group inline-block"
        onMouseEnter={handleShowToolbar}
        onMouseLeave={handleHideToolbar}
      >
        {/* Toolbar - only show when editable */}
        {showToolbar && isEditable && (
          <div
            className="absolute -top-11 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white rounded-lg shadow-lg p-1 flex gap-1 z-20"
            onMouseEnter={handleShowToolbar}
            onMouseLeave={handleHideToolbar}
          >
            {/* Alignment buttons */}
            <button
              onClick={() => handleAlign("left")}
              className={`p-1.5 rounded hover:bg-gray-700 ${imageAlign === "left" ? "bg-gray-700" : ""}`}
              title={t("alignLeft")}
            >
              <AlignLeft size={16} />
            </button>
            <button
              onClick={() => handleAlign("center")}
              className={`p-1.5 rounded hover:bg-gray-700 ${imageAlign === "center" ? "bg-gray-700" : ""}`}
              title={t("alignCenter")}
            >
              <AlignCenter size={16} />
            </button>
            <button
              onClick={() => handleAlign("right")}
              className={`p-1.5 rounded hover:bg-gray-700 ${imageAlign === "right" ? "bg-gray-700" : ""}`}
              title={t("alignRight")}
            >
              <AlignRight size={16} />
            </button>

            <div className="w-px bg-gray-600 mx-1" />

            {/* Size presets */}
            <button
              onClick={() => handleSetSize("small")}
              className="p-1.5 rounded hover:bg-gray-700"
              title={t("sizeSmall")}
            >
              <Smartphone size={16} />
            </button>
            <button
              onClick={() => handleSetSize("medium")}
              className="p-1.5 rounded hover:bg-gray-700"
              title={t("sizeMedium")}
            >
              <Square size={16} />
            </button>
            <button
              onClick={() => handleSetSize("large")}
              className="p-1.5 rounded hover:bg-gray-700"
              title={t("sizeLarge")}
            >
              <RectangleHorizontal size={16} />
            </button>
            <button
              onClick={() => handleSetSize("full")}
              className="p-1.5 rounded hover:bg-gray-700"
              title={t("sizeFull")}
            >
              <Maximize size={16} />
            </button>
            <button
              onClick={handleResetSize}
              className="p-1.5 rounded hover:bg-gray-700"
              title={t("resetSize")}
            >
              <Minimize size={16} />
            </button>

            <div className="w-px bg-gray-600 mx-1" />

            {/* Other controls */}
            <button
              onClick={handleRotate}
              className="p-1.5 rounded hover:bg-gray-700"
              title={t("rotate")}
            >
              <RotateCw size={16} />
            </button>
            <button
              onClick={deleteNode}
              className="p-1.5 rounded hover:bg-red-600"
              title={t("delete")}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}

        <div
          style={{
            transform:
              node.attrs.rotation && node.attrs.rotation !== "0"
                ? `rotate(${node.attrs.rotation}deg)`
                : undefined,
            transition: "transform 0.2s ease",
            display: "inline-block",
          }}
        >
          <img
            ref={imageRef}
            src={node.attrs.src}
            alt={node.attrs.alt || ""}
            title={node.attrs.title || ""}
            style={{
              width: imageWidth,
              height: imageHeight,
              maxWidth: "100%",
              display: "block",
            }}
            draggable={false}
          />
        </div>

        {/* Resize handles - visible on hover, only show when editable and not rotated */}
        {isEditable &&
          (!node.attrs.rotation || node.attrs.rotation === "0") && (
            <>
              {/* Top-left */}
              <div
                className="absolute -top-1 -left-1 w-3 h-3 bg-blue-500 border border-white cursor-nw-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
                onMouseDown={(e) => handleMouseDown(e, "top-left")}
                style={{ pointerEvents: "auto" }}
              />
              {/* Top-right */}
              <div
                className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 border border-white cursor-ne-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
                onMouseDown={(e) => handleMouseDown(e, "top-right")}
                style={{ pointerEvents: "auto" }}
              />
              {/* Bottom-left */}
              <div
                className="absolute -bottom-1 -left-1 w-3 h-3 bg-blue-500 border border-white cursor-sw-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
                onMouseDown={(e) => handleMouseDown(e, "bottom-left")}
                style={{ pointerEvents: "auto" }}
              />
              {/* Bottom-right */}
              <div
                className="absolute -bottom-1 -right-1 w-3 h-3 bg-blue-500 border border-white cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
                onMouseDown={(e) => handleMouseDown(e, "bottom-right")}
                style={{ pointerEvents: "auto" }}
              />
            </>
          )}
      </div>
    </NodeViewWrapper>
  );
};

export const ImageWithResize = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) =>
          element.style.width || element.getAttribute("width"),
        renderHTML: (attributes) => {
          if (!attributes.width) {
            return {};
          }
          return {
            width: attributes.width,
            style: `width: ${attributes.width}`,
          };
        },
      },
      height: {
        default: null,
        parseHTML: (element) =>
          element.style.height || element.getAttribute("height"),
        renderHTML: (attributes) => {
          if (!attributes.height) {
            return {};
          }
          return {
            height: attributes.height,
            style: `height: ${attributes.height}`,
          };
        },
      },
      align: {
        default: "center",
        parseHTML: (element) => element.getAttribute("data-align") || "center",
        renderHTML: (attributes) => {
          return {
            "data-align": attributes.align,
          };
        },
      },
      rotation: {
        default: "0",
        parseHTML: (element) => element.getAttribute("data-rotation") || "0",
        renderHTML: (attributes) => {
          return {
            "data-rotation": attributes.rotation,
            style: attributes.rotation
              ? `transform: rotate(${attributes.rotation}deg)`
              : "",
          };
        },
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent);
  },
});
