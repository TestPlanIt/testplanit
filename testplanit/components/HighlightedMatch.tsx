import React from "react";

/**
 * Marks the first case-insensitive occurrence of `query` inside `text`, so a
 * filtered list shows which part of each row the filter matched. Rows kept for
 * context rather than for their own name simply render unmarked.
 *
 * A <span> rather than <mark>: the global mark rule adds horizontal padding
 * that pulls the surrounding letters apart mid-word.
 */
export const HighlightedMatch = React.memo(function HighlightedMatch({
  text,
  query,
  testId = "highlighted-match",
}: {
  text: string;
  query: string;
  /** Overridable so callers keep the test id their surface already uses. */
  testId?: string;
}) {
  const needle = query.trim().toLowerCase();
  if (!needle) return <>{text}</>;

  const matchStart = text.toLowerCase().indexOf(needle);
  if (matchStart === -1) return <>{text}</>;
  const matchEnd = matchStart + needle.length;

  return (
    <>
      {text.slice(0, matchStart)}
      <span
        className="bg-warning/30 dark:bg-warning/45 rounded-sm"
        data-testid={testId}
      >
        {text.slice(matchStart, matchEnd)}
      </span>
      {text.slice(matchEnd)}
    </>
  );
});

export default HighlightedMatch;
