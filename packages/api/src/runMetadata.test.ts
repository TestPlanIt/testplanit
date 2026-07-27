import { describe, it, expect } from 'vitest';
import {
  mergeRunMetadataIntoDoc,
  parseRunMetadataFromDoc,
} from './runMetadata.js';

const boldKey = (key: string) => ({
  type: 'text',
  marks: [{ type: 'bold' }],
  text: `${key}: `,
});
const plainText = (text: string) => ({ type: 'text', text });
const metaParagraph = (key: string, value: string) => ({
  type: 'paragraph',
  content: value ? [boldKey(key), plainText(value)] : [boldKey(key)],
});

describe('mergeRunMetadataIntoDoc', () => {
  it('renders metadata into an empty doc', () => {
    const doc = mergeRunMetadataIntoDoc(null, { version: '1.2.3', ci: true, build: 42 });
    expect(doc).toEqual({
      type: 'doc',
      content: [
        metaParagraph('version', '1.2.3'),
        metaParagraph('ci', 'true'),
        metaParagraph('build', '42'),
      ],
    });
  });

  it('updates existing keys in place and appends new ones', () => {
    const existing = {
      type: 'doc',
      content: [
        metaParagraph('version', '1.0.0'),
        metaParagraph('branch', 'main'),
      ],
    };
    const doc = mergeRunMetadataIntoDoc(existing, { version: '2.0.0', os: 'linux' });
    expect(doc.content).toEqual([
      metaParagraph('version', '2.0.0'),
      metaParagraph('branch', 'main'),
      metaParagraph('os', 'linux'),
    ]);
  });

  it('preserves non-metadata content untouched', () => {
    const prose = {
      type: 'paragraph',
      content: [plainText('Hand-written notes about this run.')],
    };
    const heading = { type: 'heading', attrs: { level: 2 }, content: [plainText('Notes')] };
    const existing = { type: 'doc', content: [heading, prose, metaParagraph('version', '1.0.0')] };

    const doc = mergeRunMetadataIntoDoc(existing, { version: '1.1.0' });
    expect(doc.content).toEqual([heading, prose, metaParagraph('version', '1.1.0')]);
  });

  it('does not treat a non-bold "key: value" paragraph as metadata', () => {
    const lookalike = {
      type: 'paragraph',
      content: [plainText('version: hand-written')],
    };
    const existing = { type: 'doc', content: [lookalike] };
    const doc = mergeRunMetadataIntoDoc(existing, { version: '9.9.9' });
    expect(doc.content).toEqual([lookalike, metaParagraph('version', '9.9.9')]);
  });

  it('accepts a JSON-string docs value (as stored by the app)', () => {
    const existing = JSON.stringify({
      type: 'doc',
      content: [metaParagraph('version', '1.0.0')],
    });
    const doc = mergeRunMetadataIntoDoc(existing, { version: '1.0.1' });
    expect(doc.content).toEqual([metaParagraph('version', '1.0.1')]);
  });

  it('treats a doc containing only an empty paragraph as empty', () => {
    const existing = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    const doc = mergeRunMetadataIntoDoc(existing, { version: '1.0.0' });
    expect(doc.content).toEqual([metaParagraph('version', '1.0.0')]);
  });

  it('preserves an unparseable string as a plain paragraph', () => {
    const doc = mergeRunMetadataIntoDoc('free-form note', { version: '1.0.0' });
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [plainText('free-form note')] },
      metaParagraph('version', '1.0.0'),
    ]);
  });

  it('skips empty keys and omits the value node for empty values', () => {
    const doc = mergeRunMetadataIntoDoc(null, { '': 'ignored', '  ': 'also', key: '' });
    expect(doc.content).toEqual([metaParagraph('key', '')]);
  });

  it('does not mutate the input doc', () => {
    const existing = { type: 'doc', content: [metaParagraph('version', '1.0.0')] };
    const snapshot = JSON.parse(JSON.stringify(existing));
    mergeRunMetadataIntoDoc(existing, { version: '2.0.0' });
    expect(existing).toEqual(snapshot);
  });
});

describe('parseRunMetadataFromDoc', () => {
  it('round-trips metadata written by mergeRunMetadataIntoDoc', () => {
    const doc = mergeRunMetadataIntoDoc(null, { version: '1.2.3', ci: true, build: 42 });
    expect(parseRunMetadataFromDoc(doc)).toEqual({
      version: '1.2.3',
      ci: 'true',
      build: '42',
    });
  });

  it('ignores non-metadata content', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [plainText('prose')] },
        metaParagraph('key', 'value'),
      ],
    };
    expect(parseRunMetadataFromDoc(doc)).toEqual({ key: 'value' });
  });

  it('returns an empty object for null/empty docs', () => {
    expect(parseRunMetadataFromDoc(null)).toEqual({});
    expect(parseRunMetadataFromDoc(undefined)).toEqual({});
    expect(parseRunMetadataFromDoc('')).toEqual({});
  });

  it('concatenates multi-node values', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [boldKey('url'), plainText('https://ci.example.com/'), plainText('42')],
        },
      ],
    };
    expect(parseRunMetadataFromDoc(doc)).toEqual({ url: 'https://ci.example.com/42' });
  });
});
