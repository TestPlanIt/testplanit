"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { type ReactNode, useEffect, useState } from "react";

interface CollapsibleSectionProps {
  /**
   * Full localStorage key the collapsed state persists under (e.g.
   * `tpi.milestone.testRuns.collapsed`, stored as "true"/"false" to match the
   * milestone Issues sections). Each section owns a distinct key so its
   * open/closed state sticks independently across reloads.
   */
  storageKey: string;
  /** Header title — text or a node (icon supplied separately). */
  title: ReactNode;
  /** Leading icon rendered before the title in the accordion trigger. */
  icon?: ReactNode;
  /** Extra classes for the accordion item shell (e.g. a completed tint). */
  className?: string;
  /**
   * Padding classes for the content wrapper. Defaults to `"px-6"`; pass `"p-0"`
   * for children that already supply their own padding (e.g. the Issues
   * sections), overriding the accordion's default padding.
   */
  contentClassName?: string;
  /** Collapsed on first render before localStorage is read (default false). */
  defaultCollapsed?: boolean;
  /**
   * Bump this number to force the section open (and persist it) — lets a parent
   * programmatically expand it, e.g. a summary chip that jumps to a collapsed
   * card. Ignored while 0/undefined.
   */
  openSignal?: number;
  "data-testid"?: string;
  children: ReactNode;
}

const ITEM = "section";

/**
 * A single-item accordion that persists its open/closed state to localStorage.
 * Wraps the shared shadcn `Accordion` (which has no persistence of its own) so
 * a page can stack several independently-collapsible sections that each
 * remember their state — the milestone detail page uses one per card.
 *
 * Persistence is read in an effect (not during render) so the server and first
 * client render agree — the section starts at `defaultCollapsed` and snaps to
 * the stored state after mount.
 */
export function CollapsibleSection({
  storageKey,
  title,
  icon,
  className,
  contentClassName = "px-6",
  defaultCollapsed = false,
  openSignal,
  "data-testid": testId,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultCollapsed ? "" : ITEM);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored != null) setOpen(stored === "true" ? "" : ITEM);
    } catch {
      // localStorage unavailable (private mode etc.) — keep the default.
    }
  }, [storageKey]);

  // Force-open when the parent bumps the signal (e.g. a chip jumping here).
  useEffect(() => {
    if (!openSignal) return;
    setOpen(ITEM);
    try {
      window.localStorage.setItem(storageKey, "false");
    } catch {
      // Persistence is best-effort.
    }
  }, [openSignal, storageKey]);

  const handleChange = (value: string) => {
    setOpen(value);
    try {
      // Store the COLLAPSED flag so keys read the same as the Issues sections.
      window.localStorage.setItem(storageKey, String(value === ""));
    } catch {
      // Persistence is best-effort.
    }
  };

  return (
    <Accordion
      type="single"
      collapsible
      value={open}
      onValueChange={handleChange}
      data-testid={testId}
    >
      <AccordionItem value={ITEM} className={className}>
        <AccordionTrigger>
          <span className="flex items-center gap-2 font-semibold">
            {icon}
            {title}
          </span>
        </AccordionTrigger>
        <AccordionContent className={contentClassName}>
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
