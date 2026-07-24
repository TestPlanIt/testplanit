"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical } from "lucide-react";

import { cn } from "~/utils";

// Below this container width, an action bar collapses its buttons to icon-only
// and reveals each label on hover. Matches the threshold the test-case details
// header pioneered so every action bar behaves identically.
const DEFAULT_COMPACT_BELOW = 768;

/**
 * Measures a container and reports whether it is too narrow to show full action
 * labels. Attach the returned `ref` to the header/toolbar whose width reflects
 * the available space (NOT the button row itself — that would feed back on the
 * collapse). `compact` flips true when that container is narrower than
 * `threshold`, so a bar of action buttons shows `icon + label` when there is
 * room and collapses to icons-with-hover-labels when there isn't.
 */
export function useContainerCompact(threshold: number = DEFAULT_COMPACT_BELOW) {
  const [compact, setCompact] = React.useState(false);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  const ref = React.useCallback(
    (node: HTMLElement | null) => {
      observerRef.current?.disconnect();
      if (node && typeof ResizeObserver !== "undefined") {
        // Sync first read so the bar doesn't flash full-width before the async
        // observer collapses it.
        setCompact(node.offsetWidth > 0 && node.offsetWidth < threshold);
        const ro = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width ?? 0;
          setCompact(width > 0 && width < threshold);
        });
        ro.observe(node);
        observerRef.current = ro;
      }
    },
    [threshold]
  );

  React.useEffect(() => () => observerRef.current?.disconnect(), []);

  return { ref, compact };
}

// ── Compact state sharing ───────────────────────────────────────────────────
// The bar owns the measured `compact` value and shares it with every descendant
// (including shared buttons like RequestReviewButton) via context, so the whole
// bar collapses together without threading a prop through each button.
//
// The default is `undefined` — meaning "not inside an ActionBar". Shared buttons
// use `useActionBarCompact() ?? true` so that outside a bar they keep their
// legacy always-collapsed look, and inside a bar they follow the responsive
// state. This lets the bars be adopted page-by-page without changing the shared
// buttons on pages that haven't been converted yet.
const ActionBarCompactContext = React.createContext<boolean | undefined>(
  undefined
);

export const useActionBarCompact = () =>
  React.useContext(ActionBarCompactContext);

interface ActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Whether the bar should render its buttons in the collapsed icon-only form. */
  compact: boolean;
}

/** Row wrapper that publishes its `compact` state to descendant action buttons. */
export function ActionBar({
  compact,
  className,
  children,
  ...props
}: ActionBarProps) {
  return (
    <ActionBarCompactContext.Provider value={compact}>
      <div className={cn("flex items-center gap-1", className)} {...props}>
        {children}
      </div>
    </ActionBarCompactContext.Provider>
  );
}

/**
 * Classes for an action button: it is always icon-only and reveals its label on
 * hover. (The `compact` arg is accepted for call-site compatibility but no
 * longer changes the result — labels are hover-only in every state.)
 */
export function collapsibleActionClass(_compact?: boolean, extra = "") {
  return cn("group gap-0 transition-all duration-200 hover:gap-2", extra);
}

interface ActionButtonContentProps {
  icon: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  /** Overrides the shared compact state (rarely needed). */
  compact?: boolean;
  iconClassName?: string;
}

/**
 * Renders `icon + label` for an action button. When the surrounding bar is
 * compact the label is clipped to zero width and expands on hover. The label
 * stays in the DOM (only visually clipped) so it remains the button's
 * accessible name. Keep this inside a `<Button className={collapsibleActionClass(...)}>`.
 */
export function ActionButtonContent({
  icon: Icon,
  label,
  iconClassName = "h-4 w-4 shrink-0",
}: ActionButtonContentProps) {
  // Always icon-only; the label reveals on hover.
  return (
    <>
      <Icon className={iconClassName} />
      <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
        {label}
      </span>
    </>
  );
}

// ── Overflow (kebab) ────────────────────────────────────────────────────────
export interface OverflowAction {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Tints the control red (delete-style). */
  destructive?: boolean;
  /** Hides the action entirely (permission gate). */
  hidden?: boolean;
  testId?: string;
  /** Extra classes for the wide-mode button (e.g. a busy pulse). */
  className?: string;
}

/**
 * A set of primary action buttons that shows each as a labeled `outline` button
 * when there's room, and collapses the whole set into a single kebab (⋮) menu
 * when the bar is compact. Controls that open panels/pickers (audit log, request
 * review, version selector) stay outside this — render them as siblings.
 */
export function ActionOverflow({
  compact,
  actions,
  menuLabel,
  menuTestId,
  menuExtras,
}: {
  compact: boolean;
  actions: OverflowAction[];
  menuLabel: string;
  menuTestId?: string;
  /** Extra content appended inside the kebab menu (e.g. a version submenu). */
  menuExtras?: React.ReactNode;
}) {
  const visible = actions.filter((a) => !a.hidden);
  if (visible.length === 0 && !menuExtras) return null;

  if (!compact) {
    return (
      <>
        {visible.map((a) => (
          <Button
            key={a.key}
            type="button"
            variant="outline"
            onClick={a.onClick}
            disabled={a.disabled}
            data-testid={a.testId}
            aria-label={a.label}
            className={cn(
              "group gap-0 transition-all duration-200 hover:gap-2",
              a.destructive && "text-destructive",
              a.className
            )}
          >
            <a.icon className="h-4 w-4 shrink-0" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
              {a.label}
            </span>
          </Button>
        ))}
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={menuLabel}
          data-testid={menuTestId}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Menu items run in reverse of the wide button order (matches the
            repository case details bar). */}
        {[...visible].reverse().map((a) => (
          <DropdownMenuItem
            key={a.key}
            onClick={a.onClick}
            disabled={a.disabled}
            data-testid={a.testId}
            className={cn(
              "flex cursor-pointer items-center",
              a.destructive && "text-destructive"
            )}
          >
            <a.icon className="me-2 h-4 w-4" />
            <span>{a.label}</span>
          </DropdownMenuItem>
        ))}
        {menuExtras}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
