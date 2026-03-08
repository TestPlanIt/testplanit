export const SAMPLE_CASE_BASE = {
  name: "User Login with Valid Credentials",
  id: 42,
  folder: "Authentication",
  state: "Ready",
  estimate: 15,
  automated: false,
  tags: "Smoke, Authentication",
  createdBy: "jane.doe@example.com",
  createdAt: "2025-01-15",
  steps: [
    {
      order: 1,
      step: "Navigate to the login page",
      expectedResult: "Login page is displayed with email and password fields",
    },
    {
      order: 2,
      step: "Enter valid email and password",
      expectedResult: "Credentials are entered in the form fields",
    },
    {
      order: 3,
      step: 'Click the "Login" button',
      expectedResult: "User is redirected to the dashboard",
    },
  ],
};

const DUMMY_VALUES: Record<string, string> = {
  Checkbox: "Yes",
  Date: "2025-03-15",
  Dropdown: "Option A",
  Integer: "5",
  Link: "https://example.com/reference",
  "Multi-Select": "Option A, Option B, Option C",
  Number: "2.5",
  Steps: "Sample step content",
  "Text String": "Sample text value",
  "Text Long": "This is a longer sample text description.",
};

const DUMMY_FALLBACK = "Sample value";

export function buildSampleFields(
  caseFields: Array<{ systemName: string; type?: { type: string } | null }> | undefined
): Record<string, string> {
  if (!caseFields || caseFields.length === 0) return {};
  const fields: Record<string, string> = {};
  for (const field of caseFields) {
    const fieldType = field.type?.type ?? "";
    fields[field.systemName] = DUMMY_VALUES[fieldType] ?? DUMMY_FALLBACK;
  }
  return fields;
}
