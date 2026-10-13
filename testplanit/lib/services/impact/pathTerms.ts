/**
 * Derives weighted search terms from the changed paths and symbols of a
 * DiffSummary for the PATH layer (ES / DB candidate lookup).
 */

import { STOP_WORDS } from "~/lib/llm/services/relevance-terms";
import type { DiffSummary } from "./types";

export const PATH_STOP_SEGMENTS: ReadonlySet<string> = new Set([
  "src",
  "lib",
  "app",
  "index",
  "main",
  "utils",
  "util",
  "helpers",
  "helper",
  "common",
  "core",
  "shared",
  "components",
  "component",
  "pages",
  "page",
  "api",
  "routes",
  "route",
  "service",
  "services",
  "controller",
  "controllers",
  "model",
  "models",
  "types",
  "test",
  "tests",
  "spec",
  "js",
  "ts",
  "tsx",
  "py",
  "go",
  "java",
  "rb",
  "cs",
  "php",
  "json",
  "yaml",
  "yml",
  "md",
  "dist",
  "build",
  "public",
  "assets",
  "styles",
]);

export const MAX_PATH_TERMS = 40;
export const SYMBOL_TERM_WEIGHT = 3;
export const FILENAME_TERM_WEIGHT = 2;
export const DIRECTORY_TERM_WEIGHT = 1;
export const INNER_DIRECTORY_BONUS = 0.5;

export interface PathTerms {
  symbolTerms: string[];
  pathTerms: string[];
  exactSegments: string[];
  weights: Map<string, number>;
}

function isUsableToken(token: string): boolean {
  return (
    token.length > 2 && !PATH_STOP_SEGMENTS.has(token) && !STOP_WORDS.has(token)
  );
}

/** Split a path segment or identifier on separators and camelCase, lowercased. */
export function tokenizeSegment(segment: string): string[] {
  if (typeof segment !== "string" || segment.length === 0) return [];
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(isUsableToken);
}

function fileStem(filename: string): string {
  const base = filename.startsWith(".") ? filename.slice(1) : filename;
  return base.replace(/\.[^.]*$/, "") || base;
}

function exactStem(filename: string): string {
  const base = filename.startsWith(".") ? filename.slice(1) : filename;
  return (base.split(".")[0] || base).toLowerCase();
}

export function derivePathTerms(summary: DiffSummary): PathTerms {
  const weights = new Map<string, number>();
  const fromSymbols = new Set<string>();
  const fromPaths = new Set<string>();
  const exact = new Set<string>();
  const bump = (token: string, weight: number) => {
    weights.set(token, (weights.get(token) ?? 0) + weight);
  };

  const files = Array.isArray(summary?.files) ? summary.files : [];
  for (const file of files) {
    if (!file) continue;
    const paths = [file.path, file.previousPath].filter(
      (p): p is string => typeof p === "string" && p.length > 0
    );
    for (const path of paths) {
      const segments = path.split("/").filter(Boolean);
      const filename = segments.pop() ?? "";
      for (const token of tokenizeSegment(fileStem(filename))) {
        bump(token, FILENAME_TERM_WEIGHT);
        fromPaths.add(token);
      }
      segments.forEach((dir, idx) => {
        const weight =
          DIRECTORY_TERM_WEIGHT +
          (idx === segments.length - 1 ? INNER_DIRECTORY_BONUS : 0);
        for (const token of tokenizeSegment(dir)) {
          bump(token, weight);
          fromPaths.add(token);
        }
        const lowered = dir.toLowerCase();
        if (isUsableToken(lowered)) exact.add(lowered);
      });
      const stem = exactStem(filename);
      if (isUsableToken(stem)) exact.add(stem);
    }

    const symbols = new Set<string>();
    for (const hunk of Array.isArray(file.hunks) ? file.hunks : []) {
      for (const symbol of hunk?.changedSymbols ?? []) symbols.add(symbol);
    }
    for (const symbol of symbols) {
      for (const token of tokenizeSegment(symbol)) {
        bump(token, SYMBOL_TERM_WEIGHT);
        fromSymbols.add(token);
      }
    }
  }

  const kept = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PATH_TERMS);
  const keptWeights = new Map<string, number>(kept);
  const keptTerms = kept.map(([term]) => term);

  return {
    symbolTerms: keptTerms.filter((t) => fromSymbols.has(t)),
    pathTerms: keptTerms.filter((t) => fromPaths.has(t)),
    exactSegments: [...exact],
    weights: keptWeights,
  };
}
