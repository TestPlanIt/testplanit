import { describe, it, expect } from "vitest";
import { extractContent } from "./contentExtractor";

// Full article page fixture — has nav, footer, script, style, article body, code block
const FULL_PAGE_HTML = `
<html>
  <head>
    <script>alert('do not include this script content in output')</script>
    <style>.x { color: red; do not include this style content }</style>
  </head>
  <body>
    <nav>Navigation menu should not appear in output</nav>
    <article>
      <h1>How to Write Unit Tests</h1>
      <p>Unit testing is a software testing method by which individual units of source code
      are tested to determine whether they are fit for use. A unit is the smallest testable
      part of any software. It usually has one or a few inputs and usually a single output.
      In procedural programming, a unit may be an individual program, function, procedure, etc.
      In object-oriented programming, the smallest unit is a method. Unit tests are typically
      automated tests written and run by software developers to ensure that a section of an
      application (known as the unit) meets its design and behaves as intended.</p>
      <p>Good unit tests should be fast, isolated, repeatable, self-validating, and timely.
      The FIRST principles guide test design. Tests should run in milliseconds, not minutes.
      Each test should be completely independent from others. Tests should produce the same
      result every time they are run, regardless of environment. Tests should have a boolean
      pass or fail result without human interpretation. Tests should be written before or
      alongside the code they test.</p>
      <pre><code>const x = 1;
const y = 2;
console.log(x + y);</code></pre>
    </article>
    <footer>Footer content should not appear in output</footer>
  </body>
</html>
`;

// Minimal SPA shell — very little text content
const MINIMAL_HTML = `
<html>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

// Rich text page — many characters, clearly not SPA
const RICH_HTML = `
<html>
  <body>
    <article>
      <h1>A Long Article About Testing</h1>
      <p>${"Testing is an important part of software development. ".repeat(20)}</p>
      <p>${"Every developer should write tests to ensure their code works correctly. ".repeat(10)}</p>
    </article>
  </body>
</html>
`;

// Empty body — should trigger Readability null / fallback
const EMPTY_BODY_HTML = `<html><body></body></html>`;

describe("extractContent", () => {
  it("Test 1: returns markdown with ATX headings and no nav/footer/script content", () => {
    const result = extractContent(FULL_PAGE_HTML, "https://example.com/page");
    // Should have ATX heading (# Title)
    expect(result.markdown).toMatch(/^#\s+/m);
    // Nav content should NOT be in output
    expect(result.markdown).not.toContain("Navigation menu should not appear");
    // Footer content should NOT be in output
    expect(result.markdown).not.toContain("Footer content should not appear");
    // Script content should NOT be in output
    expect(result.markdown).not.toContain("do not include this script content");
    // Style content should NOT be in output
    expect(result.markdown).not.toContain("do not include this style content");
    // Main article content SHOULD be in output
    expect(result.markdown).toContain("Unit testing");
  });

  it("Test 2: minimal HTML (< 500 chars text) returns spaWarning = true", () => {
    const result = extractContent(MINIMAL_HTML, "https://example.com/page");
    expect(result.spaWarning).toBe(true);
  });

  it("Test 3: rich HTML (>= 500 chars text) returns spaWarning = false", () => {
    const result = extractContent(RICH_HTML, "https://example.com/page");
    expect(result.spaWarning).toBe(false);
  });

  it("Test 4: Readability returns null for empty body — falls back to cheerio, returns extractionMethod = 'fallback'", () => {
    const result = extractContent(EMPTY_BODY_HTML, "https://example.com/page");
    expect(result.extractionMethod).toBe("fallback");
  });

  it("Test 5: normal article content returns extractionMethod = 'readability'", () => {
    const result = extractContent(FULL_PAGE_HTML, "https://example.com/page");
    expect(result.extractionMethod).toBe("readability");
  });

  it("Test 6: strips script, style, nav, footer elements — their content is NOT in the output markdown", () => {
    const result = extractContent(FULL_PAGE_HTML, "https://example.com/page");
    expect(result.markdown).not.toContain("alert");
    expect(result.markdown).not.toContain("do not include");
    expect(result.markdown).not.toContain("Navigation menu");
    expect(result.markdown).not.toContain("Footer content");
  });

  it("Test 7: converts code blocks with fenced style (triple backticks in output)", () => {
    const result = extractContent(FULL_PAGE_HTML, "https://example.com/page");
    // Fenced code block uses triple backticks
    expect(result.markdown).toContain("```");
  });
});
