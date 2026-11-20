import type { JSONContent } from "@tiptap/core";

/**
 * TestRail writes a test data variable as its name between percent signs
 * (`%username%`). A lone percent sign, or text with spaces between two of
 * them ("50% of 100%"), is not a variable.
 */
const VARIABLE_SOURCE = String.raw`%([A-Za-z_][A-Za-z0-9_-]*)%`;

/** Names of the TestRail variables in a text, in order of first use. */
export function findTestRailVariables(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(new RegExp(VARIABLE_SOURCE, "g"))) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

const isCode = (node: JSONContent) =>
  node.marks?.some((mark) => mark.type === "code") ?? false;

/**
 * Replaces TestRail variables in a rich text document with parameter chips,
 * the node the step editor uses for `@parameter` references. A chip finds its
 * parameter by name, so the caller declares a parameter for each returned
 * name. Code is left as written.
 */
export function convertTestRailVariables(doc: JSONContent): {
  doc: JSONContent;
  names: string[];
} {
  const names: string[] = [];

  const convert = (node: JSONContent): JSONContent[] => {
    if (node.type === "codeBlock") return [node];

    if (node.type === "text" && typeof node.text === "string") {
      if (isCode(node)) return [node];
      const parts: JSONContent[] = [];
      let last = 0;
      for (const match of node.text.matchAll(
        new RegExp(VARIABLE_SOURCE, "g")
      )) {
        const name = match[1];
        const start = match.index ?? 0;
        if (start > last) {
          parts.push({ ...node, text: node.text.slice(last, start) });
        }
        parts.push({
          type: "parameterMention",
          attrs: { id: name, label: name, paramType: "STRING" },
        });
        if (!names.includes(name)) names.push(name);
        last = start + match[0].length;
      }
      if (parts.length === 0) return [node];
      if (last < node.text.length) {
        parts.push({ ...node, text: node.text.slice(last) });
      }
      return parts;
    }

    if (!Array.isArray(node.content)) return [node];
    return [{ ...node, content: node.content.flatMap(convert) }];
  };

  return { doc: convert(doc)[0], names };
}
