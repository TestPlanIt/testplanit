/**
 * Scenario 6: CI/CD JUnit Result Ingestion
 *
 * BBVA Use Case: "Seamless CI/CD integration and final automated
 * result ingestion."
 *
 * Simulates automated CI/CD pipelines uploading test results:
 * 1. Generate JUnit XML with realistic test suite data
 * 2. Upload via the test-results/import endpoint
 * 3. Verify the import completed
 *
 * This tests the system's ability to handle burst CI/CD traffic —
 * many pipelines completing around the same time (e.g., after a
 * deploy across multiple microservices).
 *
 * Run:
 *   k6 run --env BASE_URL=http://... --env API_TOKEN=tpi_... scenarios/06-cicd-ingestion.js
 */

import { sleep, check } from "k6";
import http from "k6/http";
import { findMany } from "../helpers/api.js";
import { junitXml, uniqueId } from "../helpers/data.js";
import {
  getProfile,
  thresholds,
  PROJECT_ID,
  BASE_URL,
  headers,
} from "../config.js";

const TAG = "cicd";

export const options = {
  ...getProfile(),
  thresholds,
};

export default function cicdIngestion() {
  // 1. Get a folder to place imported cases
  const folders = findMany(
    "repositoryFolders",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      select: { id: true },
      take: 5,
    },
    { scenarioTag: TAG }
  );

  const folderId =
    folders?.data?.length > 0
      ? folders.data[Math.floor(Math.random() * folders.data.length)].id
      : null;

  // 2. Generate JUnit XML — varies in size to simulate different projects
  //    Small pipeline: 1 suite, 10 cases
  //    Medium pipeline: 3 suites, 50 cases
  //    Large pipeline: 5 suites, 100 cases
  const sizes = [
    { suites: 1, cases: 10 },
    { suites: 3, cases: 15 },
    { suites: 5, cases: 20 },
  ];
  const size = sizes[Math.floor(Math.random() * sizes.length)];
  const xml = junitXml(size.suites, size.cases);

  // 3. Upload via multipart form
  const formData = {
    file: http.file(xml, `results-${uniqueId()}.xml`, "application/xml"),
    format: "junit",
    projectId: String(PROJECT_ID),
    name: `CI Run ${uniqueId()}`,
  };

  if (folderId) {
    formData.parentFolderId = String(folderId);
  }

  const res = http.post(`${BASE_URL}/api/test-results/import`, formData, {
    headers: {
      Authorization: headers.Authorization,
      // Don't set Content-Type — k6 sets multipart boundary automatically
    },
    tags: { scenario: TAG },
    timeout: "60s", // imports can take longer
  });

  check(res, {
    "import status 200": (r) => r.status === 200,
    "import not 500": (r) => r.status !== 500,
  });

  sleep(1);

  // 4. List recent test runs to verify import created one
  findMany(
    "testRuns",
    {
      where: { projectId: PROJECT_ID, isDeleted: false },
      select: { id: true, name: true, createdAt: true, testRunType: true },
      take: 5,
      orderBy: { createdAt: "desc" },
    },
    { scenarioTag: TAG }
  );

  sleep(randomThinkTime());
}

function randomThinkTime() {
  // CI/CD is automated — shorter intervals between pipeline completions
  return 0.5 + Math.random() * 2;
}
