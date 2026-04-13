/**
 * Test data generators for k6 load tests.
 *
 * Produces randomized but realistic data for creating test entities.
 * Uses k6's built-in randomization (no external deps).
 */

/**
 * Generate a unique identifier string.
 * k6 doesn't have crypto.randomUUID(), so we build one from Math.random + timestamp.
 */
export function uniqueId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Generate a test case name that looks realistic.
 */
export function testCaseName() {
  const prefixes = [
    "Verify",
    "Validate",
    "Check",
    "Ensure",
    "Confirm",
    "Test",
  ];
  const actions = [
    "user login",
    "password reset",
    "data export",
    "API response",
    "form submission",
    "navigation flow",
    "error handling",
    "permission check",
    "notification delivery",
    "search results",
    "pagination",
    "file upload",
    "session timeout",
    "concurrent access",
    "data integrity",
    "bulk import",
    "webhook trigger",
    "cache invalidation",
    "rate limiting",
    "rollback behavior",
  ];
  const conditions = [
    "with valid credentials",
    "with invalid input",
    "under high load",
    "after timeout",
    "with special characters",
    "in offline mode",
    "with large payload",
    "across browsers",
    "with 2FA enabled",
    "as read-only user",
  ];

  const prefix = pick(prefixes);
  const action = pick(actions);
  const condition = pick(conditions);
  return `${prefix} ${action} ${condition} [${uniqueId()}]`;
}

/**
 * Generate a folder name.
 */
export function folderName() {
  const modules = [
    "Authentication",
    "User Management",
    "Payments",
    "Notifications",
    "Search",
    "Dashboard",
    "Reports",
    "Settings",
    "API Gateway",
    "Data Pipeline",
    "Mobile App",
    "Web Portal",
    "Admin Console",
    "Integration Layer",
    "Compliance",
  ];
  return `${pick(modules)} - ${uniqueId()}`;
}

/**
 * Generate a project name.
 */
export function projectName() {
  const products = [
    "Core Banking",
    "Mobile Banking",
    "Payment Gateway",
    "Risk Engine",
    "Compliance Suite",
    "Customer Portal",
    "Internal Tools",
    "Data Platform",
    "API Services",
    "Identity Provider",
  ];
  return `${pick(products)} Tests [${uniqueId()}]`;
}

/**
 * Generate test case steps as a JSON-compatible array.
 */
export function testSteps(count) {
  const n = count || randomInt(3, 8);
  const steps = [];
  for (let i = 0; i < n; i++) {
    steps.push({
      order: i + 1,
      action: `Step ${i + 1}: ${pick(["Navigate to", "Click on", "Enter", "Verify", "Wait for", "Select"])} ${pick(["the button", "the input field", "the dropdown", "the modal", "the table row", "the link"])}`,
      expected: `Expected: ${pick(["Element is visible", "Value is updated", "Page loads", "Error message appears", "Data is saved", "Redirect occurs"])}`,
    });
  }
  return steps;
}

/**
 * Generate a JUnit XML string for CI/CD ingestion testing.
 */
export function junitXml(suiteCount, casesPerSuite) {
  const suites = suiteCount || randomInt(1, 5);
  const cases = casesPerSuite || randomInt(5, 20);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n';

  for (let s = 0; s < suites; s++) {
    const suiteName = `com.testplanit.loadtest.Suite${s}_${uniqueId()}`;
    let failures = 0;
    let caseXml = "";

    for (let c = 0; c < cases; c++) {
      const caseName = `test_${pick(["login", "logout", "create", "update", "delete", "search", "export", "import", "validate", "sync"])}_${c}`;
      const time = (Math.random() * 5).toFixed(3);

      // ~10% of cases fail
      if (Math.random() < 0.1) {
        failures++;
        caseXml += `    <testcase classname="${suiteName}" name="${caseName}" time="${time}">\n`;
        caseXml += `      <failure message="Assertion failed" type="AssertionError">Expected true but got false</failure>\n`;
        caseXml += `    </testcase>\n`;
      } else {
        caseXml += `    <testcase classname="${suiteName}" name="${caseName}" time="${time}" />\n`;
      }
    }

    xml += `  <testsuite name="${suiteName}" tests="${cases}" failures="${failures}" time="${(Math.random() * 30).toFixed(3)}">\n`;
    xml += caseXml;
    xml += `  </testsuite>\n`;
  }

  xml += "</testsuites>";
  return xml;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
