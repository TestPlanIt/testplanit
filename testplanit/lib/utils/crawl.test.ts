import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractLinks, normalizeUrl, hashContent, fetchRobots } from './crawl';

// ─── extractLinks ────────────────────────────────────────────────────────────

const MIXED_HTML = `
<html>
  <body>
    <a href="https://example.com/page1">P1</a>
    <a href="https://other.com/page2">P2</a>
    <a href="/relative">Rel</a>
    <a href="mailto:x@y.com">Mail</a>
    <a href="javascript:void(0)">JS</a>
    <a href="ftp://files.example.com/data">FTP</a>
  </body>
</html>
`;

const BASE_URL = 'https://example.com/start';
const ALLOWED_HOSTNAME = 'example.com';

describe('extractLinks', () => {
  it('Test 1: returns only same-hostname links from HTML with mixed-domain hrefs', () => {
    const links = extractLinks(MIXED_HTML, BASE_URL, ALLOWED_HOSTNAME);
    expect(links).toContain('https://example.com/page1');
    expect(links).not.toContain('https://other.com/page2');
  });

  it('Test 2: ignores non-HTTP protocols (mailto:, javascript:, ftp:)', () => {
    const links = extractLinks(MIXED_HTML, BASE_URL, ALLOWED_HOSTNAME);
    expect(links.some(l => l.startsWith('mailto:'))).toBe(false);
    expect(links.some(l => l.startsWith('javascript:'))).toBe(false);
    expect(links.some(l => l.startsWith('ftp:'))).toBe(false);
  });

  it('Test 3: resolves relative URLs against baseUrl', () => {
    const links = extractLinks(MIXED_HTML, BASE_URL, ALLOWED_HOSTNAME);
    expect(links).toContain('https://example.com/relative');
  });
});

// ─── normalizeUrl ─────────────────────────────────────────────────────────────

describe('normalizeUrl', () => {
  it('Test 4: strips fragment (#section) from URLs', () => {
    const result = normalizeUrl('https://example.com/page#section');
    expect(result).toBe('https://example.com/page');
  });

  it('Test 5: returns the URL unchanged when no fragment present', () => {
    const url = 'https://example.com/page?q=1';
    const result = normalizeUrl(url);
    expect(result).toBe(url);
  });
});

// ─── hashContent ─────────────────────────────────────────────────────────────

describe('hashContent', () => {
  it('Test 6: returns a consistent SHA-256 hex string for the same input', () => {
    const h1 = hashContent('hello world');
    const h2 = hashContent('hello world');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Test 7: returns different hashes for different inputs', () => {
    const h1 = hashContent('content A');
    const h2 = hashContent('content B');
    expect(h1).not.toBe(h2);
  });
});

// ─── fetchRobots ─────────────────────────────────────────────────────────────

describe('fetchRobots', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 8: returns null when fetch fails (no robots.txt)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const result = await fetchRobots('https://example.com');
    expect(result).toBeNull();
  });

  it('Test 9: returns a robots parser that can check isAllowed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('User-agent: *\nDisallow: /private/'),
      })
    );
    const robots = await fetchRobots('https://example.com');
    expect(robots).not.toBeNull();
    expect(robots!.isAllowed('https://example.com/public/', 'TestPlanIt')).toBe(true);
    expect(robots!.isAllowed('https://example.com/private/page', 'TestPlanIt')).toBe(false);
  });
});
