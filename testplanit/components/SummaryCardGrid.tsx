"use client";

import React from "react";

/** Gap between cards, in px. Must match the `gap-4` class below. */
const CARD_GAP_PX = 16;

/** Narrowest a card may get: the width its chart and date-range subtitle need. */
const MIN_CARD_WIDTH_PX = 340;

interface SummaryCardGridProps {
  children: React.ReactNode;
}

/**
 * Grid for a page's summary chart cards. Column count follows the space the
 * grid actually has (the project menu makes the viewport a poor proxy) and
 * never exceeds the number of cards rendered, so the cards always tile the
 * full width instead of reserving a slot for a card that isn't there.
 *
 * The cap comes from the track minimum: sizing a column at the width it would
 * have if every card sat in one row leaves room for exactly that many
 * columns, while the 340px floor still wraps the row when space runs short.
 * The extra pixel absorbs sub-pixel rounding, which would otherwise drop the
 * last column onto its own row.
 *
 * Cards that render conditionally pass `false` here; those are not counted.
 */
export function SummaryCardGrid({ children }: SummaryCardGridProps) {
  const cardCount = Math.max(1, React.Children.toArray(children).length);
  const fullRowWidth = `calc((100% - ${
    (cardCount - 1) * CARD_GAP_PX
  }px) / ${cardCount} - 1px)`;

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(max(${MIN_CARD_WIDTH_PX}px, ${fullRowWidth}), 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

export default SummaryCardGrid;
