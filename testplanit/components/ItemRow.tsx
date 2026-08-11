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

// Upper bound, paired with TIER_CLASS: a slot with both is visible only
// between them. Tailwind emits container variants in ascending width order, so
// the wider `hidden` wins over the narrower `flex` where they overlap.
const TIER_HIDE_ABOVE: Record<ItemRowTier, string> = {
  base: "hidden",
  sm: "@sm:hidden",
  md: "@md:hidden",
  lg: "@lg:hidden",
  xl: "@xl:hidden",
  "2xl": "@2xl:hidden",
  "3xl": "@3xl:hidden",
};

// Block-flavoured tiers, for stacked content like the note.
const TIER_CLASS_BLOCK: Record<ItemRowTier, string> = {
  base: "block",
  sm: "hidden @sm:block",
  md: "hidden @md:block",
  lg: "hidden @lg:block",
  xl: "hidden @xl:block",
  "2xl": "hidden @2xl:block",
  "3xl": "hidden @3xl:block",
};

// `bare` slots keep their tier but drop the layout box.
const TIER_CLASS_BARE: Record<ItemRowTier, string> = {
  base: "contents",
  sm: "hidden @sm:contents",
  md: "hidden @md:contents",
  lg: "hidden @lg:contents",
  xl: "hidden @xl:contents",
  "2xl": "hidden @2xl:contents",
  "3xl": "hidden @3xl:contents",
};

/** Slot lists are built with `cond && {...}` guards, so any falsy value.  */
type MaybeSlot = ItemRowSlot | false | null | undefined | "" | 0;

export interface ItemRowSlot {
  key: string;
  /** Defaults to "base" — always visible. */
  tier?: ItemRowTier;
  /**
   * Render without a layout wrapper (`display: contents`), so the slot's own
   * element becomes the flex item and its sizing rules apply against the row
   * directly. Use for anything that already manages its own width — the
   * milestone source badge measures itself and sheds segments, and an extra
   * wrapper leaves it negotiating against that wrapper instead of the name.
   * Tier visibility still works; only the layout box goes away.
   */
  bare?: boolean;
  /**
   * Never shrink this slot — it shows whole or, once its tier is missed, not
   * at all. For content that reads as nonsense when clipped: a date range cut
   * to "Jul 16 - Ju" is worse than no date range. Pinned identity chips sit
   * outside the shrinking chip group so nothing can clip them.
   */
  pinned?: boolean;
  /** Hide at and above this width — pairs with `tier` to bound a slot on both
   *  sides, so an alternative rendering of the same fact can take over. */
  maxTier?: ItemRowTier;
  content: React.ReactNode;
}

export interface ItemRowProps {
  /** DOM id, used as a scroll target by the list pages. */
  id?: string;
  href: string;
  /** Forwarded to the name's link. Pass `false` on lists that mount every row
   *  at once, where prefetching each destination costs a server render per
   *  row; the row is then fetched on click instead. */
  prefetch?: boolean;
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
  metaTrailing?: MaybeSlot[];
  /** Card edges — flank every line, vertically centred. Used for the milestone
   *  start and end calendars. They supply their own inline spacing, so it can
   *  collapse with them; a gap here would leave a hole behind a hidden edge. */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Only earns space once the row is wide. */
  note?: React.ReactNode;
  /**
   * Put the note directly under the name instead of after the metadata line,
   * where it reads as a description of the name rather than a footnote.
   */
  noteBelowName?: boolean;
  /** Width at which the note earns its line. "base" keeps it at every width,
   *  where it truncates rather than disappearing. */
  noteTier?: ItemRowTier;
  /** Workflow state color — tints the border and background. */
  accentColor?: string | null;
  /**
   * Explicit surface colours, for callers that already resolved them (the
   * milestone status palette is theme-aware and hands back a background and
   * border directly). Takes precedence over `accentColor`.
   */
  surface?: { background?: string; border?: string };
  isNew?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  selectTestId?: string;
}

