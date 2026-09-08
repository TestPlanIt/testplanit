import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "fs";
import path from "path";
import { stubBellSSE } from "../fixtures";
import {
  routes,
  SMOKE_ROUTES,
  type A11yRoute,
  type A11yFixtures,
  type InteractiveState,
} from "./routes";
import { primaryCriterion, isWcagViolation } from "./wcag";

/**
 * Parameterized accessibility scan. One test per route in routes.ts. Each test
 * navigates, waits for the page to settle, runs axe-core against WCAG 2.0/2.1/
 * 2.2 A+AA (plus best-practice, reported separately), optionally re-scans a
 * couple of cheap interactive states (open dialog / open menu), and writes a
 * raw per-route JSON result to results/. aggregate.ts turns those into the
 * WCAG-grouped Markdown report.
 *
 * Pass/fail: report-only by default (never fails on violations). Set
 * A11Y_STRICT=on (or CI=strict) to fail a route on any serious/critical WCAG
 * violation.
 */

const RESULTS_DIR = path.join(__dirname, "results");
const FIXTURES_FILE = path.join(__dirname, ".a11y-fixtures.json");
const LOCALE = "en-US";

// The full WCAG 2.0/2.1/2.2 A + AA stack, plus best-practice (split out below).
const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

const STRICT = process.env.A11Y_STRICT === "on" || process.env.CI === "strict";
// Smoke mode (A11Y_SMOKE=on): scan only the curated SMOKE_ROUTES subset. Used by
// the CI smoke gate so it stays fast while covering every major UI pattern.
const SMOKE = process.env.A11Y_SMOKE === "on";
// Optionally force a theme class before axe runs (e.g. A11Y_THEME=accessible),
// so the scan measures a specific theme regardless of the seeded user preference.
const FORCE_THEME = process.env.A11Y_THEME;

const fixtures: A11yFixtures | null = fs.existsSync(FIXTURES_FILE)
  ? JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8"))
  : null;

interface ViolationNode {
  target: string[];
  html: string;
  failureSummary: string;
}
interface Violation {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  criterion: string; // "1.4.3 Contrast (Minimum)"
  criterionKey: string;
  nodeCount: number;
  nodes: ViolationNode[];
}
interface StateResult {
  state: string; // "initial" | "dialog" | "menu"
  reached: boolean;
  url: string;
  wcagViolations: Violation[];
  bestPracticeViolations: Violation[];
}
interface RouteResult {
  name: string;
  group: string;
  requestedPath: string;
  finalUrl: string;
  authRequired: boolean;
  scannedAt: string;
  status: "scanned" | "skipped" | "error";
  note?: string;
  states: StateResult[];
}

fs.mkdirSync(RESULTS_DIR, { recursive: true });

function serialize(violations: AxeViolation[]): Violation[] {
  return violations.map((v) => {
    const sc = primaryCriterion(v.tags);
    return {
      id: v.id,
      impact: v.impact ?? null,
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      tags: v.tags,
      criterion: sc.num === "—" ? sc.name : `${sc.num} ${sc.name}`,
      criterionKey: sc.key,
      nodeCount: v.nodes.length,
      nodes: v.nodes.slice(0, 5).map((n) => ({
        target: (n.target as string[]).map(String),
        html: (n.html || "").slice(0, 400),
        failureSummary: n.failureSummary || "",
      })),
    };
  });
}

// Minimal structural types so we don't depend on axe's exported types.
type AxeNode = { target: unknown[]; html: string; failureSummary?: string };
type AxeViolation = {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNode[];
};

// Selectors excluded from every scan. Avatar initials render on a per-name
// generated background color (not a theme token) and identically in all themes;
// their full name is always available via the tooltip / img alt, so the initials
// are supplementary. Excluding them keeps the strict color-contrast gate honest
// about real (theme-driven) failures rather than data-color noise.
const AXE_EXCLUDE_SELECTORS = ["[data-avatar-initials]"];

async function runAxe(
  page: Page
): Promise<{ wcag: Violation[]; best: Violation[] }> {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  for (const sel of AXE_EXCLUDE_SELECTORS) builder = builder.exclude(sel);
  const results = await builder.analyze();
  const all = results.violations as unknown as AxeViolation[];
  return {
    wcag: serialize(all.filter((v) => isWcagViolation(v.tags))),
    best: serialize(all.filter((v) => !isWcagViolation(v.tags))),
  };
}

async function settle(page: Page, route: A11yRoute): Promise<void> {
  // Bounded networkidle (SSE is stubbed, so this resolves) + a sanity selector
  // that proves the shell rendered. Neither is allowed to hang the scan.
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  if (route.sanity) {
    await page
      .waitForSelector(route.sanity, { state: "attached", timeout: 12000 })
      .catch(() => {});
  }
  await dismissOnboardingOverlay(page);
  if (FORCE_THEME) await applyTheme(page, FORCE_THEME);
  if (route.settleMs) await page.waitForTimeout(route.settleMs);
}

async function applyTheme(page: Page, theme: string): Promise<void> {
  await page
    .evaluate((t) => {
      const all = [
        "light",
        "dark",
        "green",
        "orange",
        "purple",
        "accessible",
        "accessibledark",
      ];
      document.documentElement.classList.remove(...all);
      document.documentElement.classList.add(t);
    }, theme)
    .catch(() => {});
  await page.waitForTimeout(150);
}

