import { describe, it, expect } from 'vitest';
import { tipTapDoc } from './tipTapDoc.js';

describe('tipTapDoc', () => {
  it('wraps plain text in a doc > paragraph > text node', () => {
    expect(JSON.parse(tipTapDoc('Click submit'))).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Click submit' }],
        },
      ],
    });
  });

  it('trims leading/trailing whitespace from the text', () => {
    expect(JSON.parse(tipTapDoc('  Click submit  '))).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Click submit' }],
        },
      ],
    });
  });

  it('yields an EMPTY paragraph content array for empty input (never an empty text node)', () => {
    const doc = JSON.parse(tipTapDoc(''));
    expect(doc.content[0]).toEqual({ type: 'paragraph', content: [] });
    // Guard the exact invariant: no `{ type: "text", text: "" }` is ever produced.
    expect(doc.content[0].content).toHaveLength(0);
  });

  it('yields an empty paragraph content array for whitespace-only input', () => {
    const doc = JSON.parse(tipTapDoc('   '));
    expect(doc.content[0]).toEqual({ type: 'paragraph', content: [] });
  });
});
