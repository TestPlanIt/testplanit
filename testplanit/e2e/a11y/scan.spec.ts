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
  type ScriptedState,
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
// How many offending elements to record per rule; raise it to work a backlog.
const NODE_LIMIT = Number(process.env.A11Y_NODE_LIMIT) || 5;

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
  state: string; // "initial", a generic kind, or a scripted state's label
  reached: boolean;
  /** Why a scripted state was not reached: the step that found nothing. */
  note?: string;
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
      nodes: v.nodes.slice(0, NODE_LIMIT).map((n) => ({
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

// Selectors excluded from every scan. Avatar initials used to sit here on the
// grounds that their generated background was data colour rather than theme
// noise — but the generator picked the foreground from a luminance sum with red
// and blue transposed, so 14.2% of the colours it could produce rendered below
// 4.5:1 and the exclusion hid exactly that. The pick now goes through
// `contrastingTextColor`, which never drops below 4.58:1 on any background, so
// there is nothing left to exclude.
const AXE_EXCLUDE_SELECTORS: string[] = [];

/**
 * Rules switched off while a select is open. Radix marks the rest of the page
 * `aria-hidden` for as long as its list is showing and keeps focus inside the
 * list, so axe's "focusable content inside aria-hidden" fires on every
 * control behind it even though none can be reached. It says nothing about
 * the list, which is what this state is opened to check.
 */
const OPEN_SELECT_DISABLED_RULES = ["aria-hidden-focus"];

async function runAxe(
  page: Page,
  scope?: string,
  disabledRules: string[] = []
): Promise<{ wcag: Violation[]; best: Violation[] }> {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (scope) builder = builder.include(scope);
  if (disabledRules.length > 0) builder = builder.disableRules(disabledRules);
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
  await freezeTransitions(page);
  if (FORCE_THEME) await applyTheme(page, FORCE_THEME);
  if (route.settleMs) await page.waitForTimeout(route.settleMs);
}

/**
 * Cancel CSS transitions for the rest of this page's life, before the theme
 * class is swapped.
 *
 * Swapping the class on <html> repoints every colour token at once, so every
 * `transition-colors` element animates from the old theme's colour to the new
 * one and axe reads whichever frame it lands on. It measured blends of two
 * themes: the project menu's section labels came back as #6c6f76, #70747b and
 * #71747b on different routes, all three on the straight line from the light
 * theme's --card-foreground (#020817) to accessibledark's (#f8fafc), and none
 * of them a colour any theme defines. Settled, that text is 17.1:1. An audit
 * wants the settled colour, which is what `transition: none` leaves behind.
 * Same bug class as settleAnimation below, for transitions rather than
 * animations.
 */
async function freezeTransitions(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const style = document.createElement("style");
      style.setAttribute("data-a11y-freeze", "");
      style.textContent =
        "*, *::before, *::after { transition: none !important }";
      document.head.appendChild(style);
    })
    .catch(() => {});
}

/**
 * Seed next-themes' stored theme before the page's first paint, so the first
 * frame is already the forced theme rather than the default.
 *
 * This is not what makes the theme stick. Header.tsx calls
 * setTheme(session.user.preferences.theme) on every session change, so the
 * saved preference wins a moment after hydration no matter what is in
 * localStorage — fixtures.setup.ts sets that preference, and this only covers
 * the window before the effect runs.
 */
async function seedTheme(page: Page, theme: string): Promise<void> {
  await page
    .addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
      } catch {
        /* private mode / blocked storage — the class swap still applies */
      }
    }, theme)
    .catch(() => {});
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

/**
 * Wait for a Radix overlay's enter animation to finish before axe reads it.
 *
 * `isVisible()` is true from the animation's first frame, where the panel's own
 * opacity is still 0. axe composites text through that ancestor opacity, so it
 * measured near-black menu items as near-white and reported 10 phantom
 * color-contrast failures per menu state — identically in every theme, which is
 * the tell that no theme colour was involved.
 */
async function settleAnimation(page: Page, selector: string): Promise<void> {
  await page
    .locator(selector)
    .first()
    .evaluate((el: Element) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((a) => a.finished.catch(() => {}))
      ).then(() => undefined)
    )
    .catch(() => {});
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
  if (!(await dialog.isVisible({ timeout: 3000 }).catch(() => false)))
    return false;
  await settleAnimation(page, '[role="dialog"]');
  return true;
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
  if (!(await menu.isVisible({ timeout: 2500 }).catch(() => false)))
    return false;
  await settleAnimation(page, '[role="menu"]');
  return true;
}

