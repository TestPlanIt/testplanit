import { readFileSync } from 'fs';
import { join } from 'path';

// This runs in Node.js at build time - Don't use client-side code here.

export type DocsVersionStatus = 'stable' | 'beta' | 'previous';

/** One hosted documentation site, as listed in static/versions.json. */
export interface DocsVersionEntry {
  /** Release line, e.g. "1.2". */
  line: string;
  /** Site origin without a trailing slash, e.g. "https://docs.testplanit.com". */
  url: string;
  status: DocsVersionStatus;
}

export interface DocsVersionManifest {
  versions: DocsVersionEntry[];
}

/** The release line this build documents. */
export interface CurrentDocsVersion {
  /** Full app version, e.g. "1.2.0-beta.34". */
  version: string;
  /** Release line, e.g. "1.2". */
  line: string;
  prerelease: boolean;
  /** Site origin this build is served from, without a trailing slash. */
  url: string;
}

export const DEFAULT_DOCS_URL = 'https://docs.testplanit.com';
export const VERSION_MANIFEST_PATH = '/versions.json';

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function readAppVersion(): string {
  const fromEnv = process.env.DOCS_APP_VERSION?.trim();
  if (fromEnv) return fromEnv;

  const pkgPath = join(__dirname, '..', 'testplanit', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      version?: string;
    };
    if (pkg.version) return pkg.version;
  } catch {
    // fall through to the error below
  }
  throw new Error(
    `Cannot determine the app version: set DOCS_APP_VERSION or make ${pkgPath} readable.`
  );
}

export function parseVersion(version: string): {
  line: string;
  prerelease: boolean;
} {
  const match = /^(\d+)\.(\d+)\.\d+(?:-([0-9A-Za-z.-]+))?/.exec(version);
  if (!match) {
    throw new Error(`Unrecognised app version "${version}"`);
  }
  return {
    line: `${match[1]}.${match[2]}`,
    prerelease: match[3] !== undefined,
  };
}

export function loadCurrentDocsVersion(): CurrentDocsVersion {
  const version = readAppVersion();
  const { line, prerelease } = parseVersion(version);
  const url = stripTrailingSlash(
    process.env.DOCS_URL?.trim() || DEFAULT_DOCS_URL
  );
  return { version, line, prerelease, url };
}

/**
 * The baked-in copy of the manifest; the picker refreshes it at runtime.
 * DOCS_VERSIONS_JSON (inline JSON) overrides the file for local previews.
 */
export function loadVersionManifest(): DocsVersionManifest {
  const manifestPath = join(__dirname, 'static', 'versions.json');
  const raw =
    process.env.DOCS_VERSIONS_JSON?.trim() ||
    readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw) as DocsVersionManifest;
  if (!Array.isArray(manifest.versions)) {
    throw new Error(`${manifestPath} must contain a "versions" array`);
  }
  for (const entry of manifest.versions) {
    entry.url = stripTrailingSlash(entry.url);
  }
  return manifest;
}

export function navbarLabel(entry: {
  line: string;
  status: DocsVersionStatus;
}): string {
  return entry.status === 'beta' ? `v${entry.line} beta` : `v${entry.line}`;
}
