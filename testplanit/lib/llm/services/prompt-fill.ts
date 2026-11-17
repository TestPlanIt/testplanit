/**
 * `{{NAME}}` substitution for prompt templates. An unknown placeholder is
 * left as written: a prompt a user edited keeps saying what it says instead
 * of silently losing a line, and the gap is visible in the model's answer.
 */
export function fillPrompt(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(
    /\{\{\s*([A-Z0-9_]+)\s*\}\}/g,
    (match, name: string) => (name in vars ? vars[name] : match)
  );
}
