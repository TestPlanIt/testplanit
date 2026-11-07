import { type ReactNode, useEffect, useMemo, useState } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { useLocation } from '@docusaurus/router';
import DropdownNavbarItem from '@theme/NavbarItem/DropdownNavbarItem';
import type { Props as DropdownNavbarItemProps } from '@theme/NavbarItem/DropdownNavbarItem';
import type { LinkLikeNavbarItemProps } from '@theme/NavbarItem';

type DocsVersionStatus = 'stable' | 'beta' | 'previous';

interface DocsVersionEntry {
  line: string;
  url: string;
  status: DocsVersionStatus;
}

interface DocsVersionCustomFields {
  docsVersion: {
    version: string;
    line: string;
    prerelease: boolean;
    url: string;
  };
  docsVersions: DocsVersionEntry[];
  docsVersionsManifestUrl: string;
}

export type Props = Pick<
  DropdownNavbarItemProps,
  'mobile' | 'position' | 'className'
>;

const STATUS_TEXT: Record<DocsVersionStatus, string> = {
  stable: 'stable',
  beta: 'beta',
  previous: 'previous release',
};

const LINE_PATTERN = /^\d+\.\d+$/;

function isVersionEntry(value: unknown): value is DocsVersionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.line === 'string' &&
    LINE_PATTERN.test(entry.line) &&
    typeof entry.url === 'string' &&
    /^https?:\/\//.test(entry.url) &&
    typeof entry.status === 'string' &&
    entry.status in STATUS_TEXT
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseManifest(value: unknown): DocsVersionEntry[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const versions = (value as { versions?: unknown }).versions;
  if (!Array.isArray(versions) || !versions.every(isVersionEntry)) return null;
  return versions.map((entry) => ({
    ...entry,
    url: entry.url.replace(/\/+$/, ''),
  }));
}

function compareLinesDescending(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split('.').map(Number);
  const [bMajor = 0, bMinor = 0] = b.split('.').map(Number);
  return bMajor - aMajor || bMinor - aMinor;
}

function itemLabel(entry: DocsVersionEntry): string {
  return `v${entry.line} (${STATUS_TEXT[entry.status]})`;
}

function navbarLabel(entry: DocsVersionEntry): string {
  return entry.status === 'beta' ? `v${entry.line} beta` : `v${entry.line}`;
}

/**
 * Navbar dropdown listing every hosted documentation site. The list is baked
 * in at build time and refreshed from the stable site's manifest on load, so
 * a site built from an old tag still shows the lines that came after it.
 */
export default function DocsVersionPickerNavbarItem({
  mobile,
  position,
  className,
}: Props): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const { docsVersion, docsVersions, docsVersionsManifestUrl } =
    siteConfig.customFields as unknown as DocsVersionCustomFields;
  const { pathname, search, hash } = useLocation();
  const [versions, setVersions] = useState<DocsVersionEntry[]>(docsVersions);

  useEffect(() => {
    let cancelled = false;
    // Revalidate every load so a manifest update shows up on the next visit
    // instead of after the cached copy expires; nginx answers 304 when unchanged.
    fetch(docsVersionsManifestUrl, {
      cache: 'no-cache',
      headers: { Accept: 'application/json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        const fetched = parseManifest(body);
        if (fetched && !cancelled) setVersions(fetched);
      })
      .catch(() => {
        // Keep the baked-in list.
      });
    return () => {
      cancelled = true;
    };
  }, [docsVersionsManifestUrl]);

  const entries = useMemo(() => {
    const listed = versions.some((entry) => entry.line === docsVersion.line);
    const all = listed
      ? versions
      : [
          {
            line: docsVersion.line,
            url: docsVersion.url,
            status: docsVersion.prerelease ? 'beta' : 'stable',
          } satisfies DocsVersionEntry,
          ...versions,
        ];
    return [...all].sort((a, b) => compareLinesDescending(a.line, b.line));
  }, [versions, docsVersion]);

  const current = entries.find((entry) => entry.line === docsVersion.line)!;
  const page = `${pathname}${search}${hash}`;

  // Other lines are other hosts. Passing `html` instead of `label` keeps the
  // theme from adding its "opens in new tab" icon, since these open in place.
  const items: LinkLikeNavbarItemProps[] = entries.map((entry) =>
    entry.line === current.line
      ? {
          label: itemLabel(entry),
          to: page,
          className: 'dropdown__link--active',
        }
      : {
          html: escapeHtml(itemLabel(entry)),
          href: `${entry.url}${page}`,
          target: '_self',
        }
  );

  return (
    <DropdownNavbarItem
      mobile={mobile}
      position={position}
      className={className}
      label={navbarLabel(current)}
      items={items}
    />
  );
}
