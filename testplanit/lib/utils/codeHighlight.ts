import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-dart";
import "prismjs/components/prism-gherkin";
import "prismjs/components/prism-go";
import "prismjs/components/prism-groovy";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-lua";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-objectivec";
import "prismjs/components/prism-perl";
import "prismjs/components/prism-php";
import "prismjs/components/prism-python";
import "prismjs/components/prism-r";
import "prismjs/components/prism-robotframework";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-scala";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

/**
 * Maps template language names to PrismJS grammar identifiers.
 */
export function mapLanguageToPrism(language: string): string {
  const normalized = language.toLowerCase().trim();
  const mapping: Record<string, string> = {
    typescript: "typescript",
    ts: "typescript",
    javascript: "javascript",
    js: "javascript",
    python: "python",
    py: "python",
    java: "java",
    "c#": "csharp",
    csharp: "csharp",
    cs: "csharp",
    ruby: "ruby",
    rb: "ruby",
    go: "go",
    swift: "swift",
    gherkin: "gherkin",
    feature: "gherkin",
    markdown: "markdown",
    md: "markdown",
    robotframework: "robotframework",
    robot: "robotframework",
    kotlin: "kotlin",
    kt: "kotlin",
    rust: "rust",
    rs: "rust",
    bash: "bash",
    sh: "bash",
    shell: "bash",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    sql: "sql",
    php: "php",
    dart: "dart",
    scala: "scala",
    groovy: "groovy",
    perl: "perl",
    pl: "perl",
    lua: "lua",
    r: "r",
    objectivec: "objectivec",
    objc: "objectivec",
    "objective-c": "objectivec",
  };
  return mapping[normalized] || "javascript";
}

/**
 * Highlights code using PrismJS and returns an HTML string.
 * Falls back to JavaScript if the grammar is not loaded.
 */
export function highlightCode(code: string, prismLanguage: string): string {
  const grammar =
    Prism.languages[prismLanguage] || Prism.languages.javascript;
  const effectiveLang = Prism.languages[prismLanguage]
    ? prismLanguage
    : "javascript";
  return Prism.highlight(code, grammar, effectiveLang);
}
