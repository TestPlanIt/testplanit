import Prism from "prismjs";
import { mapLanguageToPrism } from "~/lib/utils/codeHighlight";

export const PLAIN_TEXT_LANGUAGE = "plain";

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  cs: "csharp",
  php: "php",
  rs: "rust",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  html: "markup",
  htm: "markup",
  vue: "markup",
  svelte: "markup",
  xml: "markup",
  css: "css",
  scss: "scss",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  feature: "gherkin",
  dockerfile: "docker",
};

const UNMAPPED = mapLanguageToPrism("");

function baseName(path: string): string {
  const trimmed = path.trim();
  const separator = Math.max(
    trimmed.lastIndexOf("/"),
    trimmed.lastIndexOf("\\")
  );
  return separator === -1 ? trimmed : trimmed.slice(separator + 1);
}

function loadedOrPlain(id: string): string {
  return Prism.languages[id] ? id : PLAIN_TEXT_LANGUAGE;
}

export function codeLanguageFromPath(path: string): string {
  const name = baseName(path ?? "").toLowerCase();
  if (!name) return PLAIN_TEXT_LANGUAGE;
  if (name === "dockerfile" || name.startsWith("dockerfile.")) {
    return loadedOrPlain("docker");
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return PLAIN_TEXT_LANGUAGE;
  const extension = name.slice(dot + 1);
  const mapped = EXTENSION_LANGUAGES[extension];
  if (mapped) return loadedOrPlain(mapped);
  const fallback = mapLanguageToPrism(extension);
  return fallback === UNMAPPED ? PLAIN_TEXT_LANGUAGE : loadedOrPlain(fallback);
}
