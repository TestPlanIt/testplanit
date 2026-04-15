#!/usr/bin/env node
/**
 * Capacity report generator.
 *
 * Reads k6 JSON summaries from capacity/results/ and produces a
 * markdown capacity report evaluating pass/fail against thresholds.
 *
 * Usage: node generate-report.js <runId> <tier>
 *        node generate-report.js 20260414-153000-medium medium
 */

const fs = require("fs");
const path = require("path");

const [runId, tier] = process.argv.slice(2);
if (!runId || !tier) {
  console.error("Usage: node generate-report.js <runId> <tier>");
  process.exit(1);
}

const RESULTS_DIR = path.resolve(__dirname, "results");
const THRESHOLDS_PATH = path.resolve(__dirname, "thresholds.json");

const thresholds = JSON.parse(fs.readFileSync(THRESHOLDS_PATH, "utf8"));

// Discover all JSON summaries for this tier, newest first
const allFiles = fs
  .readdirSync(RESULTS_DIR)
  .filter((f) => f.endsWith(".json") && f.includes(`_${tier}.json`))
  .sort()
  .reverse();

// Group by test, keeping only the latest for each
const latestPerTest = new Map();
for (const file of allFiles) {
  // Filename: 2026-04-14T12-00-00-000Z_01-concurrent-users_medium.json
  const match = file.match(/_(\d{2}-[^_]+)_/);
  if (!match) continue;
  const testId = match[1];
  if (!latestPerTest.has(testId)) {
    latestPerTest.set(testId, path.join(RESULTS_DIR, file));
  }
}

// Load summaries
const summaries = [];
for (const [, filePath] of latestPerTest) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    summaries.push(data);
  } catch (err) {
    console.warn(`Could not parse ${filePath}: ${err.message}`);
  }
}

// Sort by testId
summaries.sort((a, b) => a.testId.localeCompare(b.testId));

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

const lines = [];
lines.push(`# TestPlanIt Capacity Report`);
lines.push("");
lines.push(`- **Run ID:** ${runId}`);
lines.push(`- **Data tier:** ${tier}`);
lines.push(`- **Generated:** ${new Date().toISOString()}`);
lines.push(`- **Tests included:** ${summaries.length}`);
lines.push("");
// Tier definitions — mirrors the TIERS block in seed-tier.js. Kept here
// so the report is self-contained and reviewers can see at a glance what
// dataset the numbers came from.
const TIER_DATASETS = {
  small:  { projects: 5,  cases: 2500,  runs: 100, folders: 50 },
  medium: { projects: 20, cases: 20000, runs: 2000, folders: 200 },
  large:  { projects: 50, cases: 100000, runs: 10000, folders: 500 },
};
const seed = TIER_DATASETS[tier];
if (seed) {
  lines.push("## Test Dataset");
  lines.push("");
  lines.push(`Seeded baseline for the \`${tier}\` tier (volume before the suite runs):`);
  lines.push("");
  lines.push(`- **Projects:** ${seed.projects.toLocaleString()}`);
  lines.push(`- **Repository folders:** ${seed.folders.toLocaleString()}`);
  lines.push(`- **Test cases:** ${seed.cases.toLocaleString()}`);
  lines.push(`- **Test runs:** ${seed.runs.toLocaleString()}`);
  lines.push("");
  lines.push(
    "Note: `02-import-rate` and `03-result-ingestion-rate` grow this dataset " +
    "significantly while they run (tens of thousands of additional cases and results), " +
    "so later tests (`04`-`08`) actually execute against a larger corpus than the seed above."
  );
  lines.push("");
}

lines.push("## Pass/Fail Criteria");
lines.push("");
lines.push(`- Error rate < ${thresholds.error_rate_max * 100}%`);
lines.push(`- p95 latency per scenario:`);
for (const [scenario, p95] of Object.entries(thresholds.latency_p95_ms)) {
  lines.push(`  - ${scenario}: ${p95}ms`);
}
lines.push("");

// ---------------------------------------------------------------------------
// Executive summary table
// ---------------------------------------------------------------------------
lines.push("## Summary");
lines.push("");
lines.push("| Test | Verdict | Peak VUs | Throughput | p95 latency | Error rate |");
lines.push("|---|---|---|---|---|---|");

for (const s of summaries) {
  const verdict = evaluateVerdict(s);
  const vu = s.vus_max;
  const rps = `${s.http_req_rate.toFixed(1)} req/s`;
  const p95 = `${s.http_req_duration.p95.toFixed(0)}ms`;
  const errPct = `${(s.http_req_failed_rate * 100).toFixed(2)}%`;
  lines.push(`| ${s.testId} | ${verdict} | ${vu} | ${rps} | ${p95} | ${errPct} |`);
}
lines.push("");

// ---------------------------------------------------------------------------
// Per-test details
// ---------------------------------------------------------------------------
lines.push("## Per-Test Detail");
lines.push("");

