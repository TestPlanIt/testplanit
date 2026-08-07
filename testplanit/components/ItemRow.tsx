"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";
import React from "react";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";

/**
 * Container width at which a slot earns its place. Sized against the slots
 * themselves — a metadata chip is 100-200px, so it stays until the row really
 * can't seat it. These are deliberately far below the 768/1024 thresholds the
 * action bars use; a toolbar of buttons needs much more room than a chip.
 */
export type ItemRowTier = "base" | "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

// Written out rather than composed, so Tailwind's scanner sees each class.
const TIER_CLASS: Record<ItemRowTier, string> = {
  base: "flex",
  sm: "hidden @sm:flex", // 384px
  md: "hidden @md:flex", // 448px
  lg: "hidden @lg:flex", // 512px
  xl: "hidden @xl:flex", // 576px
  "2xl": "hidden @2xl:flex", // 672px
  "3xl": "hidden @3xl:flex", // 768px
};

/** Slot lists are built with `cond && {...}` guards, so any falsy value.  */
type MaybeSlot = ItemRowSlot | false | null | undefined | "" | 0;

export interface ItemRowSlot {
  key: string;
  /** Defaults to "base" — always visible. */
  tier?: ItemRowTier;
  content: React.ReactNode;
}

export interface ItemRowProps {
  /** DOM id, used as a scroll target by the list pages. */
  id?: string;
  href: string;
  /** Leading type glyph. */
  icon: React.ReactNode;
  name: string;
  /** Small glyphs beside the name — new, multi-config, locked, review. */
  adornments?: MaybeSlot[];
  /** Identity line, before the state — fills the gap the name leaves. */
  identityChips?: MaybeSlot[];
  /** Trailing end of the identity line; the workflow state. */
  state?: React.ReactNode;
  /** Trailing end of the identity line, after the state. */
  actions?: React.ReactNode;
  /** Metadata line, leading edge. Each chip drops on its own tier. */
  chips?: MaybeSlot[];
  /** Metadata line, between the chips and the trailing slots. */
  progress?: React.ReactNode;
  /** Metadata line, pinned to the trailing edge so it forms a scan column. */
  trailing?: MaybeSlot[];
  /** Third line. Only earns space once the row is wide. */
  note?: React.ReactNode;
  /** Workflow state color — tints the border and background. */
  accentColor?: string | null;
  isNew?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  selectTestId?: string;
}

const renderSlots = (slots: ItemRowProps["chips"], className?: string) =>
  (slots ?? [])
    .filter((slot): slot is ItemRowSlot => Boolean(slot))
    .map((slot) => (
      <div
        key={slot.key}
        className={cn(
          TIER_CLASS[slot.tier ?? "base"],
          "items-center min-w-0",
          className
        )}
      >
        {slot.content}
      </div>
    ));

/**
 * The shared run/session list row.
 *
 * Two lines by design: identity reads first and never collapses, metadata
 * follows and thins out chip by chip as the container narrows. The row is its
 * own query container, so a narrow Overview panel collapses independently of
 * the viewport.
 */
export const ItemRow: React.FC<ItemRowProps> = ({
  id,
  href,
  icon,
  name,
  adornments,
  identityChips,
  state,
  actions,
  chips,
  progress,
  trailing,
  note,
  accentColor,
  isNew,
  selectable = false,
  selected = false,
  onSelectedChange,
  selectTestId,
}) => {
  const t = useTranslations("common");

  return (
    <div
      id={id}
      className={cn(
        "@container overflow-hidden relative w-full my-2 p-2 border-4 rounded-lg shadow-xs",
        isNew && "border-primary animate-pulse"
      )}
      style={{
        backgroundColor: accentColor ? `${accentColor}10` : undefined,
        borderColor: accentColor
          ? isNew
            ? accentColor
            : `${accentColor}44`
          : undefined,
      }}
    >
      <div className="flex flex-col gap-1">
        {/* Identity line */}
        <div className="flex items-center gap-2 min-w-0">
          {selectable && (
            <Checkbox
              checked={selected}
              onCheckedChange={(checked) =>
                onSelectedChange?.(checked === true)
              }
              aria-label={t("bulk.selectItem")}
              className="shrink-0"
              data-testid={selectTestId}
            />
          )}
          {/* `flex-auto`, not `flex-1`: a zero flex-basis would make this absorb
              every pixel the configuration takes, truncating the name first.
              With a content basis the two shrink against each other, and the
              weighting below decides which one gives way. */}
          <div className="group flex items-center gap-1 min-w-0 flex-auto">
            <Link
              href={href}
              className="inline-flex items-center gap-1 min-w-0 max-w-full"
            >
              <h3 className="text-sm font-semibold flex items-center gap-1 hover:text-primary min-w-0">
                <span className="shrink-0 flex items-center">{icon}</span>
                {/* The name is the one thing that never collapses, so it
                    truncates instead — the tooltip carries the rest. */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate inline-block">{name}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-sm">{name}</p>
                  </TooltipContent>
                </Tooltip>
              </h3>
            </Link>
            {renderSlots(adornments, "shrink-0")}
          </div>
          {/* Outweighs the name's shrink factor, so the configuration gives up
              its width first and truncates down to `min-w-20` before the run
              name loses a single character. */}
          {identityChips?.some(Boolean) && (
            <div className="flex items-center gap-3 shrink-[9999] min-w-20 max-w-[45%] overflow-hidden">
              {renderSlots(identityChips)}
            </div>
          )}
          {state && <div className="shrink-0 flex items-center">{state}</div>}
          {actions && (
            <div className="shrink-0 flex items-center">{actions}</div>
          )}
        </div>

        {/* Metadata line */}
        {(chips?.some(Boolean) || progress || trailing?.some(Boolean)) && (
          <div className="flex items-center gap-3 min-w-0">
            {/* Chips take only what they need; the progress bar absorbs the
                rest of the line rather than leaving a void beside it. */}
            <div className="flex items-center gap-3 min-w-0 shrink overflow-hidden">
              {renderSlots(chips)}
            </div>
            {progress && <div className="flex-1 min-w-36">{progress}</div>}
            {trailing?.some(Boolean) && (
              <div className="flex items-center gap-3 shrink-0">
                {renderSlots(trailing, "shrink-0")}
              </div>
            )}
          </div>
        )}

        {note && (
          <div className="hidden @xl:block text-sm text-muted-foreground line-clamp-1">
            {note}
          </div>
        )}
      </div>
    </div>
  );
};

/** The common chip body: a small glyph followed by truncating text. */
export const ItemRowChip: React.FC<{
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ icon, children }) => (
  <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
    {icon && <span className="shrink-0 flex items-center">{icon}</span>}
    <span className="truncate">{children}</span>
  </div>
);

export default ItemRow;
