/**
 * TestPlanIt Load Testing Configuration
 *
 * Central configuration for all k6 load test scenarios.
 * Override via environment variables when running tests.
 */

// Base URL of the TestPlanIt instance under test
export const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

// API token for authentication (create via Admin > Users > API Access)
export const API_TOKEN = __ENV.API_TOKEN || "";

// Project ID to use for single-project tests
export const PROJECT_ID = __ENV.PROJECT_ID ? parseInt(__ENV.PROJECT_ID) : 1;

// Common HTTP headers
export const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_TOKEN}`,
};

// ---------------------------------------------------------------------------
// Threshold Presets
// ---------------------------------------------------------------------------
// Use these as starting points. Adjust after baseline runs reveal actual p95s.

export const thresholds = {
  // Global
  http_req_failed: ["rate<0.01"], // <1% errors
  http_req_duration: ["p(95)<2000"], // p95 under 2s

  // Per-scenario (tagged in each script)
  "http_req_duration{scenario:browse}": ["p(95)<1000"],
  "http_req_duration{scenario:crud}": ["p(95)<1500"],
  "http_req_duration{scenario:search}": ["p(95)<1000"],
  "http_req_duration{scenario:reporting}": ["p(95)<5000"],
  "http_req_duration{scenario:test_run}": ["p(95)<2000"],
  "http_req_duration{scenario:cicd}": ["p(95)<3000"],
};

// ---------------------------------------------------------------------------
// Load Profiles
// ---------------------------------------------------------------------------
// Each profile defines VU ramp stages. Pick one via __ENV.PROFILE.

export const profiles = {
  // Quick smoke test — confirms scripts work
  smoke: {
    stages: [
      { duration: "30s", target: 5 },
      { duration: "1m", target: 5 },
      { duration: "30s", target: 0 },
    ],
  },

  // Baseline — find single-user response times with light load
  baseline: {
    stages: [
      { duration: "1m", target: 10 },
      { duration: "3m", target: 10 },
      { duration: "1m", target: 0 },
    ],
  },

  // Load — normal expected traffic
  load: {
    stages: [
      { duration: "2m", target: 50 },
      { duration: "5m", target: 50 },
      { duration: "2m", target: 100 },
      { duration: "5m", target: 100 },
      { duration: "2m", target: 0 },
    ],
  },

  // Stress — find the breaking point
  stress: {
    stages: [
      { duration: "2m", target: 50 },
      { duration: "3m", target: 100 },
      { duration: "3m", target: 200 },
      { duration: "3m", target: 300 },
      { duration: "3m", target: 500 },
      { duration: "2m", target: 0 },
    ],
  },

  // Soak — sustained load to find memory leaks / connection exhaustion
  soak: {
    stages: [
      { duration: "5m", target: 100 },
      { duration: "2h", target: 100 },
      { duration: "5m", target: 0 },
    ],
  },
};

/**
 * Returns the active profile based on the PROFILE env var.
 * Defaults to "smoke" if not set.
 */
export function getProfile() {
  const name = __ENV.PROFILE || "smoke";
  const profile = profiles[name];
  if (!profile) {
    throw new Error(
      `Unknown profile "${name}". Valid: ${Object.keys(profiles).join(", ")}`
    );
  }
  return profile;
}
