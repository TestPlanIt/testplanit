/**
 * ZenStack CRUD API helpers for k6 load tests.
 *
 * Wraps the /api/model/{model}/{operation} pattern with proper
 * query encoding and error checking.
 */

import http from "k6/http";
import { check } from "k6";
import { BASE_URL, headers } from "../config.js";

/**
 * findMany — list records with optional filtering, pagination, and includes.
 *
 * @param {string} model - ZenStack model name (e.g. "projects", "repositoryCases")
 * @param {object} query - Prisma-style query object ({ where, include, take, skip, orderBy })
 * @param {object} [opts] - Extra options ({ tags, scenarioTag })
 * @returns {object} Parsed JSON response
 */
export function findMany(model, query = {}, opts = {}) {
  const q = encodeURIComponent(JSON.stringify(query));
  const url = `${BASE_URL}/api/model/${model}/findMany?q=${q}`;
  const tags = buildTags(opts);
  const res = http.get(url, { headers, tags });
  check(res, {
    [`${model}.findMany status 200`]: (r) => r.status === 200,
  });
  return safeJson(res);
}

/**
 * findFirst — fetch a single record.
 */
export function findFirst(model, query = {}, opts = {}) {
  const q = encodeURIComponent(JSON.stringify(query));
  const url = `${BASE_URL}/api/model/${model}/findFirst?q=${q}`;
  const tags = buildTags(opts);
  const res = http.get(url, { headers, tags });
  check(res, {
    [`${model}.findFirst status 200`]: (r) => r.status === 200,
  });
  return safeJson(res);
}

/**
 * count — count matching records.
 */
export function count(model, query = {}, opts = {}) {
  const q = encodeURIComponent(JSON.stringify(query));
  const url = `${BASE_URL}/api/model/${model}/count?q=${q}`;
  const tags = buildTags(opts);
  const res = http.get(url, { headers, tags });
  check(res, {
    [`${model}.count status 200`]: (r) => r.status === 200,
  });
  return safeJson(res);
}

/**
 * create — create a new record.
 *
 * @param {string} model - ZenStack model name
 * @param {object} data - Record data (Prisma create input)
 * @param {object} [opts] - Extra options
 * @returns {object} Created record
 */
export function create(model, data, opts = {}) {
  const url = `${BASE_URL}/api/model/${model}/create`;
  const tags = buildTags(opts);
  const body = JSON.stringify({ data });
  const res = http.post(url, body, { headers, tags });
  check(res, {
    [`${model}.create status 201`]: (r) => r.status === 200 || r.status === 201,
  });
  return safeJson(res);
}

/**
 * update — update an existing record.
 *
 * @param {string} model - ZenStack model name
 * @param {number|string} id - Record ID
 * @param {object} data - Fields to update
 * @param {object} [opts] - Extra options
 * @returns {object} Updated record
 */
export function update(model, id, data, opts = {}) {
  const url = `${BASE_URL}/api/model/${model}/update`;
  const tags = buildTags(opts);
  const body = JSON.stringify({ where: { id }, data });
  const res = http.put(url, body, { headers, tags });
  check(res, {
    [`${model}.update status 200`]: (r) => r.status === 200,
  });
  return safeJson(res);
}

/**
 * Custom POST to any API endpoint.
 */
export function postApi(path, body = {}, opts = {}) {
  const url = `${BASE_URL}${path}`;
  const tags = buildTags(opts);
  const res = http.post(url, JSON.stringify(body), { headers, tags });
  return { res, data: safeJson(res) };
}

/**
 * Custom GET to any API endpoint.
 */
export function getApi(path, opts = {}) {
  const url = `${BASE_URL}${path}`;
  const tags = buildTags(opts);
  const res = http.get(url, { headers, tags });
  return { res, data: safeJson(res) };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildTags(opts) {
  const tags = {};
  if (opts.scenarioTag) tags.scenario = opts.scenarioTag;
  return Object.keys(tags).length > 0 ? tags : undefined;
}

function safeJson(res) {
  try {
    return res.json();
  } catch {
    return null;
  }
}
