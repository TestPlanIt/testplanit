/**
 * k6 summary export helper.
 *
 * Every capacity test uses handleSummary() to save structured JSON
 * results to disk. The runner and report generator consume those files.
 */

/**
 * Build a handleSummary function that writes JSON to the specified path
 * and prints a human-readable summary to stdout.
 *
 * @param {string} testId - Short identifier like "01-concurrent-users"
 * @param {string} tier - Data tier: "small" | "medium" | "large"
 * @returns {function} handleSummary callback for k6
 */
export function makeSummaryWriter(testId, tier) {
  return function handleSummary(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = `capacity/results/${timestamp}_${testId}_${tier}.json`;

    // Extract key metrics for easy report consumption
    const summary = {
      testId,
      tier,
      timestamp: new Date().toISOString(),
      duration_s: data.state?.testRunDurationMs
        ? data.state.testRunDurationMs / 1000
        : 0,
      vus_max: data.metrics?.vus_max?.values?.max ?? 0,
      iterations: data.metrics?.iterations?.values?.count ?? 0,
      http_reqs: data.metrics?.http_reqs?.values?.count ?? 0,
      http_req_rate: data.metrics?.http_reqs?.values?.rate ?? 0,
      http_req_failed_rate: data.metrics?.http_req_failed?.values?.rate ?? 0,
      http_req_duration: {
        avg: data.metrics?.http_req_duration?.values?.avg ?? 0,
        med: data.metrics?.http_req_duration?.values?.med ?? 0,
        p90: data.metrics?.http_req_duration?.values?.["p(90)"] ?? 0,
        p95: data.metrics?.http_req_duration?.values?.["p(95)"] ?? 0,
        p99: data.metrics?.http_req_duration?.values?.["p(99)"] ?? 0,
        max: data.metrics?.http_req_duration?.values?.max ?? 0,
      },
      // Include custom metrics (e.g., latency by data size)
      custom_metrics: extractCustomMetrics(data.metrics),
      thresholds: extractThresholds(data.metrics),
    };

    return {
      [outputPath]: JSON.stringify(summary, null, 2),
      stdout: buildTextReport(summary),
    };
  };
}

function extractCustomMetrics(metrics) {
  const custom = {};
  if (!metrics) return custom;

  for (const [name, metric] of Object.entries(metrics)) {
    // Skip built-in metrics we already extract
    const builtIn = [
      "vus",
      "vus_max",
      "iterations",
      "iteration_duration",
      "http_reqs",
      "http_req_duration",
      "http_req_failed",
      "http_req_blocked",
      "http_req_connecting",
      "http_req_tls_handshaking",
      "http_req_sending",
      "http_req_waiting",
      "http_req_receiving",
      "data_sent",
      "data_received",
      "checks",
    ];
    if (builtIn.includes(name)) continue;

    custom[name] = metric.values ?? metric;
  }
  return custom;
}

function extractThresholds(metrics) {
  const out = {};
  if (!metrics) return out;

  for (const [name, metric] of Object.entries(metrics)) {
    if (metric.thresholds) {
      out[name] = Object.entries(metric.thresholds).map(([rule, info]) => ({
        rule,
        ok: info.ok,
      }));
    }
  }
  return out;
}

function buildTextReport(summary) {
  const lines = [];
  lines.push("");
  lines.push("═══════════════════════════════════════════════════");
  lines.push(`  Capacity Test: ${summary.testId} (${summary.tier})`);
  lines.push("═══════════════════════════════════════════════════");
  lines.push(`  Duration:       ${summary.duration_s.toFixed(1)}s`);
  lines.push(`  Peak VUs:       ${summary.vus_max}`);
  lines.push(`  Iterations:     ${summary.iterations}`);
  lines.push(`  Requests:       ${summary.http_reqs}`);
  lines.push(`  Throughput:     ${summary.http_req_rate.toFixed(2)} req/s`);
  lines.push(
    `  Error rate:     ${(summary.http_req_failed_rate * 100).toFixed(2)}%`
  );
  lines.push(`  Latency:`);
  lines.push(
    `    p50=${summary.http_req_duration.med.toFixed(0)}ms  ` +
      `p95=${summary.http_req_duration.p95.toFixed(0)}ms  ` +
      `p99=${summary.http_req_duration.p99.toFixed(0)}ms  ` +
      `max=${summary.http_req_duration.max.toFixed(0)}ms`
  );
  if (Object.keys(summary.custom_metrics).length > 0) {
    lines.push(`  Custom metrics:`);
    for (const [name, values] of Object.entries(summary.custom_metrics)) {
      lines.push(`    ${name}: ${JSON.stringify(values)}`);
    }
  }
  lines.push("═══════════════════════════════════════════════════");
  lines.push("");
  return lines.join("\n");
}