for (const s of summaries) {
  lines.push(`### ${s.testId}`);
  lines.push("");
  lines.push(`- **Verdict:** ${evaluateVerdict(s)}`);
  lines.push(`- **Duration:** ${s.duration_s.toFixed(0)}s`);
  lines.push(`- **Peak VUs:** ${s.vus_max}`);
  lines.push(`- **Iterations:** ${s.iterations}`);
  lines.push(`- **Total requests:** ${s.http_reqs.toLocaleString()}`);
  lines.push(`- **Throughput:** ${s.http_req_rate.toFixed(2)} req/s`);
  lines.push(`- **Error rate:** ${(s.http_req_failed_rate * 100).toFixed(3)}%`);
  lines.push(`- **Latency (ms):** median=${s.http_req_duration.med.toFixed(0)}, p95=${s.http_req_duration.p95.toFixed(0)}, p99=${s.http_req_duration.p99.toFixed(0)}, max=${s.http_req_duration.max.toFixed(0)}`);

  if (s.custom_metrics && Object.keys(s.custom_metrics).length > 0) {
    lines.push("");
    lines.push(`**Custom metrics:**`);
    for (const [name, v] of Object.entries(s.custom_metrics)) {
      if (v.avg !== undefined) {
        lines.push(`- \`${name}\`: avg=${v.avg?.toFixed(0)}ms, p95=${v["p(95)"]?.toFixed(0)}ms, max=${v.max?.toFixed(0)}ms`);
      } else if (v.count !== undefined) {
        lines.push(`- \`${name}\`: count=${v.count}, rate=${v.rate?.toFixed(2)}/s`);
      } else {
        lines.push(`- \`${name}\`: ${JSON.stringify(v)}`);
      }
    }
  }

  if (s.thresholds && Object.keys(s.thresholds).length > 0) {
    const failing = Object.entries(s.thresholds)
      .flatMap(([metric, rules]) => rules.filter((r) => !r.ok).map((r) => `${metric}: ${r.rule}`));
    if (failing.length > 0) {
      lines.push("");
      lines.push(`**Failing thresholds:**`);
      for (const f of failing) lines.push(`- ${f}`);
    }
  }

  lines.push("");
}

// ---------------------------------------------------------------------------
// Historical comparison (if previous runs exist)
// ---------------------------------------------------------------------------
const historicalData = buildHistoricalData(tier);
if (historicalData.length > 1) {
  lines.push("## Historical Trends");
  lines.push("");
  lines.push("Previous runs of the same tier:");
  lines.push("");
  lines.push("| Run ID | Test | p95 | Error rate | Throughput |");
  lines.push("|---|---|---|---|---|");
  for (const h of historicalData.slice(0, 20)) {
    lines.push(
      `| ${h.runId} | ${h.testId} | ${h.p95.toFixed(0)}ms | ${(h.errRate * 100).toFixed(2)}% | ${h.throughput.toFixed(1)} req/s |`
    );
  }
  lines.push("");
}

// ---------------------------------------------------------------------------
// Write the report
// ---------------------------------------------------------------------------
const outPath = path.join(RESULTS_DIR, `${runId}-report.md`);
fs.writeFileSync(outPath, lines.join("\n"));
console.log(`Report: ${outPath}`);

// ---------------------------------------------------------------------------
function evaluateVerdict(summary) {
  const reasons = [];

  if (summary.http_req_failed_rate > thresholds.error_rate_max) {
    reasons.push(`error rate ${(summary.http_req_failed_rate * 100).toFixed(2)}% > ${thresholds.error_rate_max * 100}%`);
  }

  // Check if any p95 threshold violated (we can't tell per-scenario from aggregate summary,
  // so we use the global p95 against the most lenient threshold)
  const maxP95 = Math.max(...Object.values(thresholds.latency_p95_ms));
  if (summary.http_req_duration.p95 > maxP95) {
    reasons.push(`p95 ${summary.http_req_duration.p95.toFixed(0)}ms > ${maxP95}ms`);
  }

  // Check k6-level thresholds that failed
  if (summary.thresholds) {
    for (const [metric, rules] of Object.entries(summary.thresholds)) {
      for (const rule of rules) {
        if (!rule.ok) reasons.push(`${metric}: ${rule.rule}`);
      }
    }
  }

  if (reasons.length === 0) return "✅ PASS";
  return `❌ FAIL (${reasons.join("; ")})`;
}

function buildHistoricalData(tier) {
  const out = [];
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith(".json") && f.includes(`_${tier}.json`))
    .sort()
    .reverse();

  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf8"));
      // Derive runId from filename prefix
      const runIdMatch = f.match(/^([^_]+)_/);
      out.push({
        runId: runIdMatch?.[1] ?? "(unknown)",
        testId: data.testId,
        p95: data.http_req_duration?.p95 ?? 0,
        errRate: data.http_req_failed_rate ?? 0,
        throughput: data.http_req_rate ?? 0,
      });
    } catch {
      // skip unparseable
    }
  }
  return out;
}
