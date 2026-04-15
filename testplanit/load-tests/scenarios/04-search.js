/**
 * Scenario 4: Search with Filters and Facets
 *
 * Tests Elasticsearch search performance under load.
 * This is critical for BBVA's "millions of tests" requirement —
 * search must remain fast as data scales.
 *
 * Simulates:
 * 1. Full-text search with various queries
 * 2. Filtered search (by template, tags, automated status)
 * 3. Paginated search results
 * 4. Search suggestions (typeahead)
 *
 * Run:
 *   k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... scenarios/04-search.js
 */

import { sleep, check } from "k6";
import { postApi, getApi, findMany } from "../helpers/api.js";
import { getProfile, thresholds, PROJECT_ID } from "../config.js";

const TAG = "search";

export const options = {
  ...getProfile(),
  thresholds,
};

// Realistic search queries a QA engineer might type
const SEARCH_QUERIES = [
  "login",
  "payment",
  "authentication",
  "API",
  "timeout",
  "error handling",
  "mobile",
  "regression",
  "smoke test",
  "database",
  "validation",
  "security",
  "performance",
  "user profile",
  "notification",
  "export",
  "import",
  "webhook",
  "SAML",
  "OAuth",
];

// Typeahead prefixes (user typing progressively)
const TYPEAHEAD_SEQUENCES = [
  ["l", "lo", "log", "logi", "login"],
  ["p", "pa", "pay", "paym", "payment"],
  ["a", "au", "aut", "auth"],
  ["s", "se", "sec", "secu", "security"],
  ["t", "te", "tes", "test"],
];

export default function search() {
  // Get project context (templates, tags) for filtered searches
  const templates = findMany(
    "templates",
    {
      where: { isDefault: true },
      select: { id: true },
      take: 5,
    },
    { scenarioTag: TAG }
  );

  sleep(0.3);

  // 1. Simple full-text search
  const query =
    SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  const { res: searchRes } = postApi(
    "/api/repository-cases/search",
    {
      query,
      filters: {
        projectIds: [PROJECT_ID],
      },
      pagination: { page: 1, size: 25 },
      highlight: true,
    },
    { scenarioTag: TAG }
  );
  check(searchRes, {
    "search status 200": (r) => r.status === 200,
  });

  sleep(1);

  // 2. Filtered search — by template
  if (templates?.data?.length > 0) {
    const templateId = templates.data[0].id;
    const { res: filteredRes } = postApi(
      "/api/repository-cases/search",
      {
        query: "",
        filters: {
          projectIds: [PROJECT_ID],
          templateIds: [templateId],
          automated: false,
        },
        pagination: { page: 1, size: 25 },
      },
      { scenarioTag: TAG }
    );
    check(filteredRes, {
      "filtered search status 200": (r) => r.status === 200,
    });
  }

  sleep(0.5);

  // 3. Paginated search — page 2 and 3
  for (let page = 2; page <= 3; page++) {
    const { res: pageRes } = postApi(
      "/api/repository-cases/search",
      {
        query,
        filters: { projectIds: [PROJECT_ID] },
        pagination: { page, size: 25 },
      },
      { scenarioTag: TAG }
    );
    check(pageRes, {
      [`search page ${page} status 200`]: (r) => r.status === 200,
    });
    sleep(0.5);
  }

  // 4. Typeahead simulation — rapid sequential requests
  const sequence =
    TYPEAHEAD_SEQUENCES[Math.floor(Math.random() * TYPEAHEAD_SEQUENCES.length)];

  for (const prefix of sequence) {
    const { res: suggestRes } = getApi(
      `/api/repository-cases/search?prefix=${encodeURIComponent(prefix)}&field=name&size=10`,
      { scenarioTag: TAG }
    );
    check(suggestRes, {
      "typeahead status 200": (r) => r.status === 200,
    });
    sleep(0.15); // fast typing simulation (~150ms between keystrokes)
  }

  // 5. Search with date range filter
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const { res: dateRes } = postApi(
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
    { scenarioTag: TAG }
  );
  check(dateRes, {
    "date-filtered search status 200": (r) => r.status === 200,
  });

  sleep(randomThinkTime());
}

function randomThinkTime() {
  return 1 + Math.random() * 3;
}
