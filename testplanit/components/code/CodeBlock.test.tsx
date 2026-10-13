import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("prismjs/themes/prism-tomorrow.css", () => ({}));

import { CodeBlock } from "./CodeBlock";

describe("CodeBlock", () => {
  it("renders a Prism-highlighted code element tagged with the language", () => {
    const { container } = render(
      <CodeBlock code="const a: number = 1;" language="typescript" />
    );
    const code = container.querySelector("code");
    expect(code).toHaveClass("language-typescript");
    expect(code?.querySelector(".token")).not.toBeNull();
    expect(code?.textContent).toBe("const a: number = 1;");
  });

  it("escapes HTML instead of injecting it", () => {
    const { container } = render(
      <CodeBlock code="<script>alert(1)</script>" language="markup" />
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe(
      "<script>alert(1)</script>"
    );
  });

  it("keeps the dark pre styling and merges className", () => {
    const { container } = render(
      <CodeBlock code="x" language="plain" className="mt-2" />
    );
    expect(container.querySelector("pre")).toHaveClass("bg-stone-800", "mt-2");
  });
});
