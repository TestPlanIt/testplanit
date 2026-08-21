import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Structural guard: the drag-drop provider must wrap the tree from OUTSIDE.
 *
 * `RequirementsTreeView` calls react-dnd's `useDrop` during its own render.
 * If that same component also renders `<SimpleDndProvider>` in its own
 * returned JSX, the hook runs before the provider exists in the tree and
 * react-dnd throws "Invariant Violation: Expected drag drop context" —
 * a hard 500 on the requirements page.
 *
 * That shipped once. Every component test passed and `tsc` was clean,
 * because `RequirementsTreeView.test.tsx` mocks BOTH `react-dnd` and
 * `SimpleDndProvider` — correctly, since jsdom cannot drive real HTML5 drag
 * choreography — which stubs out the only thing that actually breaks.
 *
 * A render-based guard is not viable here: mounting the real workspace pulls
 * in react-arborist and the resizable panel group unmocked and exhausts the
 * JS heap. So this asserts the invariant on the source text instead, which
 * is what the bug actually was — a nesting mistake, not a behavioural one.
 */
const DIR = path.join(
  process.cwd(),
  "app/[locale]/projects/requirements/[projectId]"
);

/**
 * Comments in both files legitimately *name* these components while
 * explaining the nesting rule — `RequirementsWorkspace.tsx`'s own doc block
 * contains the literal text `<RequirementsTreeView />`. Matching raw source
 * would read those mentions as real JSX and invert the position check, so
 * strip comments first and assert only against code.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const treeSource = codeOnly(
  fs.readFileSync(path.join(DIR, "RequirementsTreeView.tsx"), "utf8")
);
const workspaceSource = codeOnly(
  fs.readFileSync(path.join(DIR, "RequirementsWorkspace.tsx"), "utf8")
);

describe("requirements drag-drop context nesting (structural)", () => {
  it("the tree consumes a drag-drop context it does not provide itself", () => {
    // Precondition: if this component ever stops calling useDrop, this whole
    // guard is moot and should be revisited rather than silently passing.
    expect(treeSource).toContain("useDrop");

    expect(treeSource).not.toMatch(/<SimpleDndProvider[\s>]/);
  });

  it("the workspace provides the drag-drop context around the tree", () => {
    expect(workspaceSource).toMatch(/<SimpleDndProvider[\s>]/);

    // The provider must actually enclose the tree, not merely appear
    // somewhere in the same file.
    const open = workspaceSource.indexOf("<SimpleDndProvider");
    const mount = workspaceSource.indexOf("<RequirementsTreeView");
    const close = workspaceSource.indexOf("</SimpleDndProvider>");

    expect(open).toBeGreaterThanOrEqual(0);
    expect(mount).toBeGreaterThan(open);
    expect(close).toBeGreaterThan(mount);
  });
});
