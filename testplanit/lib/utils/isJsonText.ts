/**
 * Whole-text JSON data (an object or array) that is not a TipTap document.
 * Such text is content to keep verbatim, never markdown or step lines to
 * interpret.
 */
export const isJsonText = (text: string): boolean => {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return (
      typeof parsed === "object" && parsed !== null && parsed.type !== "doc"
    );
  } catch {
    return false;
  }
};
