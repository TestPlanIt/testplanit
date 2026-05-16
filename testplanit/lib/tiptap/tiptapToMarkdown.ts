// TipTap-doc → GitHub-markdown serializer — implementation lands with INT-05.

/**
 * Flatten a TipTap document into GitHub-flavored markdown. Used by the
 * GitHub Issues adapter (which expects literal markdown in the description
 * body). Jira and Azure DevOps adapters already convert TipTap docs to
 * their native formats via `tiptapToAdf` / `extractTextFromTiptap`.
 *
 * Input is typed as `unknown` so the server bundle does not need to
 * import the editor's runtime types. The implementation will narrow.
 */
export function tiptapToMarkdown(doc: unknown): string {
  void doc;
  throw new Error(
    "tiptapToMarkdown: not implemented yet (lands with INT-05)"
  );
}
