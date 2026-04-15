/**
 * Capacity Test 06: Search Performance at Data Scale
 *
 * Answers: "Does search stay fast as the test case library grows
 * from thousands to millions of cases?"
 *
 * Runs a variety of search queries (simple, filtered, faceted,
 * typeahead) at the current data tier. p50/p95/p99 latency per
 * query type is captured so we can compare across tiers.
 *
 * Run: k6 run --env BASE_URL=... --env API_TOKEN=... --env TIER=large capacity/06-search-at-scale.js
 */

import { sleep } from "k6";
import { Trend } from "k6/metrics";
import { postApi, getApi } from "../helpers/api.js";
import { PROJECT_ID } from "../config.js";
import { makeSummaryWriter } from "./helpers/summary.js";

const TIER = __ENV.TIER || "medium";
const TEST_ID = "06-search-at-scale";

const searchLatency = {
  simple: new Trend("search_simple_ms"),
  filtered: new Trend("search_filtered_ms"),
  paginated_deep: new Trend("search_paginated_deep_ms"),
  date_range: new Trend("search_date_range_ms"),
  typeahead: new Trend("search_typeahead_ms"),
};

const QUERIES = ["login", "payment", "authentication", "api", "timeout", "error", "mobile", "security"];

export const options = {
  // Modest concurrency — we're measuring search quality at data scale,
  // not overloading the server
  scenarios: {
    search_mix: {
      executor: "constant-vus",
      vus: 10,
      duration: "5m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    search_simple_ms: ["p(95)<1000"],
    search_filtered_ms: ["p(95)<1500"],
    search_paginated_deep_ms: ["p(95)<2000"],
    search_typeahead_ms: ["p(95)<500"],
  },
};

export default function () {
  const q = QUERIES[Math.floor(Math.random() * QUERIES.length)];

  // Simple search (no filters)
  let start = Date.now();
  postApi(
    "/api/repository-cases/search",
    { query: q, filters: { projectIds: [PROJECT_ID] }, pagination: { page: 1, size: 25 } },
    { scenarioTag: "search" }
  );
  searchLatency.simple.add(Date.now() - start);
  sleep(0.3);

  // Filtered search (automated=false)
  start = Date.now();
  postApi(
    "/api/repository-cases/search",
    {
      query: q,
      filters: { projectIds: [PROJECT_ID], automated: false },
      pagination: { page: 1, size: 25 },
    },
    { scenarioTag: "search" }
  );
  searchLatency.filtered.add(Date.now() - start);
  sleep(0.3);

  // Deep pagination
  start = Date.now();
  postApi(
    "/api/repository-cases/search",
    {
      query: "",
      filters: { projectIds: [PROJECT_ID] },
      pagination: { page: 20, size: 25 },
    },
    { scenarioTag: "search" }
  );
  searchLatency.paginated_deep.add(Date.now() - start);
  sleep(0.3);

  // Date range filter
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  start = Date.now();
  postApi(
    "/api/repository-cases/search",
    {
      query: "",
      filters: {
        projectIds: [PROJECT_ID],
        dateRange: {
          field: "createdAt",
          from: thirtyDaysAgo.toISOString(),
          to: now.toISOString(),
        },
      },
      pagination: { page: 1, size: 25 },
    },
    { scenarioTag: "search" }
  );
  searchLatency.date_range.add(Date.now() - start);
  sleep(0.3);

  // Typeahead — quick successive prefix queries
  const word = q.substring(0, 1 + Math.floor(Math.random() * q.length));
  start = Date.now();
  getApi(
    `/api/repository-cases/search?prefix=${encodeURIComponent(word)}&field=name&size=10`,
    { scenarioTag: "search" }
  );
  searchLatency.typeahead.add(Date.now() - start);

  sleep(0.5 + Math.random());
}

export const handleSummary = makeSummaryWriter(TEST_ID, TIER);
