/**
 * True when several browsers are selected and this is not the first of
 * them. A test that changes state every browser's run shares (an
 * install-wide setting, the seeded admin user) would undo itself when its
 * copies run side by side, so it runs in the first browser only.
 */
export function coveredByAnotherBrowser(browserName: string): boolean {
  const selected = (process.env.E2E_BROWSERS || "chromium")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return selected.length > 1 && browserName !== selected[0];
}

export const SHARED_STATE_SKIP_REASON =
  "Changes state shared by every browser's run; runs in the first browser only";
