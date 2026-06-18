/**
 * Wrap plain text in a minimal TipTap (ProseMirror) document so it renders
 * in the in-app step editor. Empty (or whitespace-only) text produces a
 * paragraph with an EMPTY content array — an empty text node
 * (`{ type: "text", text: "" }`) is invalid in ProseMirror.
 *
 * Shared, pure helper (promoted from a private `TestPlanItClient` method) so
 * both the client's step-write methods and step-derivation callers that write
 * to the database directly produce identical TipTap docs. No imports, no side
 * effects — uses only `JSON.stringify`.
 */
export function tipTapDoc(text: string): string {
  const trimmed = text.trim();
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: trimmed ? [{ type: "text", text: trimmed }] : [],
      },
    ],
  });
}
