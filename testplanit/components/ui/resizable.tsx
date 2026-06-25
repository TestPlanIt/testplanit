import { DragHandleDots2Icon } from "@radix-ui/react-icons";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import * as ResizablePrimitive from "react-resizable-panels";
import type {
  Layout,
  PanelImperativeHandle,
  PanelSize,
} from "react-resizable-panels";

import { cn } from "~/utils";

/**
 * react-resizable-panels v4 compatibility wrapper.
 *
 * v4 renamed the primitives (`PanelGroup`->`Group`, `PanelResizeHandle`->
 * `Separator`), renamed `direction`->`orientation`, removed `onCollapse`/
 * `onExpand`/`order`/`autoSaveId`, switched the imperative ref to a `panelRef`
 * prop, and dropped the `data-panel-group-direction` attribute our handle
 * styling keyed off of. This wrapper keeps the v3-style API our app already
 * uses (`direction`, `autoSaveId`, `onCollapse`/`onExpand`, `order`, numeric
 * `onResize`, `ref`) and translates it to v4 so callers stay unchanged.
 */

type Orientation = "horizontal" | "vertical";

const OrientationContext = createContext<Orientation>("horizontal");

// ---------------------------------------------------------------------------
// Group — accepts v3 `direction` + `autoSaveId`, persists layout via
// localStorage (v4 removed autoSaveId in favour of defaultLayout/onLayoutChanged).
// ---------------------------------------------------------------------------

type ResizablePanelGroupProps = Omit<
  React.ComponentProps<typeof ResizablePrimitive.Group>,
  "orientation"
> & {
  direction?: Orientation;
  autoSaveId?: string;
};

const STORAGE_PREFIX = "rrp:";

const ResizablePanelGroup = ({
  className,
  direction = "horizontal",
  autoSaveId,
  ...props
}: ResizablePanelGroupProps) => {
  const storageKey = autoSaveId ? `${STORAGE_PREFIX}${autoSaveId}` : undefined;

  const [defaultLayout] = useState<Layout | undefined>(() => {
    if (!storageKey || typeof window === "undefined") return undefined;
    try {
      const stored = window.localStorage.getItem(storageKey);
      return stored ? (JSON.parse(stored) as Layout) : undefined;
    } catch {
      return undefined;
    }
  });

  const onLayoutChanged = useCallback(
    (layout: Layout) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(layout));
      } catch {
        // ignore quota / privacy-mode write failures
      }
    },
    [storageKey]
  );

  return (
    <OrientationContext.Provider value={direction}>
      <ResizablePrimitive.Group
        orientation={direction}
        defaultLayout={defaultLayout}
        onLayoutChanged={storageKey ? onLayoutChanged : undefined}
        className={cn(
          "flex h-full w-full",
          direction === "vertical" && "flex-col",
          className
        )}
        {...props}
      />
    </OrientationContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Panel — accepts v3 `ref`, `order`, `onCollapse`/`onExpand`, numeric `onResize`.
// ---------------------------------------------------------------------------

type ResizablePanelProps = Omit<
  React.ComponentProps<typeof ResizablePrimitive.Panel>,
  "panelRef" | "onResize"
> & {
  /** v3 alias: order is derived from DOM order in v4 and ignored here. */
  order?: number;
  /** v3 callbacks removed in v4 — re-derived from onResize below. */
  onCollapse?: () => void;
  onExpand?: () => void;
  /** v3 numeric onResize (percentage). v4 hands back a PanelSize object. */
  onResize?: (size: number) => void;
};

const toPercent = (size: number | string | undefined): number => {
  if (typeof size === "number") return size;
  if (typeof size === "string") return parseFloat(size) || 0;
  return 0;
};

// v3 treated numeric sizes as percentages; v4 treats a bare number as PIXELS.
// Convert numbers to percentage strings so existing numeric props keep their
// v3 meaning (e.g. defaultSize={40} stays 40%, not 40px).
const asPercentSize = (
  size: number | string | undefined
): number | string | undefined =>
  typeof size === "number" ? `${size}%` : size;

const ResizablePanel = forwardRef<PanelImperativeHandle, ResizablePanelProps>(
  (
    {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      order: _order,
      onCollapse,
      onExpand,
      onResize,
      collapsedSize = 0,
      defaultSize,
      minSize,
      maxSize,
      ...props
    },
    ref
  ) => {
    // Track collapse transitions to re-create v3 onCollapse/onExpand. null = not
    // yet initialised, so the first (mount) onResize doesn't fire a spurious event.
    const collapsedRef = useRef<boolean | null>(null);
    const collapsedThreshold = toPercent(collapsedSize) + 0.1;

    const handleResize = useCallback(
      (panelSize: PanelSize) => {
        const pct = panelSize.asPercentage;
        onResize?.(pct);

        const isCollapsed = pct <= collapsedThreshold;
        if (collapsedRef.current === null) {
          collapsedRef.current = isCollapsed;
          return;
        }
        if (isCollapsed !== collapsedRef.current) {
          collapsedRef.current = isCollapsed;
          if (isCollapsed) onCollapse?.();
          else onExpand?.();
        }
      },
      [onResize, onCollapse, onExpand, collapsedThreshold]
    );

    const needsResizeHandler = Boolean(onResize || onCollapse || onExpand);

    return (
      <ResizablePrimitive.Panel
        panelRef={ref}
        collapsedSize={asPercentSize(collapsedSize)}
        defaultSize={asPercentSize(defaultSize)}
        minSize={asPercentSize(minSize)}
        maxSize={asPercentSize(maxSize)}
        onResize={needsResizeHandler ? handleResize : undefined}
        {...props}
      />
    );
  }
);
ResizablePanel.displayName = "ResizablePanel";

// ---------------------------------------------------------------------------
// Handle (Separator) — orientation comes from context (v4 dropped the
// data-panel-group-direction attribute the styling used).
// ---------------------------------------------------------------------------

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
}) => {
  const isVertical = useContext(OrientationContext) === "vertical";

  // Firefox-specific fix: prevent default drag/select behaviour on the handle.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isFirefox = navigator.userAgent.toLowerCase().indexOf("firefox") > -1;
    if (!isFirefox) return;

    const preventDragSelection = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target?.closest("[data-separator]:not([data-disabled])")) {
        e.preventDefault();
      }
    };
    document.addEventListener("dragstart", preventDragSelection);
    document.addEventListener("selectstart", preventDragSelection);
    return () => {
      document.removeEventListener("dragstart", preventDragSelection);
      document.removeEventListener("selectstart", preventDragSelection);
    };
  }, []);

  const { onMouseDown, ...restProps } = props;

  return (
    <ResizablePrimitive.Separator
      disableDoubleClick
      className={cn(
        "relative flex items-center justify-center bg-border focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
        isVertical
          ? "h-px w-full after:absolute after:inset-x-0 after:top-1/2 after:h-1 after:-translate-y-1/2"
          : "w-px after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2",
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
      onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
        // Prevent text selection in Firefox
        if (navigator.userAgent.toLowerCase().indexOf("firefox") > -1) {
          e.preventDefault();
        }
        onMouseDown?.(e);
      }}
      {...restProps}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
          <DragHandleDots2Icon
            className={cn("h-2.5 w-2.5", isVertical && "rotate-90")}
          />
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
};

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
