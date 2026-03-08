// Type declarations for PrismJS and side-effect imports for language components.

declare module "prismjs" {
  interface Grammar {
    [key: string]: unknown;
  }

  const Prism: {
    languages: Record<string, Grammar>;
    highlight(text: string, grammar: Grammar, language: string): string;
    highlightElement(element: Element): void;
    highlightAll(): void;
  };

  export default Prism;
}

declare module "prismjs/components/prism-markup" {}
declare module "prismjs/components/prism-markup-templating" {}
declare module "prismjs/components/prism-c" {}
declare module "prismjs/components/prism-typescript" {}
declare module "prismjs/components/prism-javascript" {}
declare module "prismjs/components/prism-python" {}
declare module "prismjs/components/prism-java" {}
declare module "prismjs/components/prism-csharp" {}
declare module "prismjs/components/prism-ruby" {}
declare module "prismjs/components/prism-go" {}
declare module "prismjs/components/prism-swift" {}
declare module "prismjs/components/prism-gherkin" {}
declare module "prismjs/components/prism-markdown" {}
declare module "prismjs/components/prism-robotframework" {}
declare module "prismjs/components/prism-kotlin" {}
declare module "prismjs/components/prism-rust" {}
declare module "prismjs/components/prism-bash" {}
declare module "prismjs/components/prism-yaml" {}
declare module "prismjs/components/prism-json" {}
declare module "prismjs/components/prism-sql" {}
declare module "prismjs/components/prism-php" {}
declare module "prismjs/components/prism-dart" {}
declare module "prismjs/components/prism-scala" {}
declare module "prismjs/components/prism-groovy" {}
declare module "prismjs/components/prism-perl" {}
declare module "prismjs/components/prism-lua" {}
declare module "prismjs/components/prism-r" {}
declare module "prismjs/components/prism-objectivec" {}
declare module "prismjs/themes/prism-tomorrow.css" {}
