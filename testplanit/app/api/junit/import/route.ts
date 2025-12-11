/**
 * JUnit Import API Route (Deprecated)
 *
 * This endpoint is deprecated. Please use /api/test-results/import instead,
 * which supports JUnit and 6 other formats (TestNG, xUnit, NUnit, MSTest, Mocha, Cucumber).
 *
 * This route now forwards requests to the test-results/import endpoint with format=junit.
 */

import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // Clone the request and get the form data
  const formData = await request.formData();

  // Add format=junit to the form data
  formData.set("format", "junit");

  // Get the base URL from the request
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  // Forward to the test-results/import endpoint
  const response = await fetch(`${baseUrl}/api/test-results/import`, {
    method: "POST",
    headers: {
      // Forward authorization header if present
      ...(request.headers.get("authorization")
        ? { Authorization: request.headers.get("authorization")! }
        : {}),
      // Forward cookies for session auth
      ...(request.headers.get("cookie")
        ? { Cookie: request.headers.get("cookie")! }
        : {}),
    },
    body: formData,
  });

  // Add deprecation warning header
  const headers = new Headers(response.headers);
  headers.set(
    "X-Deprecation-Warning",
    "The /api/junit/import endpoint is deprecated. Please use /api/test-results/import with format=junit instead."
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