async function dismissOnboardingOverlay(page: Page): Promise<void> {
  const overlay = page.locator('[data-name="nextstep-overlay"]');
  if (await overlay.isVisible({ timeout: 500 }).catch(() => false)) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }
}

/** Best-effort: open the page's primary dialog. Returns whether one opened. */
async function openDialog(page: Page): Promise<boolean> {
  const trigger = page
    .getByRole("button", {
      name: /add|new|create|invite|connect|upload|import|generate/i,
    })
    .first();
  if (!(await trigger.isVisible({ timeout: 1500 }).catch(() => false)))
    return false;
  await trigger.click({ timeout: 2000 }).catch(() => {});
  const dialog = page.locator('[role="dialog"]').first();
  return await dialog.isVisible({ timeout: 3000 }).catch(() => false);
}

/** Best-effort: open a row/action menu. Returns whether one opened. */
async function openMenu(page: Page): Promise<boolean> {
  const trigger = page
    .locator(
      'button[aria-haspopup="menu"], [data-testid$="actions-menu"], [data-testid$="-menu-trigger"], button:has(svg.lucide-ellipsis-vertical), button:has(svg.lucide-ellipsis)'
    )
    .first();
  if (!(await trigger.isVisible({ timeout: 1500 }).catch(() => false)))
    return false;
  await trigger.click({ timeout: 2000 }).catch(() => {});
  const menu = page.locator('[role="menu"]').first();
  return await menu.isVisible({ timeout: 2500 }).catch(() => false);
}

async function scanInteraction(
  page: Page,
  kind: InteractiveState
): Promise<StateResult | null> {
  const reached =
    kind === "dialog" ? await openDialog(page) : await openMenu(page);
  if (!reached) {
    return {
      state: kind,
      reached: false,
      url: page.url(),
      wcagViolations: [],
      bestPracticeViolations: [],
    };
  }
  const { wcag, best } = await runAxe(page);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
  return {
    state: kind,
    reached: true,
    url: page.url(),
    wcagViolations: wcag,
    bestPracticeViolations: best,
  };
}

function missingFixture(route: A11yRoute): keyof A11yFixtures | null {
  if (!route.needs) return null;
  if (!fixtures) return route.needs[0] ?? null;
  for (const key of route.needs) {
    const val = fixtures[key];
    if (val === undefined || val === null || val === "" || val === 0)
      return key;
  }
  return null;
}

function writeResult(result: RouteResult): void {
  fs.writeFileSync(
    path.join(RESULTS_DIR, `${result.name}.json`),
    JSON.stringify(result, null, 2)
  );
}

for (const route of routes) {
  if (SMOKE && !SMOKE_ROUTES.has(route.name)) continue;
  test(`a11y: ${route.group} › ${route.name}`, async ({ page, browser }) => {
    test.setTimeout(90_000);

    const result: RouteResult = {
      name: route.name,
      group: route.group,
      requestedPath: "",
      finalUrl: "",
      authRequired: route.authRequired,
      scannedAt: new Date().toISOString(),
      status: "scanned",
      states: [],
    };

    // Skip routes whose required seeded entity is unavailable — recorded, not silent.
    const missing = missingFixture(route);
    if (missing) {
      result.status = "skipped";
      result.note = `Missing seeded fixture "${String(missing)}" — route not scanned.`;
      writeResult(result);
      test.skip(true, result.note);
      return;
    }

    const relPath = route.path(fixtures ?? ({} as A11yFixtures));
    const url = `/${LOCALE}${relPath}`;
    result.requestedPath = url;

    // Unauthenticated routes scan in a throwaway context with no storageState.
    let ctx: BrowserContext | null = null;
    let scanPage: Page = page;
    if (!route.authRequired) {
      ctx = await browser.newContext({ storageState: undefined });
      scanPage = await ctx.newPage();
    }
    await stubBellSSE(scanPage);

    try {
      const resp = await scanPage.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await settle(scanPage, route);
      result.finalUrl = scanPage.url();

      if (resp && resp.status() >= 400) {
        result.note = `HTTP ${resp.status()} on navigation`;
      }
      if (
        route.mayRedirect &&
        !result.finalUrl.includes(relPath.split("?")[0])
      ) {
        result.note = `Redirected to ${new URL(result.finalUrl).pathname}`;
      }

      const initial = await runAxe(scanPage);
      result.states.push({
        state: "initial",
        reached: true,
        url: result.finalUrl,
        wcagViolations: initial.wcag,
        bestPracticeViolations: initial.best,
      });

      for (const kind of route.interactions ?? []) {
        const s = await scanInteraction(scanPage, kind).catch(() => null);
        if (s) result.states.push(s);
      }
    } catch (e) {
      result.status = "error";
      result.note = `Scan error: ${String(e).slice(0, 300)}`;
    } finally {
      if (ctx) await ctx.close();
    }

    writeResult(result);

    if (STRICT && result.status === "scanned") {
      const blocking = result.states
        .flatMap((s) => s.wcagViolations)
        .filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        blocking,
        `${route.name}: ${blocking.length} serious/critical WCAG violation(s): ${[
          ...new Set(blocking.map((b) => `${b.id} (${b.criterion})`)),
        ].join(", ")}`
      ).toEqual([]);
    }
  });
}
