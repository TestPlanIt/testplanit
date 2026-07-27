import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  applyEnvTemplate,
  guessMimeType,
  attachToRun,
  setRunMetadata,
  isRunLevelAttachment,
  parseRunLevelAttachment,
  runLevelOpKey,
  RUN_LINK_ATTACHMENT,
  RUN_METADATA_ATTACHMENT,
  RUN_FILE_ATTACHMENT_PREFIX,
} from './runLevel.js';

describe('applyEnvTemplate', () => {
  afterEach(() => {
    delete process.env.TPI_PW_JOB;
    delete process.env.TPI_PW_NUM;
  });

  it('resolves {env:VAR} placeholders from process.env', () => {
    process.env.TPI_PW_JOB = 'nightly';
    process.env.TPI_PW_NUM = '42';
    expect(applyEnvTemplate('{env:TPI_PW_JOB} #{env:TPI_PW_NUM}')).toEqual({
      value: 'nightly #42',
      missing: [],
    });
  });

  it('reports unset variables and substitutes empty strings', () => {
    expect(applyEnvTemplate('{env:TPI_PW_JOB}/x')).toEqual({
      value: '/x',
      missing: ['TPI_PW_JOB'],
    });
  });
});

describe('guessMimeType', () => {
  it('maps common artifact extensions and falls back to octet-stream', () => {
    expect(guessMimeType('report.html')).toBe('text/html');
    expect(guessMimeType('trace.zip')).toBe('application/zip');
    expect(guessMimeType('unknown.bin')).toBe('application/octet-stream');
  });
});

describe('attachToRun / setRunMetadata helpers', () => {
  const attach = vi.fn().mockResolvedValue(undefined);
  const testInfo = { attach };

  beforeEach(() => {
    attach.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ships a link as a reserved JSON attachment', async () => {
    await attachToRun(testInfo, { url: 'https://ci.example.com/42', name: 'CI' });
    expect(attach).toHaveBeenCalledWith(RUN_LINK_ATTACHMENT, {
      body: JSON.stringify({ url: 'https://ci.example.com/42', name: 'CI', note: undefined }),
      contentType: 'application/json',
    });
  });

  it('ships a path file under the reserved prefix with a derived name and mime', async () => {
    await attachToRun(testInfo, { path: '/tmp/output/report.html' });
    expect(attach).toHaveBeenCalledWith(`${RUN_FILE_ATTACHMENT_PREFIX}report.html`, {
      path: '/tmp/output/report.html',
      contentType: 'text/html',
    });
  });

  it('ships a buffer file with its explicit name', async () => {
    const buffer = Buffer.from('pdf');
    await attachToRun(testInfo, { buffer, name: 'summary.pdf' });
    expect(attach).toHaveBeenCalledWith(`${RUN_FILE_ATTACHMENT_PREFIX}summary.pdf`, {
      body: buffer,
      contentType: 'application/pdf',
    });
  });

  it('logs and no-ops for a buffer without a name', async () => {
    await attachToRun(testInfo, { buffer: Buffer.from('x') });
    expect(attach).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"name" is required'),
    );
  });

  it('logs and no-ops for empty input', async () => {
    await attachToRun(testInfo, {});
    expect(attach).not.toHaveBeenCalled();
  });

  it('ships metadata as a reserved JSON attachment', async () => {
    await setRunMetadata(testInfo, { version: '1.2.3', ci: true });
    expect(attach).toHaveBeenCalledWith(RUN_METADATA_ATTACHMENT, {
      body: JSON.stringify({ version: '1.2.3', ci: true }),
      contentType: 'application/json',
    });
  });
});

describe('parseRunLevelAttachment', () => {
  it('round-trips a link', () => {
    expect(
      parseRunLevelAttachment({
        name: RUN_LINK_ATTACHMENT,
        body: Buffer.from(JSON.stringify({ url: 'https://x', name: 'X' })),
      }),
    ).toEqual({ kind: 'link', url: 'https://x', name: 'X', note: undefined });
  });

  it('round-trips metadata', () => {
    expect(
      parseRunLevelAttachment({
        name: RUN_METADATA_ATTACHMENT,
        body: Buffer.from(JSON.stringify({ version: '1.0' })),
      }),
    ).toEqual({ kind: 'metadata', metadata: { version: '1.0' } });
  });

  it('round-trips a file with the display name from the attachment name', () => {
    const body = Buffer.from('data');
    expect(
      parseRunLevelAttachment({
        name: `${RUN_FILE_ATTACHMENT_PREFIX}report.html`,
        contentType: 'text/html',
        body,
      }),
    ).toEqual({ kind: 'file', name: 'report.html', contentType: 'text/html', path: undefined, body });
  });

  it('returns null for malformed payloads', () => {
    expect(parseRunLevelAttachment({ name: RUN_LINK_ATTACHMENT, body: Buffer.from('not json') })).toBeNull();
    expect(parseRunLevelAttachment({ name: RUN_LINK_ATTACHMENT, body: Buffer.from('{}') })).toBeNull();
    expect(parseRunLevelAttachment({ name: RUN_METADATA_ATTACHMENT, body: Buffer.from('[1]') })).toBeNull();
    expect(parseRunLevelAttachment({ name: `${RUN_FILE_ATTACHMENT_PREFIX}x` })).toBeNull();
    expect(parseRunLevelAttachment({ name: 'screenshot' })).toBeNull();
  });

  it('isRunLevelAttachment matches only the reserved prefix', () => {
    expect(isRunLevelAttachment(RUN_LINK_ATTACHMENT)).toBe(true);
    expect(isRunLevelAttachment(`${RUN_FILE_ATTACHMENT_PREFIX}a.txt`)).toBe(true);
    expect(isRunLevelAttachment('screenshot')).toBe(false);
    expect(isRunLevelAttachment('testplanit')).toBe(false);
  });
});

describe('runLevelOpKey', () => {
  it('dedupes links by url+name, files by display name, metadata by content', () => {
    expect(runLevelOpKey({ kind: 'link', url: 'https://x', name: 'A' })).toBe('link|https://x|A');
    expect(runLevelOpKey({ kind: 'file', name: 'report.html', path: '/a' })).toBe(
      runLevelOpKey({ kind: 'file', name: 'report.html', path: '/retry-1/b' }),
    );
    expect(runLevelOpKey({ kind: 'metadata', metadata: { a: 1 } })).not.toBe(
      runLevelOpKey({ kind: 'metadata', metadata: { a: 2 } }),
    );
  });
});
