import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * A `useState` lazy initializer that reads `localStorage` or `sessionStorage`
 * runs on BOTH sides of hydration: the server has no `window` and takes the
 * fallback branch, the client reads the stored value. The two renders then
 * disagree.
 *
 * When the stored value only affects styles, React records the difference and
 * keeps the SERVER markup — the component mounts looking healthy but stays
 * pinned to server state. When it affects structure (which children render, an
 * Accordion's open items), React throws the server tree away and re-renders
 * from the nearest boundary.
 *
 * Either way it is deterministic rather than intermittent, which is what makes
 * it so easy to ship: with nothing in storage both sides agree, so it works in
 * development and in a fresh browser. The first write to storage is what breaks
 * every load after it.
 *
 * The fix is always the same shape — initialize with the value the server
 * renders, then adopt the stored one in a mount effect. This gate exists
 * because six of these shipped before anyone noticed the pattern.
 */

const ROOT = path.join(__dirname, "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  ".git",
  "test-results",
  "playwright-report",
  "e2e",
]);

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sourceFiles(full, acc);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(test|spec)\.tsx?$/.test(entry.name)
    ) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Returns the source of every `useState(...)` call's argument list, so the scan
 * looks only at initializers and never at the effect bodies that legitimately
 * read storage. Brace/paren counting rather than a regex: an initializer body
 * contains its own parens and quotes, and a naive quote-delimited match
 * silently truncates on them.
 */
function useStateInitializers(source: string): string[] {
  const out: string[] = [];
  const marker = /\buseState\s*(?:<[^(]*>)?\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    out.push(source.slice(start, i - 1));
  }
  return out;
}

const STORAGE_READ = /\b(?:local|session)Storage\s*(?:\.getItem|\[)/;

describe("hydration safety: storage reads in useState initializers", () => {
  it("no useState initializer reads localStorage or sessionStorage", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(ROOT)) {
      const source = fs.readFileSync(file, "utf8");
      if (!STORAGE_READ.test(source)) continue;
      for (const initializer of useStateInitializers(source)) {
        if (STORAGE_READ.test(initializer)) {
          offenders.push(path.relative(ROOT, file));
          break;
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("detects the pattern it is meant to catch", () => {
    // Proving the scanner on a known-bad input: a gate that has never been
    // observed failing is not a gate. The three shapes below are the ones that
    // actually shipped — a `typeof window` guard, a bare read, and a generic
    // type argument between `useState` and its parenthesis.
    const bad = `
      const [a, setA] = useState<string[]>(() => {
        if (typeof window !== "undefined") {
          const stored = localStorage.getItem("k");
          return stored ? JSON.parse(stored) : [];
        }
        return [];
      });
      const [b, setB] = useState(() => sessionStorage.getItem("k"));
      const [c, setC] = useState<Record<string, number>>(() => {
        return JSON.parse(window.localStorage.getItem("k") ?? "{}");
      });
    `;
    const flagged = useStateInitializers(bad).filter((i) =>
      STORAGE_READ.test(i)
    );
    expect(flagged).toHaveLength(3);

    // ...and that it does not flag the correct shape, where the read has moved
    // into a mount effect.
    const good = `
      const [a, setA] = useState<string[]>(() => []);
      useEffect(() => {
        const stored = localStorage.getItem("k");
        if (stored) setA(JSON.parse(stored));
      }, []);
    `;
    expect(
      useStateInitializers(good).filter((i) => STORAGE_READ.test(i))
    ).toHaveLength(0);
  });
});
