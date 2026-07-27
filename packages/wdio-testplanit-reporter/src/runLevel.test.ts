import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('./shared.js', () => ({
  readSharedState: vi.fn().mockReturnValue(null),
}));

import { applyEnvTemplate, guessMimeType, createRuntimeApi } from './runLevel.js';
import { readSharedState } from './shared.js';
import type { TestPlanItClient } from '@testplanit/api';

const mockedReadSharedState = vi.mocked(readSharedState);

describe('applyEnvTemplate', () => {
  const ENV_KEYS = ['TPI_TEST_BUILD_URL', 'TPI_TEST_JOB', 'TPI_TEST_NUM'];

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('resolves {env:VAR} placeholders from process.env', () => {
    process.env.TPI_TEST_JOB = 'nightly';
    process.env.TPI_TEST_NUM = '42';
    const result = applyEnvTemplate('{env:TPI_TEST_JOB} #{env:TPI_TEST_NUM}');
    expect(result).toEqual({ value: 'nightly #42', missing: [] });
  });

  it('reports unset variables and substitutes empty strings', () => {
    const result = applyEnvTemplate('{env:TPI_TEST_BUILD_URL}/artifact');
    expect(result).toEqual({ value: '/artifact', missing: ['TPI_TEST_BUILD_URL'] });
  });

  it('treats empty-string variables as missing', () => {
    process.env.TPI_TEST_JOB = '';
    expect(applyEnvTemplate('{env:TPI_TEST_JOB}').missing).toEqual(['TPI_TEST_JOB']);
  });

  it('leaves strings without placeholders untouched', () => {
    expect(applyEnvTemplate('plain text')).toEqual({ value: 'plain text', missing: [] });
  });
});

describe('guessMimeType', () => {
  it('maps common artifact extensions', () => {
    expect(guessMimeType('report.html')).toBe('text/html');
    expect(guessMimeType('video.MP4')).toBe('video/mp4');
    expect(guessMimeType('wdio.log')).toBe('text/plain');
    expect(guessMimeType('shot.png')).toBe('image/png');
  });

  it('falls back to application/octet-stream', () => {
    expect(guessMimeType('archive.tar.xz')).toBe('application/octet-stream');
    expect(guessMimeType('noextension')).toBe('application/octet-stream');
  });
});

describe('createRuntimeApi', () => {
  const mockClient = {
    addTestRunLink: vi.fn(),
    uploadTestRunAttachment: vi.fn(),
    setTestRunMetadata: vi.fn(),
  };
  const log = vi.fn();
  const logError = vi.fn();

  const api = () =>
    createRuntimeApi({
      client: mockClient as unknown as TestPlanItClient,
      projectId: 1,
      log,
      logError,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadSharedState.mockReturnValue({
      testRunId: 100,
      createdAt: new Date().toISOString(),
      activeWorkers: 0,
      managedByService: true,
    });
    mockClient.addTestRunLink.mockResolvedValue({ id: 1, name: 'link' });
    mockClient.uploadTestRunAttachment.mockResolvedValue({ id: 2, name: 'file' });
    mockClient.setTestRunMetadata.mockResolvedValue({ id: 100 });
  });

  it('getRunId resolves the run from shared state on every call', () => {
    expect(api().getRunId()).toBe(100);
    mockedReadSharedState.mockReturnValue(null);
    expect(api().getRunId()).toBeUndefined();
  });

  it('attachToRun with a url creates a run link', async () => {
    const result = await api().attachToRun({ url: 'https://ci.example.com/42', name: 'CI' });
    expect(result).toEqual({ id: 1, name: 'link' });
    expect(mockClient.addTestRunLink).toHaveBeenCalledWith(
      100,
      'https://ci.example.com/42',
      'CI',
      undefined
    );
  });

  it('attachToRun with a buffer uploads a run attachment', async () => {
    const buffer = Buffer.from('content');
    const result = await api().attachToRun({ buffer, name: 'notes.txt' });
    expect(result).toEqual({ id: 2, name: 'file' });
    expect(mockClient.uploadTestRunAttachment).toHaveBeenCalledWith(
      100,
      buffer,
      'notes.txt',
      'text/plain'
    );
  });

  it('attachToRun with a path reads the file and derives name/mime', async () => {
    const filePath = path.join(os.tmpdir(), `tpi-runlevel-${process.pid}.html`);
    fs.writeFileSync(filePath, '<html></html>');
    try {
      await api().attachToRun({ path: filePath });
      expect(mockClient.uploadTestRunAttachment).toHaveBeenCalledWith(
        100,
        Buffer.from('<html></html>'),
        path.basename(filePath),
        'text/html'
      );
    } finally {
      fs.unlinkSync(filePath);
    }
  });

  it('attachToRun with a buffer but no name logs and returns null', async () => {
    const result = await api().attachToRun({ buffer: Buffer.from('x') });
    expect(result).toBeNull();
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('"name" is required')
    );
    expect(mockClient.uploadTestRunAttachment).not.toHaveBeenCalled();
  });

  it('returns null and logs when no run is active', async () => {
    mockedReadSharedState.mockReturnValue(null);
    const result = await api().attachToRun({ url: 'https://example.com' });
    expect(result).toBeNull();
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('no active TestPlanIt run')
    );
  });

  it('swallows client failures and returns null', async () => {
    mockClient.addTestRunLink.mockRejectedValueOnce(new Error('boom'));
    const result = await api().attachToRun({ url: 'https://example.com' });
    expect(result).toBeNull();
    expect(logError).toHaveBeenCalledWith('attachToRun failed:', expect.any(Error));
  });

  it('setRunMetadata merges metadata onto the shared run', async () => {
    const result = await api().setRunMetadata({ version: '1.2.3' });
    expect(result).toBe(true);
    expect(mockClient.setTestRunMetadata).toHaveBeenCalledWith(100, { version: '1.2.3' });
  });

  it('setRunMetadata returns false and logs on failure', async () => {
    mockClient.setTestRunMetadata.mockRejectedValueOnce(new Error('boom'));
    const result = await api().setRunMetadata({ version: '1.2.3' });
    expect(result).toBe(false);
    expect(logError).toHaveBeenCalledWith('setRunMetadata failed:', expect.any(Error));
  });

  it('setRunMetadata returns false when no run is active', async () => {
    mockedReadSharedState.mockReturnValue(null);
    const result = await api().setRunMetadata({ version: '1.2.3' });
    expect(result).toBe(false);
    expect(mockClient.setTestRunMetadata).not.toHaveBeenCalled();
  });
});