const renderSlots = (slots: ItemRowProps["chips"], className?: string) =>
  (slots ?? [])
    .filter((slot): slot is ItemRowSlot => Boolean(slot))
    .map((slot) =>
      slot.bare ? (
        <div key={slot.key} className={TIER_CLASS_BARE[slot.tier ?? "base"]}>
          {slot.content}
        </div>
      ) : (
        <div
          key={slot.key}
          className={cn(
            TIER_CLASS[slot.tier ?? "base"],
            slot.maxTier && TIER_HIDE_ABOVE[slot.maxTier],
            "items-center min-w-0",
            className
          )}
        >
          {slot.content}
        </div>
      )
    );

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
  prefetch,
  icon,
  name,
  adornments,
  identityChips,
  state,
  actions,
  chips,
  progress,
  metaTrailing,
  leading,
  trailing,
  note,
  noteBelowName = false,
  noteTier = "xl",
  accentColor,
  surface,
  isNew,
  selectable = false,
  selected = false,
  onSelectedChange,
  selectTestId,
}) => {
  const t = useTranslations("common");

  // `bare` adornments manage their own width, so they belong in the row's
  // negotiation rather than inside the (growable) name block.
  const adornmentSlots = (adornments ?? []).filter(
    (slot): slot is ItemRowSlot => Boolean(slot)
  );
  const bareAdornments = adornmentSlots.filter((slot) => slot.bare);
  const pinnedAdornments = adornmentSlots.filter((slot) => !slot.bare);

  const identitySlots = (identityChips ?? []).filter(
    (slot): slot is ItemRowSlot => Boolean(slot)
  );
  const pinnedIdentity = identitySlots.filter((slot) => slot.pinned);
  const shrinkingIdentity = identitySlots.filter((slot) => !slot.pinned);

  const noteClassName = cn(
    TIER_CLASS_BLOCK[noteTier],
    // One line, ellipsis. `truncate` rather than `line-clamp-1`, whose
    // display:-webkit-box would fight the tier's display value.
    "text-sm text-muted-foreground truncate"
  );
  // Always tooltipped rather than measured: detecting truncation would cost a
  // ResizeObserver per row, and the note is worth reading in full either way.
  const noteEl = note ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={noteClassName}>{note}</div>
      </TooltipTrigger>
      <TooltipContent className="max-w-md">
        <p className="text-sm">{note}</p>
      </TooltipContent>
    </Tooltip>
  ) : null;

  return (
    <div
      id={id}
      className={cn(
        "@container overflow-hidden relative w-full my-2 p-2 border-4 rounded-lg shadow-xs",
        isNew && "border-primary animate-pulse"
      )}
      style={{
        backgroundColor:
          surface?.background ?? (accentColor ? `${accentColor}10` : undefined),
        borderColor:
          surface?.border ??
          (accentColor
            ? isNew
              ? accentColor
              : `${accentColor}44`
            : undefined),
      }}
    >
      <div className="flex items-center">
        {leading}
        <div className="flex flex-col gap-1 min-w-0 flex-1">
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
            {/* Content basis and no grow. A zero basis (`flex-1`) would absorb
              every pixel the chips take, truncating the name first; growing
              would push the adornments below away from the name and give them
              slack so they never start collapsing. The spacer takes the free
              space instead, and shrink weights decide who gives way. */}
            <div className="group flex items-center gap-1 min-w-0 flex-initial">
              <Link
                href={href}
                prefetch={prefetch}
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
              {renderSlots(pinnedAdornments, "shrink-0")}
            </div>
            {/* Self-sizing adornments sit OUTSIDE the name block on purpose. The
              name block grows into free space, so anything nested in it has
              slack and never starts collapsing until the block itself shrinks
              — which reads as the adornment appearing and disappearing rather
              than shedding parts. Out here it negotiates against the row. */}
            {renderSlots(bareAdornments)}
            {/* Absorbs free space so the name and its adornments stay together on
              the leading edge while the state and actions stay on the trailing
              one. Zero basis, so it contributes nothing when space is short. */}
            <div className="flex-1 min-w-0" aria-hidden="true" />
            {/* Outweighs the name's shrink factor, so these give up their width
              first and the name is the last thing to truncate. The weight is
              modest so a self-sizing adornment (shrink-[999]) sheds its parts
              first, rather than these soaking up the whole deficit. `min-w-0`, not
              a floor: a floor reserves its width even when the content is
              shorter (a start date with no end date, say), leaving dead space
              beside the name instead of handing it back. */}
            {shrinkingIdentity.length > 0 && (
              <div className="flex items-center gap-3 shrink-[99] min-w-0 max-w-[45%] overflow-hidden">
                {renderSlots(shrinkingIdentity)}
              </div>
            )}
            {renderSlots(pinnedIdentity, "shrink-0 whitespace-nowrap")}
            {state && <div className="shrink-0 flex items-center">{state}</div>}
            {actions && (
              <div className="shrink-0 flex items-center">{actions}</div>
            )}
          </div>

          {noteBelowName && noteEl}

          {/* Metadata line */}
          {(chips?.some(Boolean) ||
            progress ||
            metaTrailing?.some(Boolean)) && (
            <div className="flex items-center gap-3 min-w-0">
              {/* Chips take only what they need; the progress bar absorbs the
                rest of the line rather than leaving a void beside it. */}
              <div className="flex items-center gap-3 min-w-0 shrink overflow-hidden">
                {renderSlots(chips)}
              </div>
              {progress && <div className="flex-1 min-w-36">{progress}</div>}
              {metaTrailing?.some(Boolean) && (
                <div className="flex items-center gap-3 shrink-0">
                  {renderSlots(metaTrailing, "shrink-0")}
                </div>
              )}
            </div>
          )}

          {!noteBelowName && noteEl}
        </div>
        {trailing}
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
