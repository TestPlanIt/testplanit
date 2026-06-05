/**
 * Reads the per-route axe JSON in results/ and produces:
 *   - results/report.md   — human-readable, deduped, grouped by WCAG SC
 *   - results/report.json — machine-readable rollup (for CI / VPAT tooling)
 *
 * Run standalone with `pnpm a11y:report` or automatically after `pnpm a11y:scan`.
 * In strict mode (A11Y_STRICT=on or CI=strict) it exits non-zero when any
 * serious/critical WCAG finding exists.
 */
import fs from "fs";
import path from "path";
import { primaryCriterion, type WcagLevel } from "./wcag";

const RESULTS_DIR = path.join(__dirname, "results");
const STRICT = process.env.A11Y_STRICT === "on" || process.env.CI === "strict";

const IMPACT_ORDER = ["critical", "serious", "moderate", "minor"] as const;
type Impact = (typeof IMPACT_ORDER)[number] | "none";

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
  criterion: string;
  criterionKey: string;
  nodeCount: number;
  nodes: ViolationNode[];
}
interface StateResult {
  state: string;
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

/** A rule deduped across every route/state it appeared on. */
interface Finding {
  id: string;
  impact: Impact;
  criterionKey: string;
  criterionLabel: string; // "1.4.3 Contrast (Minimum)"
  scNum: string;
  scLevel: WcagLevel;
  help: string;
  helpUrl: string;
  description: string;
  routes: Set<string>; // "route" or "route (dialog)"
  totalNodes: number;
  sampleSelector: string;
  sampleHtml: string;
  sampleFailure: string;
}

function impactRank(i: Impact): number {
  const idx = (IMPACT_ORDER as readonly string[]).indexOf(i);
  return idx === -1 ? 99 : idx;
}
function worseImpact(a: Impact, b: Impact): Impact {
  return impactRank(a) <= impactRank(b) ? a : b;
}

function loadResults(): RouteResult[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json") && f !== "report.json")
    .map(
      (f) =>
        JSON.parse(
          fs.readFileSync(path.join(RESULTS_DIR, f), "utf8")
        ) as RouteResult
    );
}

function dedupe(
  results: RouteResult[],
  kind: "wcag" | "best"
): Map<string, Finding> {
  const findings = new Map<string, Finding>();
  for (const r of results) {
    if (r.status !== "scanned") continue;
    for (const state of r.states) {
      const label =
        state.state === "initial" ? r.name : `${r.name} (${state.state})`;
      const vios =
        kind === "wcag" ? state.wcagViolations : state.bestPracticeViolations;
      for (const v of vios) {
        const sc = primaryCriterion(v.tags);
        let f = findings.get(v.id);
        if (!f) {
          f = {
            id: v.id,
            impact: (v.impact as Impact) || "none",
            criterionKey: sc.key,
            criterionLabel: sc.num === "—" ? sc.name : `${sc.num} ${sc.name}`,
            scNum: sc.num,
            scLevel: sc.level,
            help: v.help,
            helpUrl: v.helpUrl,
            description: v.description,
            routes: new Set(),
            totalNodes: 0,
            sampleSelector: v.nodes[0]?.target?.join(" ") || "",
            sampleHtml: v.nodes[0]?.html || "",
            sampleFailure: v.nodes[0]?.failureSummary || "",
          };
          findings.set(v.id, f);
        }
        f.impact = worseImpact(f.impact, (v.impact as Impact) || "none");
        f.routes.add(label);
        f.totalNodes += v.nodeCount;
      }
    }
  }
  return findings;
}

function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}
function codeFence(s: string): string {
  return "`" + s.replace(/`/g, "ʼ").slice(0, 200) + "`";
}

function build(): { md: string; json: unknown; blockingCount: number } {
  const results = loadResults();
  const scanned = results.filter((r) => r.status === "scanned");
  const skipped = results.filter((r) => r.status === "skipped");
  const errored = results.filter((r) => r.status === "error");

  const wcag = [...dedupe(results, "wcag").values()];
  const best = [...dedupe(results, "best").values()];

  // Impact tallies (unique rules + route occurrences).
  const tally = (findings: Finding[]) => {
    const byImpact: Record<string, { rules: number; occurrences: number }> = {};
    for (const i of IMPACT_ORDER) byImpact[i] = { rules: 0, occurrences: 0 };
    for (const f of findings) {
      const k = f.impact === "none" ? "minor" : f.impact;
      if (!byImpact[k]) byImpact[k] = { rules: 0, occurrences: 0 };
      byImpact[k].rules += 1;
      byImpact[k].occurrences += f.routes.size;
    }
    return byImpact;
  };
  const wcagTally = tally(wcag);

  const blocking = wcag.filter(
    (f) => f.impact === "serious" || f.impact === "critical"
  );

  // Sort: impact, then routes affected desc.
  const bySpread = (a: Finding, b: Finding) =>
    impactRank(a.impact) - impactRank(b.impact) ||
    b.routes.size - a.routes.size;
  wcag.sort(bySpread);
  best.sort(bySpread);

  const top5 = [...wcag]
    .sort(
      (a, b) =>
        b.routes.size - a.routes.size ||
        impactRank(a.impact) - impactRank(b.impact)
    )
    .slice(0, 5);

  // Group WCAG findings by success criterion.
  const byCriterion = new Map<string, Finding[]>();
  for (const f of wcag) {
    const arr = byCriterion.get(f.criterionLabel) || [];
    arr.push(f);
    byCriterion.set(f.criterionLabel, arr);
  }
  const criteria = [...byCriterion.entries()].sort((a, b) => {
    const aw = Math.min(...a[1].map((f) => impactRank(f.impact)));
    const bw = Math.min(...b[1].map((f) => impactRank(f.impact)));
    return aw - bw || a[0].localeCompare(b[0], undefined, { numeric: true });
  });

  const now = new Date().toISOString();
  const L: string[] = [];
  L.push(`# Accessibility Scan Report`);
  L.push("");
  L.push(
    `Generated ${now} · axe-core (\`wcag2a\`, \`wcag2aa\`, \`wcag21a\`, \`wcag21aa\`, \`wcag22aa\`, \`best-practice\`)`
  );
  L.push("");
  L.push(
    `**Theme scanned:** ${process.env.A11Y_THEME || "default (seeded user preference)"}`
  );
  L.push("");
  L.push(
    `This is the **automated baseline** for a WCAG 2.2 AA audit feeding a VPAT 2.5 (INT) report. Automated scanning catches roughly a third of WCAG issues; manual keyboard/screen-reader testing is still required for full conformance claims.`
  );
  L.push("");

  // ---- Summary ----
  L.push(`## Summary`);
  L.push("");
  L.push(
    `- **Routes scanned:** ${scanned.length}  ·  **skipped:** ${skipped.length}  ·  **errored:** ${errored.length}`
  );
  L.push(
    `- **WCAG A/AA findings (unique rules):** ${wcag.length}  ·  **best-practice findings:** ${best.length}`
  );
  L.push(`- **Serious/critical WCAG findings:** ${blocking.length}`);
  L.push("");
  L.push(`| Impact | Unique rules | Route occurrences |`);
  L.push(`| --- | ---: | ---: |`);
  for (const i of IMPACT_ORDER) {
    L.push(`| ${i} | ${wcagTally[i].rules} | ${wcagTally[i].occurrences} |`);
  }
  L.push("");

  // ---- Top 5 ----
  L.push(`### Top 5 most widespread WCAG issues`);
  L.push("");
  if (top5.length === 0) {
    L.push(`_No WCAG A/AA violations detected._`);
  } else {
    L.push(`| Rule | Criterion | Impact | Routes affected |`);
    L.push(`| --- | --- | --- | ---: |`);
    for (const f of top5) {
      L.push(
        `| \`${f.id}\` | ${esc(f.criterionLabel)} | ${f.impact} | ${f.routes.size} |`
      );
    }
  }
  L.push("");

  // ---- Findings by criterion ----
  L.push(`## WCAG findings by success criterion`);
  L.push("");
  if (criteria.length === 0) L.push(`_None._`);
  for (const [label, findings] of criteria) {
    const level = findings[0]?.scLevel ?? "AA";
    L.push(`### ${label} — Level ${level}`);
    L.push("");
    for (const f of findings) {
      L.push(
        `#### \`${f.id}\` — ${f.impact} · ${f.routes.size} route(s) · ${f.totalNodes} element(s)`
      );
      L.push("");
      L.push(`${esc(f.help)}. [Reference](${f.helpUrl})`);
      L.push("");
      if (f.sampleSelector)
        L.push(`- **Example selector:** ${codeFence(f.sampleSelector)}`);
      if (f.sampleHtml)
        L.push(`- **Example element:** ${codeFence(f.sampleHtml)}`);
      if (f.sampleFailure)
        L.push(`- **axe fix guidance:** ${esc(f.sampleFailure)}`);
      L.push(
        `- **Affected routes:** ${[...f.routes]
          .sort()
          .map((r) => `\`${r}\``)
          .join(", ")}`
      );
      L.push("");
    }
  }

  // ---- Best practice ----
  L.push(`## Best-practice (non-WCAG) findings`);
  L.push("");
  L.push(
    `_Reported for awareness; not counted against WCAG 2.2 AA conformance._`
  );
  L.push("");
  if (best.length === 0) {
    L.push(`_None._`);
  } else {
    L.push(`| Rule | Impact | Routes | Guidance |`);
    L.push(`| --- | --- | ---: | --- |`);
    for (const f of best) {
      L.push(
        `| \`${f.id}\` | ${f.impact} | ${f.routes.size} | ${esc(f.help)} |`
      );
    }
  }
  L.push("");

  // ---- Coverage notes ----
  L.push(`## Coverage notes`);
  L.push("");
  if (skipped.length) {
    L.push(
      `**Skipped routes (${skipped.length})** — recorded rather than silently dropped:`
    );
    for (const r of skipped)
      L.push(`- \`${r.name}\` — ${esc(r.note || "skipped")}`);
    L.push("");
  }
  if (errored.length) {
    L.push(`**Errored routes (${errored.length}):**`);
    for (const r of errored)
      L.push(
        `- \`${r.name}\` (${esc(r.requestedPath)}) — ${esc(r.note || "error")}`
      );
    L.push("");
  }
  const redirected = scanned.filter((r) => r.note && /redirect/i.test(r.note));
  if (redirected.length) {
    L.push(
      `**Redirected routes (${redirected.length})** — scanned at their landing page:`
    );
    for (const r of redirected) L.push(`- \`${r.name}\` — ${esc(r.note!)}`);
    L.push("");
  }
  const interactionStates = scanned.flatMap((r) =>
    r.states.filter((s) => s.state !== "initial").map((s) => ({ r: r.name, s }))
  );
  const unreached = interactionStates.filter((x) => !x.s.reached);
  if (interactionStates.length) {
    L.push(
      `**Interactive-state scans:** ${interactionStates.length - unreached.length}/${interactionStates.length} reached (dialog/menu opened and re-scanned).`
    );
    L.push("");
  }

  const json = {
    generatedAt: now,
    summary: {
      scanned: scanned.length,
      skipped: skipped.length,
      errored: errored.length,
      wcagUniqueRules: wcag.length,
      bestPracticeRules: best.length,
      blocking: blocking.length,
      impact: wcagTally,
    },
    wcagFindings: wcag.map((f) => ({ ...f, routes: [...f.routes].sort() })),
    bestPracticeFindings: best.map((f) => ({
      ...f,
      routes: [...f.routes].sort(),
    })),
    skipped: skipped.map((r) => ({ name: r.name, note: r.note })),
    errored: errored.map((r) => ({
      name: r.name,
      path: r.requestedPath,
      note: r.note,
    })),
  };

  return { md: L.join("\n") + "\n", json, blockingCount: blocking.length };
}

function main(): void {
  const { md, json, blockingCount } = build();
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "report.md"), md);
  fs.writeFileSync(
    path.join(RESULTS_DIR, "report.json"),
    JSON.stringify(json, null, 2)
  );
  console.log(
    `[a11y] report written to ${path.relative(process.cwd(), path.join(RESULTS_DIR, "report.md"))}`
  );
  console.log(`[a11y] ${blockingCount} serious/critical WCAG finding(s)`);
  if (STRICT && blockingCount > 0) {
    console.error(
      `[a11y] STRICT mode: failing because ${blockingCount} serious/critical WCAG finding(s) exist.`
    );
    process.exit(1);
  }
}

main();
