import { DragHandleDots2Icon } from "@radix-ui/react-icons";
import * as ResizablePrimitive from "react-resizable-panels";
import { useEffect } from "react";

import { cn } from "~/utils";

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => {
  // Firefox-specific fix: Prevent default drag behavior
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if Firefox
    const isFirefox = navigator.userAgent.toLowerCase().indexOf("firefox") > -1;
    if (!isFirefox) return;

    const preventDragSelection = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target?.closest('[data-panel-resize-handle-enabled="true"]')) {
        e.preventDefault();
      }
    };

    // Add event listeners for Firefox
    document.addEventListener("dragstart", preventDragSelection);
    document.addEventListener("selectstart", preventDragSelection);

    return () => {
      document.removeEventListener("dragstart", preventDragSelection);
      document.removeEventListener("selectstart", preventDragSelection);
    };
  }, []);

  // Extract onMouseDown to handle it separately
  const { onMouseDown, ...restProps } = props;

  return (
    <ResizablePrimitive.PanelResizeHandle
      className={cn(
        "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90",
        className
      )}
      style={
        {
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          MozUserSelect: "none",
          msUserSelect: "none",
        } as React.CSSProperties
      }
      onMouseDown={(e: any) => {
        // Prevent text selection in Firefox
        if (navigator.userAgent.toLowerCase().indexOf("firefox") > -1) {
          e.preventDefault();
        }
        if (onMouseDown) {
          onMouseDown(e);
        }
      }}
      {...restProps}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
          <DragHandleDots2Icon className="h-2.5 w-2.5" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  );
};

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