/** Best-effort: open the first select or combobox. Returns whether one opened. */
async function openSelect(page: Page): Promise<boolean> {
  const trigger = page
    .locator('main button[role="combobox"]:not([disabled])')
    .first();
  if (!(await trigger.isVisible({ timeout: 1500 }).catch(() => false)))
    return false;
  await trigger.click({ timeout: 2000 }).catch(() => {});
  const list = page.locator('[role="listbox"]').first();
  if (!(await list.isVisible({ timeout: 2500 }).catch(() => false)))
    return false;
  // The enter animation runs on the floating panel around the list, not on
  // the list itself.
  await settleAnimation(page, "[data-radix-popper-content-wrapper]");
  return true;
}

/**
 * Best-effort: open the confirmation behind the first delete button. Only
 * ever opened, never confirmed; Escape cancels it afterwards.
 */
async function openConfirm(page: Page): Promise<boolean> {
  const trigger = page
    .locator(
      "main button:has(svg.lucide-trash-2):not([disabled]), main button:has(svg.lucide-trash):not([disabled])"
    )
    .first();
  if (!(await trigger.isVisible({ timeout: 1500 }).catch(() => false)))
    return false;
  await trigger.click({ timeout: 2000 }).catch(() => {});
  const dialog = page.locator('[role="alertdialog"]').first();
  if (!(await dialog.isVisible({ timeout: 3000 }).catch(() => false)))
    return false;
  await settleAnimation(page, '[role="alertdialog"]');
  return true;
}

/**
 * Walk a scripted state's steps. Returns null when what it opens appeared,
 * otherwise what went wrong, so a broken selector is told apart from a
 * surface that did not open.
 */
async function runScript(
  page: Page,
  script: ScriptedState
): Promise<string | null> {
  for (const step of script.steps) {
    const selector = "click" in step ? step.click : step.hover;
    const target = page.locator(selector).first();
    if (!(await target.isVisible({ timeout: 2000 }).catch(() => false)))
      return `nothing visible matches ${selector}`;
    await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    if ("click" in step) await target.click({ timeout: 2000 }).catch(() => {});
    else await target.hover({ timeout: 2000 }).catch(() => {});
  }
  const opened = page.locator(script.opens).first();
  let visible = await opened.isVisible({ timeout: 1500 }).catch(() => false);
  const last = script.steps.at(-1);
  if (!visible && last && "hover" in last) {
    // A tooltip that missed the pointer (the page scrolled under it, or the
    // move landed before the trigger was listening) also opens on a second
    // pass of the pointer, and on keyboard focus.
    const target = page.locator(last.hover).first();
    await page.mouse.move(0, 0).catch(() => {});
    await target.hover({ timeout: 2000 }).catch(() => {});
    visible = await opened.isVisible({ timeout: 1500 }).catch(() => false);
    if (!visible) {
      await target.focus({ timeout: 2000 }).catch(() => {});
      visible = await opened.isVisible({ timeout: 1500 }).catch(() => false);
    }
  }
  if (!visible) return `the steps ran but ${script.opens} did not appear`;
  await settleAnimation(page, script.opens);
  return null;
}

/** Close whatever a state opened, so the next one starts from the page. */
async function closeOverlays(page: Page): Promise<void> {
  await page.mouse.move(0, 0).catch(() => {});
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(150);
  }
}

async function scanInteraction(
  page: Page,
  kind: InteractiveState
): Promise<StateResult | null> {
  const scripted = typeof kind === "string" ? null : kind;
  const state = scripted ? scripted.state : (kind as string);
  let reached = false;
  let note: string | undefined;
  if (scripted) {
    note = (await runScript(page, scripted)) ?? undefined;
    reached = !note;
  } else if (kind === "dialog") reached = await openDialog(page);
  else if (kind === "menu") reached = await openMenu(page);
  else if (kind === "select") reached = await openSelect(page);
  else if (kind === "confirm") reached = await openConfirm(page);
  if (!reached) {
    await closeOverlays(page);
    return {
      state,
      reached: false,
      note,
      url: page.url(),
      wcagViolations: [],
      bestPracticeViolations: [],
    };
  }
  const { wcag, best } = await runAxe(
    page,
    scripted?.scope,
    kind === "select" ? OPEN_SELECT_DISABLED_RULES : []
  );
  await closeOverlays(page);
  return {
    state,
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
    if (FORCE_THEME) await seedTheme(scanPage, FORCE_THEME);

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

      // A picture of what was scanned, for working out a finding on one route.
      if (process.env.A11Y_SCREENSHOT) {
        await scanPage.screenshot({
          path: process.env.A11Y_SCREENSHOT,
          fullPage: true,
        });
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
