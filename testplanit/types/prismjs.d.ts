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

declare module "prismjs/components/prism-typescript" {}
declare module "prismjs/components/prism-javascript" {}
declare module "prismjs/components/prism-python" {}
declare module "prismjs/components/prism-java" {}
declare module "prismjs/components/prism-csharp" {}
declare module "prismjs/components/prism-ruby" {}
declare module "prismjs/components/prism-go" {}
declare module "prismjs/themes/prism-tomorrow.css" {}
