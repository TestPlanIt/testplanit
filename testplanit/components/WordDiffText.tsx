"use client";

import { Fragment, useMemo } from "react";
import { diffWords, groupDiffParts } from "~/utils/wordDiff";

/**
 * Two texts as one, with removed words struck out and added words marked.
 * `grouped` joins neighbouring changes into one removed and one added run.
 */
export function WordDiffText({
  before,
  after,
  grouped = false,
}: {
  before: string;
  after: string;
  grouped?: boolean;
}) {
  const parts = useMemo(() => {
    const words = diffWords(before, after);
    return grouped ? groupDiffParts(words) : words;
  }, [before, after, grouped]);
  return (
    <div className="rounded-md bg-muted/30 p-2 text-sm break-words whitespace-pre-wrap">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part.added ? (
            <ins className="rounded-sm bg-green-100 px-0.5 no-underline dark:bg-green-950">
              {part.value}
            </ins>
          ) : part.removed ? (
            <del className="rounded-sm bg-red-100 px-0.5 dark:bg-red-950">
              {part.value}
            </del>
          ) : (
            part.value
          )}
        </Fragment>
      ))}
    </div>
  );
}
