/**
 * Automation className normalization for Testmo/JUnit ingestion.
 *
 * Testmo identifies an automation case by hash(folder path + name), and CI
 * pipelines encode the run environment (browser/OS/device) into the leading
 * folder segments (`chrome.windows.X`, `ios.ipadpro11(2024).X`). Folding that
 * environment into case identity forks one logical test into one case per
 * browser/OS/device — the root cause of the duplicate-import problem.
 *
 * These helpers derive a stable className that describes WHICH test a case is,
 * independent of WHERE/WHEN it ran, so the same test maps to one case with many
 * results. The module is intentionally dependency-free so it can be reused by
 * the importer, a cleanup migration, and unit tests alike.
 */

const looksLikeGeneratedIdentifier = (segment: string): boolean => {
  const lower = segment.toLowerCase();
  if (/^[0-9a-f-]{8,}$/i.test(segment)) {
    return true;
  }
  if (/^\d{6,}$/.test(segment)) {
    return true;
  }
  if (segment.includes(":")) {
    return true;
  }
  if (segment.startsWith("@")) {
    return true;
  }
  if (
    segment === lower &&
    /[0-9]/.test(segment) &&
    /^[a-z0-9_-]{6,}$/.test(segment)
  ) {
    return true;
  }
  return false;
};

/**
 * Environment tokens (browser / OS / device) that CI encodes into the leading
 * folder segments (e.g. `chrome.windows.X`, `safari.macos.X`). These describe
 * WHERE a test ran, not WHICH test it is, so they must be kept out of the
 * automation-case identity — otherwise the same logical test forks into one
 * case per browser/OS/device.
 */
const ENVIRONMENT_SEGMENTS = new Set<string>([
  // Browsers
  "chrome",
  "chromium",
  "firefox",
  "safari",
  "edge",
  "msedge",
  "microsoftedge",
  "opera",
  "ie",
  "internetexplorer",
  "webkit",
  "brave",
  "samsunginternet",
  // Operating systems
  "windows",
  "win",
  "winxp",
  "windowsxp",
  "macos",
  "mac",
  "osx",
  "linux",
  "ios",
  "ipados",
  "android",
  "chromeos",
  // Form factors
  "desktop",
  "mobile",
  "tablet",
  "phone",
  "headless",
]);

/** Versioned OS tokens: `windows10`, `win11`, `android13`, `macos14.1`, `ios17`. */
const VERSIONED_OS_SEGMENT =
  /^(win(dows)?|macos|osx|android|ios|ipados)\d+([._]\d+)*$/;

/**
 * Bare version-number tokens that CI prepends to the folder — a browser/OS
 * version with its dot rewritten as `_`, e.g. `113_0` (Chrome 113.0),
 * `16_0` (Safari 16.0), `17_3` (macOS 17.3), usually followed by the OS
 * (`113_0.windows.X`, `16_0.macos.X`). Requires a `_`-separated form so a lone
 * class-like number (e.g. `1000`) is not mistaken for a version.
 */
const VERSION_SEGMENT = /^\d+(_\d+)+$/;

/**
 * Device-model tokens, optionally with a parenthesized qualifier that the
 * generated-identifier heuristic misses (its `^[a-z0-9_-]{6,}$` test rejects
 * parentheses): `ipadpro11(2024)`, `iphonese(2020)`, `ipad(9thgeneration)`,
 * `pixel6`, `galaxytab`.
 */
const DEVICE_MODEL_SEGMENT =
  /^(iphone|ipad|ipod|pixel|galaxy|nexus|oneplus|samsung|xperia|moto|redmi|huawei|surface|kindle)[a-z0-9_]*(\([^)]*\))?$/;

export const isEnvironmentSegment = (segment: string): boolean => {
  const lower = segment.toLowerCase();
  return (
    ENVIRONMENT_SEGMENTS.has(lower) ||
    VERSIONED_OS_SEGMENT.test(lower) ||
    VERSION_SEGMENT.test(lower) ||
    DEVICE_MODEL_SEGMENT.test(lower)
  );
};

/**
 * A folder segment that is nothing but one or more issue references
 * (`ADM-18`, `ABT-11634,_ABT-16279`). Testmo appends the linked Jira tickets to
 * the folder path, and CI updates them over time, so the same test drifts
 * between `…Recording.ABT-10329` and `…Recording.ABT-11634,_ABT-16279`. These
 * are unstable and must be kept out of identity. Requires uppercase keys so a
 * real class segment that merely contains a ref (e.g. `*_RMAP-374_Refactored`)
 * is preserved.
 */
export const isIssueReferenceSegment = (segment: string): boolean =>
  /^[A-Z]{2,10}-\d+(?:[,_\s]+[A-Z]{2,10}-\d+)*$/.test(segment.trim());

/**
 * Derive a stable automation className from a Testmo folder path by removing the
 * environment dimension (browser/OS/device) and unstable trailing issue refs,
 * so one logical test maps to one case regardless of where/when it ran.
 *
 * - Strips leading environment segments (`chrome.windows.` / `ios.ipadpro11(2024).`).
 * - Strips trailing issue-reference segments (`.ADM-18` / `.ABT-1,_ABT-2`).
 * - Drops hash-like generated identifiers from the remaining path.
 * - Always keeps at least one segment; genuine class paths with no environment
 *   prefix (e.g. `com.allego.api.internal.AddCommentTest`) pass through intact.
 */
export const normalizeAutomationClassName = (
  folder: string | null
): string | null => {
  if (!folder) {
    return null;
  }

  const segments = folder
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  // Strip leading environment segments — browser/OS/device words plus the
  // device UDIDs and `@`-tags CI interleaves with them (e.g.
  // `ios.00008110-0002….Videos.@realdevice.…`) — but never consume the final
  // segment (a folder made entirely of environment tokens still needs identity).
  let start = 0;
  while (
    start < segments.length - 1 &&
    (isEnvironmentSegment(segments[start]) ||
      looksLikeGeneratedIdentifier(segments[start]))
  ) {
    start += 1;
  }

  // From the remaining path, drop issue-reference segments wherever they occur
  // (CI interleaves them with trailing `@tags`, e.g. `…SSO.ABT-12251.@smoke`, so
  // a trailing-only strip would miss them) and drop hash-like/`@` junk from the
  // tail. The first remaining segment is the class root and is always kept
  // unless it is itself an issue reference.
  const rest = segments.slice(start);
  const kept = rest.filter(
    (segment, index) =>
      !isIssueReferenceSegment(segment) &&
      (index === 0 || !looksLikeGeneratedIdentifier(segment))
  );

  if (kept.length === 0) {
    return segments[segments.length - 1] ?? null;
  }

  return kept.join(".");
};
