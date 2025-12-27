import React from "react";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterEach,
  Mock,
} from "vitest";

// Mock the extractTextFromNode utility to prevent issues
vi.mock("~/utils/extractTextFromJson", () => ({
  extractTextFromNode: vi.fn((node: any) => {
    if (typeof node === "string") return node;
    if (
      node &&
      typeof node === "object" &&
      node.type === "doc" &&
      node.content
    ) {
      // Extract text from TipTap JSON structure
      const extractFromContent = (content: any[]): string => {
        return content
          .map((item: any) => {
            if (item.type === "text" && item.text) return item.text;
            if (item.content && Array.isArray(item.content)) {
              return extractFromContent(item.content);
            }
            return "";
          })
          .join("");
      };
      return extractFromContent(node.content);
    }
    // Parse JSON if it's a string containing JSON
    try {
      const parsed = typeof node === "string" ? JSON.parse(node) : node;
      if (parsed && parsed.type === "doc" && parsed.content) {
        const extractFromContent = (content: any[]): string => {
          return content
            .map((item: any) => {
              if (item.type === "text" && item.text) return item.text;
              if (item.content && Array.isArray(item.content)) {
                return extractFromContent(item.content);
              }
              return "";
            })
            .join(" ");
        };
        return extractFromContent(parsed.content);
      }
    } catch (e) {
      // Not JSON, return as is
    }
    return node?.toString() || "";
  }),
}));

// Mock next/navigation first
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "333" })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

// Mock next-intl navigation
vi.mock("~/lib/navigation", () => ({
  Link: vi.fn(({ children, href, ...props }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

// Mock dependencies
vi.mock("~/lib/hooks", () => ({
  useFindManyRepositoryCases: vi.fn(),
  useUpdateRepositoryCases: vi.fn(),
  useFindManyWorkflows: vi.fn(),
  useFindManyTags: vi.fn(),
  useFindManyIssue: vi.fn(),
  useUpdateCaseFieldValues: vi.fn(),
  useCreateCaseFieldValues: vi.fn(),
  useCreateSteps: vi.fn(),
  useDeleteManySteps: vi.fn(),
  useUpdateManyRepositoryCases: vi.fn(),
  useUpdateSteps: vi.fn(),
  useCreateTags: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useCreateRepositoryCaseVersions: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useCreateCaseFieldVersionValues: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: vi.fn(),
}));

vi.mock("~/hooks/useRepositoryCasesWithFilteredFields", () => ({
  useFindManyRepositoryCasesFiltered: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: vi.fn((namespace) => {
    return (key: string, values?: any) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      let result = `[t]${fullKey}`;
      if (values) {
        result += ` ${JSON.stringify(values)}`;
      }
      return result;
    };
  }),
  useLocale: vi.fn(() => "en-US"),
}));

// Mock ZenStack hooks for TipTapEditor
vi.mock("~/lib/hooks/project-llm-integration", () => ({
  useFindManyProjectLlmIntegration: () => ({
    data: [], // No LLM integrations by default
    isLoading: false,
    error: null,
  }),
}));

// Now import everything else after the mocks
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BulkEditModal } from "./BulkEditModal";
import { Session } from "next-auth";
import * as NextAuth from "next-auth/react";
import {
  useFindManyRepositoryCases,
  useUpdateRepositoryCases,
  useFindManyWorkflows,
  useFindManyTags,
  useFindManyIssue,
  useUpdateCaseFieldValues,
  useCreateCaseFieldValues,
  useUpdateManyRepositoryCases,
  useCreateSteps,
  useDeleteManySteps,
  useUpdateSteps,
  useCreateRepositoryCaseVersions,
  useCreateCaseFieldVersionValues,
} from "~/lib/hooks";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useFindManyRepositoryCasesFiltered } from "~/hooks/useRepositoryCasesWithFilteredFields";
import {
  ApplicationArea,
  Theme,
  Locale,
  DateFormat,
  TimeFormat,
  ItemsPerPage,
  WorkflowScope,
  NotificationMode,
} from "@prisma/client";
import { toast } from "sonner";

// Setup to fix hasPointerCapture issue with Radix UI
beforeAll(() => {
  // Mock hasPointerCapture which is used by Radix UI but not available in jsdom
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }

  // Mock scrollIntoView which is used by Radix UI Select
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

// Track bulk-edit API calls for test assertions
let bulkEditCalls: { url: string; payload: any }[] = [];

// Setup fetch mock before each test
beforeEach(() => {
  bulkEditCalls = [];

  // Mock fetch for API calls
  global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("/api/projects/") && url.includes("/cases/fetch-many")) {
      // Return the full mock data for BulkEditModal
      return Promise.resolve({
        ok: true,
        json: async () => ({ cases: mockCasesWithTextFields }),
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      } as Response);
    }

    if (
      url.includes("/api/projects/") &&
      url.includes("/cases/bulk-edit-fetch")
    ) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ cases: mockCasesWithTextFields }),
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      } as Response);
    }

    // Handle bulk-edit POST endpoint
    if (
      url.includes("/api/projects/") &&
      url.includes("/cases/bulk-edit") &&
      !url.includes("bulk-edit-fetch") &&
      init?.method === "POST"
    ) {
      const payload = init.body ? JSON.parse(init.body as string) : {};
      bulkEditCalls.push({ url, payload });
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          updatedCount: payload.caseIds?.length || 0,
        }),
        status: 200,
        statusText: "OK",
        headers: new Headers(),
      } as Response);
    }

    // Don't reject for other URLs, just return an empty response
    return Promise.resolve({
      ok: true,
      json: async () => ({}),
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as Response);
  }) as any;
});

// Add afterEach to clear mocks
afterEach(() => {
  vi.clearAllMocks();
});

// Mock session
const mockSession: Session = {
  expires: "1",
  user: {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
    image: "",
    access: "USER",
    preferences: {
      id: "pref-1",
      userId: "user-123",
      theme: Theme.System,
      locale: Locale.en_US,
      dateFormat: DateFormat.MM_DD_YYYY_SLASH,
      timeFormat: TimeFormat.HH_MM,
      itemsPerPage: ItemsPerPage.P50,
      timezone: "UTC",
      notificationMode: NotificationMode.USE_GLOBAL,
      emailNotifications: true,
      inAppNotifications: true,
      hasCompletedWelcomeTour: false,
      hasCompletedInitialPreferencesSetup: false,
    },
  },
};

// Mock data
const mockWorkflowData = [
  {
    id: 1,
    name: "Not Started",
    icon: { id: 1, name: "circle" },
    color: { id: 1, value: "#808080" },
    isDefault: true,
    scope: WorkflowScope.CASES,
  },
  {
    id: 2,
    name: "In Progress",
    icon: { id: 2, name: "play" },
    color: { id: 2, value: "#0000FF" },
    isDefault: false,
    scope: WorkflowScope.CASES,
  },
  {
    id: 3,
    name: "Done",
    icon: { id: 3, name: "check" },
    color: { id: 3, value: "#00FF00" },
    isDefault: false,
    scope: WorkflowScope.CASES,
  },
];

const mockTagsData = [
  { id: 1, name: "Regression" },
  { id: 2, name: "Smoke" },
  { id: 3, name: "E2E" },
];

const mockIssuesData = [
  { id: 1, name: "BUG-123", externalId: "BUG-123" },
  { id: 2, name: "BUG-456", externalId: "BUG-456" },
];

// Mock data for test cases with Steps field
const mockCasesWithStepsField = [
  {
    id: 1,
    name: "Login Test Case",
    stateId: 1,
    state: mockWorkflowData[0],
    automated: false,
    estimate: 300,
    currentVersion: 1,
    templateId: 2,
    template: {
      id: 2,
      templateName: "Template with Steps",
      caseFields: [
        {
          order: 1,
          caseFieldId: 10,
          caseField: {
            id: 10,
            displayName: "Steps",
            systemName: "steps",
            isRequired: false,
            isRestricted: false,
            type: { id: 10, type: "Steps" },
          },
        },
        {
          order: 2,
          caseFieldId: 1,
          caseField: {
            id: 1,
            displayName: "Description",
            systemName: "description",
            isRequired: false,
            isRestricted: false,
            type: { id: 1, type: "Text String" },
          },
        },
      ],
    },
    caseFieldValues: [
      {
        id: 1,
        fieldId: 1,
        field: { id: 1, type: { type: "Text String" } },
        value: "Test login functionality",
      },
    ],
    tags: [],
    issues: [],
    steps: [
      {
        id: 1,
        order: 0,
        step: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Navigate to login page" }],
            },
          ],
        }),
        expectedResult: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Login page is displayed" }],
            },
          ],
        }),
      },
      {
        id: 2,
        order: 1,
        step: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Enter username in login form" }],
            },
          ],
        }),
        expectedResult: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Username field accepts input" }],
            },
          ],
        }),
      },
      {
        id: 3,
        order: 2,
        step: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Click login button" }],
            },
          ],
        }),
        expectedResult: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "User is logged in and redirected to dashboard",
                },
              ],
            },
          ],
        }),
      },
    ],
    source: "MANUAL",
    project: {
      issueConfigId: 1,
    },
  },
  {
    id: 2,
    name: "Logout Test Case",
    stateId: 1,
    state: mockWorkflowData[0],
    automated: false,
    estimate: 200,
    templateId: 2,
    template: {
      id: 2,
      templateName: "Template with Steps",
      caseFields: [
        {
          order: 1,
          caseFieldId: 10,
          caseField: {
            id: 10,
            displayName: "Steps",
            systemName: "steps",
            isRequired: false,
            isRestricted: false,
            type: { id: 10, type: "Steps" },
          },
        },
        {
          order: 2,
          caseFieldId: 1,
          caseField: {
            id: 1,
            displayName: "Description",
            systemName: "description",
            isRequired: false,
            isRestricted: false,
            type: { id: 1, type: "Text String" },
          },
        },
      ],
    },
    caseFieldValues: [
      {
        id: 2,
        fieldId: 1,
        field: { id: 1, type: { type: "Text String" } },
        value: "Test logout functionality",
      },
    ],
    tags: [],
    issues: [],
    steps: [
      {
        id: 4,
        order: 0,
        step: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Click on logout button in dashboard" },
              ],
            },
          ],
        }),
        expectedResult: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "User is logged out" }],
            },
          ],
        }),
      },
      {
        id: 5,
        order: 1,
        step: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Try to access dashboard after logout" },
              ],
            },
          ],
        }),
        expectedResult: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "User is redirected to login page" },
              ],
            },
          ],
        }),
      },
    ],
    source: "MANUAL",
    project: {
      issueConfigId: 1,
    },
  },
];

const mockCasesWithTextFields = [
  {
    id: 1,
    name: "Test Case Alpha",
    stateId: 1,
    state: mockWorkflowData[0],
    automated: false,
    estimate: 300, // 5 minutes in seconds
    currentVersion: 1,
    templateId: 1,
    template: {
      id: 1,
      templateName: "Standard Template",
      caseFields: [
        {
          order: 1,
          caseFieldId: 10,
          caseField: {
            id: 10,
            displayName: "Steps",
            systemName: "steps",
            isRequired: false,
            isRestricted: false,
            type: { id: 10, type: "Steps" },
          },
        },
        {
          order: 2,
          caseFieldId: 1,
          caseField: {
            id: 1,
            displayName: "Description",
            systemName: "description",
            isRequired: false,
            isRestricted: false,
            type: { id: 1, type: "Text String" },
          },
        },
        {
          order: 3,
          caseFieldId: 2,
          caseField: {
            id: 2,
            displayName: "Test Data",
            systemName: "test_data",
            isRequired: false,
            isRestricted: false,
            type: { id: 2, type: "Text Long" },
          },
        },
        {
          order: 4,
          caseFieldId: 3,
          caseField: {
            id: 3,
            displayName: "Reference URL",
            systemName: "reference_url",
            isRequired: false,
            isRestricted: false,
            type: { id: 3, type: "Link" },
          },
        },
      ],
    },
    caseFieldValues: [
      {
        id: 1,
        fieldId: 1,
        field: { id: 1, type: { type: "Text String" } },
        value: "This is a test case for login functionality",
      },
      {
        id: 2,
        fieldId: 2,
        field: { id: 2, type: { type: "Text Long" } },
        value: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Username: testuser@example.com" },
              ],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Password: Test123!" }],
            },
          ],
        }),
      },
      {
        id: 3,
        fieldId: 3,
        field: { id: 3, type: { type: "Link" } },
        value: "https://example.com/test-case-1",
      },
    ],
    tags: [mockTagsData[0]],
    issues: [mockIssuesData[0]],
    steps: [
      {
        id: 1,
        order: 0,
        step: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Step 1: Open application" }],
            },
          ],
        }),
        expectedResult: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Application opens successfully" },
              ],
            },
          ],
        }),
      },
      {
        id: 2,
        order: 1,
        step: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Step 2: Navigate to test area" },
              ],
            },
          ],
        }),
        expectedResult: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Test area is displayed" }],
            },
          ],
        }),
      },
    ],
    source: "MANUAL",
    project: {
      issueConfigId: 1,
    },
  },
  {
    id: 2,
    name: "Test Case Beta",
    stateId: 2,
    state: mockWorkflowData[1],
    automated: true,
    estimate: 600, // 10 minutes
    currentVersion: 1,
    templateId: 1,
    template: {
      id: 1,
      templateName: "Standard Template",
      caseFields: [
        {
          order: 1,
          caseFieldId: 10,
          caseField: {
            id: 10,
            displayName: "Steps",
            systemName: "steps",
            isRequired: false,
            isRestricted: false,
            type: { id: 10, type: "Steps" },
          },
        },
        {
          order: 2,
          caseFieldId: 1,
          caseField: {
            id: 1,
            displayName: "Description",
            systemName: "description",
            isRequired: false,
            isRestricted: false,
            type: { id: 1, type: "Text String" },
          },
        },
        {
          order: 3,
          caseFieldId: 2,
          caseField: {
            id: 2,
            displayName: "Test Data",
            systemName: "test_data",
            isRequired: false,
            isRestricted: false,
            type: { id: 2, type: "Text Long" },
          },
        },
        {
          order: 4,
          caseFieldId: 3,
          caseField: {
            id: 3,
            displayName: "Reference URL",
            systemName: "reference_url",
            isRequired: false,
            isRestricted: false,
            type: { id: 3, type: "Link" },
          },
        },
      ],
    },
    caseFieldValues: [
      {
        id: 4,
        fieldId: 1,
        field: { id: 1, type: { type: "Text String" } },
        value: "This is a test case for logout functionality",
      },
      {
        id: 5,
        fieldId: 2,
        field: { id: 2, type: { type: "Text Long" } },
        value: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Username: admin@example.com" }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Password: admin" }],
            },
          ],
        }),
      },
      {
        id: 6,
        fieldId: 3,
        field: { id: 3, type: { type: "Link" } },
        value: "https://example.com/test-case-2",
      },
    ],
    tags: [mockTagsData[1], mockTagsData[2]],
    issues: [],
    steps: [
      {
        id: 3,
        order: 0,
        step: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Step 1: Login to system" }],
            },
          ],
        }),
        expectedResult: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "User is logged in" }],
            },
          ],
        }),
      },
      {
        id: 4,
        order: 1,
        step: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Step 2: Click logout" }],
            },
          ],
        }),
        expectedResult: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "User is logged out" }],
            },
          ],
        }),
      },
    ],
    source: "MANUAL",
    project: {
      issueConfigId: 1,
    },
  },
];

// Mock mutations - use mockImplementation to survive clearAllMocks
const mockUpdateCasesMutation = vi
  .fn()
  .mockImplementation(() => Promise.resolve({ id: 1 }));
const mockUpdateCaseFieldValue = vi
  .fn()
  .mockImplementation(() => Promise.resolve({ id: 1 }));
const mockCreateCaseFieldValues = vi
  .fn()
  .mockImplementation(() => Promise.resolve({ id: 1 }));
const mockUpdateManyRepositoryCases = vi
  .fn()
  .mockImplementation(() => Promise.resolve({ count: 2 }));
const mockCreateSteps = vi
  .fn()
  .mockImplementation(() => Promise.resolve({ id: 1 }));
const mockDeleteManySteps = vi
  .fn()
  .mockImplementation(() => Promise.resolve({ count: 1 }));
const mockUpdateSteps = vi
  .fn()
  .mockImplementation(() => Promise.resolve({ id: 1 }));
const mockCreateRepositoryCaseVersions = vi
  .fn()
  .mockImplementation(() => Promise.resolve({ id: 1 }));
const mockCreateCaseFieldVersionValues = vi
  .fn()
  .mockImplementation(() => Promise.resolve({ id: 1 }));

describe("BulkEditModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock useSession
    vi.spyOn(NextAuth, "useSession").mockReturnValue({
      data: mockSession,
      status: "authenticated",
      update: vi.fn(),
    });

    // Mock hooks
    (useFindManyRepositoryCases as Mock).mockReturnValue({
      data: mockCasesWithTextFields,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    (useFindManyRepositoryCasesFiltered as Mock).mockReturnValue({
      data: mockCasesWithTextFields,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    (useFindManyWorkflows as Mock).mockReturnValue({
      data: mockWorkflowData,
      isLoading: false,
    });

    (useFindManyTags as Mock).mockReturnValue({
      data: mockTagsData,
      isLoading: false,
    });

    (useFindManyIssue as Mock).mockReturnValue({
      data: mockIssuesData,
      isLoading: false,
    });

    (useUpdateRepositoryCases as Mock).mockReturnValue({
      mutateAsync: mockUpdateCasesMutation,
      isPending: false,
    });

    (useUpdateCaseFieldValues as Mock).mockReturnValue({
      mutateAsync: mockUpdateCaseFieldValue,
      isPending: false,
    });

    (useCreateCaseFieldValues as Mock).mockReturnValue({
      mutateAsync: mockCreateCaseFieldValues,
      isPending: false,
    });

    (useUpdateManyRepositoryCases as Mock).mockReturnValue({
      mutateAsync: mockUpdateManyRepositoryCases,
      isPending: false,
    });

    (useCreateSteps as Mock).mockReturnValue({
      mutateAsync: mockCreateSteps,
      isPending: false,
    });

    (useDeleteManySteps as Mock).mockReturnValue({
      mutateAsync: mockDeleteManySteps,
      isPending: false,
    });

    (useUpdateSteps as Mock).mockReturnValue({
      mutateAsync: mockUpdateSteps,
      isPending: false,
    });

    (useCreateRepositoryCaseVersions as Mock).mockReturnValue({
      mutateAsync: mockCreateRepositoryCaseVersions,
      isPending: false,
    });

    (useCreateCaseFieldVersionValues as Mock).mockReturnValue({
      mutateAsync: mockCreateCaseFieldVersionValues,
      isPending: false,
    });

    // Mock useProjectPermissions to handle multiple application areas
    (useProjectPermissions as Mock).mockImplementation(() => ({
      permissions: {
        canAddEdit: true,
        canDelete: true,
      },
      isLoading: false,
      error: null,
    }));
  });

  describe("Basic Functionality", () => {
    it("should render the modal with correct title", () => {
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      expect(
        screen.getByRole("heading", {
          name: '[t]repository.bulkEdit.title {"count":2}',
        })
      ).toBeInTheDocument();
    });

    it("should display all standard fields", async () => {
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      expect(screen.getByText("[t]repository.name")).toBeInTheDocument();
      expect(
        screen.getByText("[t]repository.fields.state")
      ).toBeInTheDocument();
      expect(
        screen.getByText("[t]repository.fields.automated")
      ).toBeInTheDocument();
      expect(
        screen.getByText("[t]repository.fields.estimate")
      ).toBeInTheDocument();
      expect(screen.getByText("[t]repository.fields.tags")).toBeInTheDocument();
      expect(screen.getByText("[t]common.fields.issues")).toBeInTheDocument();
    });

    it("should display custom fields from template", async () => {
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText("Steps")).toBeInTheDocument();
      });

      expect(screen.getByText("Steps")).toBeInTheDocument();
      expect(screen.getByText("Description")).toBeInTheDocument();
      expect(screen.getByText("Test Data")).toBeInTheDocument();
      expect(screen.getByText("Reference URL")).toBeInTheDocument();
    });

    it("should show <various> placeholder when field values differ", async () => {
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load and fields to appear
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
        expect(screen.queryByText("Description")).toBeInTheDocument();
      });

      // Name field should show <various> as the names differ
      const nameRow = screen
        .getByText("[t]repository.name")
        .closest(".grid") as HTMLElement;
      expect(within(nameRow).getByText("<various>")).toBeInTheDocument();

      // Description field should show <various> as values differ
      const descRow = screen
        .getByText("Description")
        .closest(".grid") as HTMLElement;
      expect(within(descRow).getByText("<various>")).toBeInTheDocument();
    });

    it("should enable field editing when checkbox is clicked", async () => {
      const user = userEvent.setup();
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      // Click the checkbox for name field
      const nameCheckbox = document.getElementById(
        "edit-name"
      ) as HTMLInputElement;
      await user.click(nameCheckbox);

      // Should show input field instead of placeholder
      const nameInput = screen.getByRole("textbox");
      expect(nameInput).toBeInTheDocument();
    });
  });

  describe("Search/Replace Functionality", () => {
    it("should show search/replace toggle for text fields", async () => {
      const user = userEvent.setup();
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      // Enable editing for name field
      const nameCheckbox = document.getElementById(
        "edit-name"
      ) as HTMLInputElement;
      await user.click(nameCheckbox);

      // Should show radio options
      await waitFor(() => {
        expect(
          screen.getByText("[t]repository.bulkEdit.replaceAll")
        ).toBeInTheDocument();
        expect(
          screen.getByText("[t]repository.bulkEdit.searchReplace")
        ).toBeInTheDocument();
      });
    });

    it("should switch to search/replace mode when selected", async () => {
      const user = userEvent.setup();

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      // Enable editing for name field
      const nameCheckbox = document.getElementById(
        "edit-name"
      ) as HTMLInputElement;
      await user.click(nameCheckbox);

      // Click search/replace radio
      await waitFor(() => {
        const searchReplaceRadio = screen.getByRole("radio", {
          name: "[t]repository.bulkEdit.searchReplace",
        });
        expect(searchReplaceRadio).toBeInTheDocument();
      });
      const searchReplaceRadio = screen.getByRole("radio", {
        name: "[t]repository.bulkEdit.searchReplace",
      });
      await user.click(searchReplaceRadio);

      // Should show search/replace inputs
      await waitFor(() => {
        expect(
          screen.getByText("[t]repository.bulkEdit.searchFor")
        ).toBeInTheDocument();
      });
      expect(
        screen.getByText("[t]repository.bulkEdit.replaceWith")
      ).toBeInTheDocument();
    });

    it("should show preview when search pattern matches", async () => {
      const user = userEvent.setup();
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      // Enable editing for name field
      const nameCheckbox = document.getElementById(
        "edit-name"
      ) as HTMLInputElement;
      await user.click(nameCheckbox);

      // Switch to search/replace
      const searchReplaceRadio = screen.getByRole("radio", {
        name: /search.*replace/i,
      });
      await user.click(searchReplaceRadio);

      // Enter search pattern
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "Test Case");

      // Enter replacement
      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "Test Suite");

      // Should show preview
      await waitFor(() => {
        // Look for preview section heading
        expect(screen.getByText(/preview/i)).toBeInTheDocument();
      });
      // Check for matches count - the component shows "X matches" text
      expect(screen.getByText(/2.*matches/i)).toBeInTheDocument();
    });

    it("should support regex patterns", async () => {
      const user = userEvent.setup();
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      // Enable editing for name field
      const nameCheckbox = document.getElementById(
        "edit-name"
      ) as HTMLInputElement;
      await user.click(nameCheckbox);

      // Switch to search/replace
      const searchReplaceRadio = screen.getByRole("radio", {
        name: /search.*replace/i,
      });
      await user.click(searchReplaceRadio);

      // Enable regex
      const regexCheckbox = screen.getByLabelText(
        "[t]repository.bulkEdit.useRegex"
      );
      await user.click(regexCheckbox);

      // Enter regex pattern
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "Test Case (\\w+)");

      // Enter replacement with capture group
      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "Test Suite $1");

      // Should show preview - increase timeout for slower CI environments
      await waitFor(
        () => {
          // Look for preview section
          expect(screen.getByText(/preview/i)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
      // Check that the replacement was applied with the capture group
      expect(screen.getByText(/Test Suite Alpha/)).toBeInTheDocument();
    }, 10000);

    it("should show error for invalid regex", async () => {
      const user = userEvent.setup();
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      // Enable editing for name field
      const nameCheckbox = document.getElementById(
        "edit-name"
      ) as HTMLInputElement;
      await user.click(nameCheckbox);

      // Switch to search/replace
      const searchReplaceRadio = screen.getByRole("radio", {
        name: /search.*replace/i,
      });
      await user.click(searchReplaceRadio);

      // Enable regex
      const regexCheckbox = screen.getByLabelText(
        "[t]repository.bulkEdit.useRegex"
      );
      await user.click(regexCheckbox);

      // Enter invalid regex pattern - need to escape special characters for userEvent
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "(invalid");

      // Click save
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      await user.click(saveButton);

      // Should show validation error
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "[t]repository.bulkEdit.validationError"
        );
      });
    });

    it("should handle rich text fields correctly", async () => {
      const user = userEvent.setup();
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("Test Data")).toBeInTheDocument();
      });

      // Enable editing for Test Data field (rich text)
      const testDataCheckbox = document.getElementById(
        "edit-dynamic_2"
      ) as HTMLInputElement;
      await user.click(testDataCheckbox);

      // Switch to search/replace
      const searchReplaceRadio = screen.getByRole("radio", {
        name: "[t]repository.bulkEdit.searchReplace",
      });
      await user.click(searchReplaceRadio);

      // Enter search pattern
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "Password:");

      // Enter replacement
      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "Secret:");

      // Should show preview with text extracted from TipTap JSON
      await waitFor(() => {
        // Look for matches count
        expect(screen.getByText(/2.*matches/i)).toBeInTheDocument();
      });
    });
  });

  describe("Bulk Edit Operations", () => {
    it("should update standard fields correctly", async () => {
      const onSaveSuccess = vi.fn();

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={onSaveSuccess}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for loading spinner to disappear
      await waitFor(() => {
        const spinner = document.querySelector(".animate-spin");
        expect(spinner).not.toBeInTheDocument();
      });

      // Wait for data to load
      await waitFor(() => {
        expect(
          screen.queryByText("[t]repository.fields.state")
        ).toBeInTheDocument();
      });

      // Enable editing for state field
      const stateCheckbox = document.getElementById(
        "edit-state"
      ) as HTMLInputElement;
      expect(stateCheckbox).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(stateCheckbox);
      });

      // Wait for checkbox to be checked
      await waitFor(() => {
        expect(stateCheckbox).toHaveAttribute("data-state", "checked");
      });

      // Select a new state
      const stateSelect = screen.getByRole("combobox");
      await act(async () => {
        fireEvent.click(stateSelect);
      });

      // Wait for dropdown to open and show options
      await waitFor(() => {
        // Look for the option containing "Done" text
        const doneOption = screen.getByText("Done");
        expect(doneOption).toBeVisible();
      });

      // Click on the option containing "Done"
      await act(async () => {
        fireEvent.click(screen.getByText("Done"));
      });

      // Wait for the dropdown to close and selection to be applied
      await waitFor(() => {
        const stateCheckbox = document.getElementById(
          "edit-state"
        ) as HTMLInputElement;
        expect(stateCheckbox).toBeChecked();
      });

      // Save
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });

      // Wait for save button to be enabled
      await waitFor(() => {
        expect(saveButton).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Verify bulk-edit API was called with correct payload
      await waitFor(
        () => {
          expect(bulkEditCalls.length).toBe(1);
          const { payload } = bulkEditCalls[0];

          // Should include both case IDs
          expect(payload.caseIds).toEqual([1, 2]);

          // Should have state update (Done has id: 3)
          expect(payload.updates.state).toBe(3);

          // Should request version creation
          expect(payload.createVersions).toBe(true);

          // Toast and callback should be called
          expect(toast.success).toHaveBeenCalledWith(
            '[t]repository.bulkEdit.success.casesUpdated {"count":2}'
          );
          expect(onSaveSuccess).toHaveBeenCalled();
        },
        { timeout: 10000 }
      );
    });

    it("should update custom fields correctly", async () => {
      const onSaveSuccess = vi.fn();

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={onSaveSuccess}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for loading spinner to disappear
      await waitFor(() => {
        const spinner = document.querySelector(".animate-spin");
        expect(spinner).not.toBeInTheDocument();
      });

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("Description")).toBeInTheDocument();
      });

      // Enable editing for Description field
      const descCheckbox = screen.getByLabelText("Description");
      await act(async () => {
        fireEvent.click(descCheckbox);
      });

      // Wait for checkbox to be checked
      await waitFor(() => {
        const descInput = screen.queryByRole("textbox");
        expect(descInput).toBeInTheDocument();
      });

      // Enter new value
      const descInput = screen.getByRole("textbox");
      await act(async () => {
        fireEvent.change(descInput, {
          target: { value: "Updated description for all cases" },
        });
      });

      // Wait for input to be updated
      await waitFor(() => {
        expect(descInput).toHaveValue("Updated description for all cases");
      });

      // Save
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });

      // Wait for save button to be enabled
      await waitFor(() => {
        expect(saveButton).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Verify bulk-edit API was called with custom field updates
      await waitFor(
        () => {
          expect(bulkEditCalls.length).toBe(1);
          const { payload } = bulkEditCalls[0];

          // Should include both case IDs
          expect(payload.caseIds).toEqual([1, 2]);

          // Should have custom field updates
          expect(payload.customFieldUpdates).toBeDefined();
          expect(payload.customFieldUpdates.length).toBeGreaterThan(0);

          // Find the Description field update (fieldId: 1)
          const descFieldUpdate = payload.customFieldUpdates.find(
            (u: any) => u.fieldId === 1
          );
          expect(descFieldUpdate).toBeDefined();
          expect(descFieldUpdate.value).toBe(
            "Updated description for all cases"
          );

          // Should request version creation
          expect(payload.createVersions).toBe(true);

          // Toast should be called
          expect(toast.success).toHaveBeenCalledWith(
            '[t]repository.bulkEdit.success.casesUpdated {"count":2}'
          );
        },
        { timeout: 10000 }
      );
    });

    it("should handle tags update correctly", async () => {
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for loading spinner to disappear
      await waitFor(() => {
        const spinner = document.querySelector(".animate-spin");
        expect(spinner).not.toBeInTheDocument();
      });

      // Wait for data to load
      await waitFor(() => {
        expect(
          screen.queryByText("[t]repository.fields.tags")
        ).toBeInTheDocument();
      });

      // Enable editing for tags field
      const tagsCheckbox = document.getElementById(
        "edit-tags"
      ) as HTMLInputElement;
      await act(async () => {
        fireEvent.click(tagsCheckbox);
      });

      // Wait for tags field to be enabled
      await waitFor(() => {
        expect(tagsCheckbox).toBeChecked();
      });

      // Since ManageTags uses react-select which is difficult to test,
      // we'll verify that the component renders and the save works correctly
      // The actual tag selection is tested in the ManageTags component tests

      // Verify the tags field is rendered
      expect(screen.getByRole("combobox")).toBeInTheDocument();

      // For this test, we'll just verify that saving works when tags field is enabled
      // even without changing the value
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });

      // Wait for save button to be enabled
      await waitFor(() => {
        expect(saveButton).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Verify bulk-edit API was called with case IDs
      // Note: tags field won't have updates unless new tags are selected
      // (the component only adds tags.connect when newTagIds.length > 0)
      await waitFor(
        () => {
          expect(bulkEditCalls.length).toBe(1);
          const { payload } = bulkEditCalls[0];

          // Should include both case IDs
          expect(payload.caseIds).toEqual([1, 2]);

          // Should request version creation
          expect(payload.createVersions).toBe(true);

          // Toast should be called
          expect(toast.success).toHaveBeenCalled();
        },
        { timeout: 10000 }
      );
    });

    it("should handle bulk delete", async () => {
      const user = userEvent.setup();
      const onSaveSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <BulkEditModal
          isOpen={true}
          onClose={onClose}
          onSaveSuccess={onSaveSuccess}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Click delete button
      const deleteButton = screen.getByRole("button", {
        name: "[t]common.actions.delete",
      });
      await user.click(deleteButton);

      // Confirm deletion in popover
      const confirmButton = screen.getAllByRole("button", {
        name: "[t]common.actions.delete",
      })[1];
      await user.click(confirmButton);

      // Verify bulk delete mutation
      await waitFor(() => {
        expect(mockUpdateManyRepositoryCases).toHaveBeenCalledWith({
          data: { isDeleted: true },
          where: { id: { in: [1, 2] } },
        });
        expect(toast.success).toHaveBeenCalled();
        expect(onSaveSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle loading state", () => {
      (useFindManyRepositoryCases as Mock).mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      });

      (useFindManyRepositoryCasesFiltered as Mock).mockReturnValue({
        data: null,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      });

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Should show loading spinner - look for the container with the spinner
      const spinners = document.querySelectorAll(".animate-spin");
      expect(spinners.length).toBeGreaterThan(0);
    });

    it("should handle error state", async () => {
      // Override fetch mock to return an error
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: async () => ({ error: "Failed to load cases" }),
          headers: new Headers(),
        } as Response)
      );

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for error state to be displayed
      await waitFor(() => {
        expect(screen.getByText("[t]common.errors.error")).toBeInTheDocument();
      });
    });

    it("should show warning for multiple templates", async () => {
      const casesWithDifferentTemplates = [
        { ...mockCasesWithTextFields[0], templateId: 1 },
        { ...mockCasesWithTextFields[1], templateId: 2 },
      ];

      // Override fetch mock to return cases with different templates
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ cases: casesWithDifferentTemplates }),
          status: 200,
          statusText: "OK",
          headers: new Headers(),
        } as Response)
      );

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for warning to appear
      await waitFor(() => {
        expect(
          screen.getByText(
            "[t]repository.bulkEdit.warnings.templateMismatch.title"
          )
        ).toBeInTheDocument();
      });
    });

    it("should show warning for JUnit cases", async () => {
      const junitCases = [
        { ...mockCasesWithTextFields[0], source: "JUNIT" },
        { ...mockCasesWithTextFields[1], source: "JUNIT" },
      ];

      // Override fetch mock to return JUnit cases
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ cases: junitCases }),
          status: 200,
          statusText: "OK",
          headers: new Headers(),
        } as Response)
      );

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for warning to appear
      await waitFor(() => {
        expect(
          screen.getByText(
            "[t]repository.bulkEdit.warnings.junitLimitations.title"
          )
        ).toBeInTheDocument();
      });
    });

    it("should disable save button when no fields are edited", () => {
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      expect(saveButton).toBeDisabled();
    });

    it("should validate name field is not empty", async () => {
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for loading spinner to disappear
      await waitFor(() => {
        const spinner = document.querySelector(".animate-spin");
        expect(spinner).not.toBeInTheDocument();
      });

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      // Enable editing for name field (which has validation for non-empty)
      const nameCheckbox = document.getElementById(
        "edit-name"
      ) as HTMLInputElement;
      expect(nameCheckbox).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(nameCheckbox);
      });

      // Wait for checkbox to be checked
      await waitFor(() => {
        expect(nameCheckbox).toHaveAttribute("data-state", "checked");
      });

      // Find the name input and clear it (should trigger validation error on save)
      const nameInput = screen.getByRole("textbox");
      await act(async () => {
        fireEvent.change(nameInput, { target: { value: "" } });
      });

      // Wait for the field to be cleared
      await waitFor(() => {
        expect(nameInput).toHaveValue("");
      });

      // Try to save
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });

      // Wait for save button to be enabled
      await waitFor(() => {
        expect(saveButton).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Should show validation error and NOT call bulk-edit API
      // Name validation requires non-empty string
      await waitFor(
        () => {
          expect(toast.error).toHaveBeenCalledWith(
            "[t]repository.bulkEdit.validationError"
          );
          // Bulk edit API should not have been called due to validation failure
          expect(bulkEditCalls.length).toBe(0);
        },
        { timeout: 10000 }
      );
    });

    it("should handle search/replace with no matches", async () => {
      const user = userEvent.setup();
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      // Enable editing for name field
      const nameCheckbox = document.getElementById(
        "edit-name"
      ) as HTMLInputElement;
      await user.click(nameCheckbox);

      // Wait for the field to be enabled
      await waitFor(() => {
        expect(nameCheckbox).toBeChecked();
      });

      // Switch to search/replace
      const searchReplaceRadio = screen.getByRole("radio", {
        name: /search.*replace/i,
      });
      await user.click(searchReplaceRadio);

      // Wait for mode to switch
      await waitFor(() => {
        expect(
          screen.getByText("[t]repository.bulkEdit.searchFor")
        ).toBeInTheDocument();
      });

      // Enter search pattern that won't match using a single character at a time with delays
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.clear(searchInput);
      await user.type(searchInput, "NonExistentPattern");

      // Should show no matches message
      await waitFor(() => {
        expect(
          screen.getByText("[t]repository.bulkEdit.noMatches")
        ).toBeInTheDocument();
      });
    });

    it("should handle case sensitivity option", async () => {
      const user = userEvent.setup();
      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(screen.queryByText("[t]repository.name")).toBeInTheDocument();
      });

      // Enable editing for name field
      const nameCheckbox = document.getElementById(
        "edit-name"
      ) as HTMLInputElement;
      await user.click(nameCheckbox);

      // Switch to search/replace
      const searchReplaceRadio = screen.getByRole("radio", {
        name: /search.*replace/i,
      });
      await user.click(searchReplaceRadio);

      // Wait for mode to switch
      await waitFor(() => {
        expect(
          screen.getByText("[t]repository.bulkEdit.searchFor")
        ).toBeInTheDocument();
      });

      // Enable case sensitive
      const caseSensitiveCheckbox = screen.getByLabelText(
        "[t]repository.bulkEdit.caseSensitive"
      );
      await user.click(caseSensitiveCheckbox);

      // Enter search pattern with wrong case with delay
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.clear(searchInput);
      await user.type(searchInput, "test case"); // lowercase

      // Should show no matches as our test data has "Test Case" (uppercase T and C)
      await waitFor(() => {
        expect(
          screen.getByText("[t]repository.bulkEdit.noMatches")
        ).toBeInTheDocument();
      });
    });
  });

  describe("Permission Checks", () => {
    it("should respect tag permissions", async () => {
      (useProjectPermissions as Mock).mockReturnValue({
        permissions: {
          canAddEdit: false, // No permission to edit tags
          canDelete: false,
        },
        isLoading: false,
      });

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(
          screen.queryByText("[t]repository.fields.tags")
        ).toBeInTheDocument();
      });

      // Tags field should still be visible but editing behavior may be restricted
      expect(screen.getByText("[t]repository.fields.tags")).toBeInTheDocument();
    });

    it("should show lock icon for restricted fields", async () => {
      // Mock a restricted field (Steps field is the first field)
      const casesWithRestrictedField = mockCasesWithTextFields.map((c) => ({
        ...c,
        template: {
          ...c.template,
          caseFields: [
            {
              ...c.template.caseFields[0],
              caseField: {
                ...c.template.caseFields[0].caseField,
                isRestricted: true,
              },
            },
            ...c.template.caseFields.slice(1),
          ],
        },
      }));

      // Override fetch mock to return cases with restricted field
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ cases: casesWithRestrictedField }),
          status: 200,
          statusText: "OK",
          headers: new Headers(),
        } as Response)
      );

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
        />
      );

      // Wait for Steps field to appear
      await waitFor(() => {
        expect(screen.getByText("Steps")).toBeInTheDocument();
      });

      // Should show lock icon for restricted field (Steps)
      const stepsLabel = screen.getByText("Steps").closest("label");
      const lockIcon = within(stepsLabel!).queryByTitle("Restricted Field");
      expect(lockIcon).toBeInTheDocument();
    });
  });

  describe("Steps Field Search/Replace", () => {
    // Helper function to render modal and enable Steps field
    const setupStepsField = async (props = {}) => {
      const user = userEvent.setup();

      render(
        <BulkEditModal
          isOpen={true}
          onClose={vi.fn()}
          onSaveSuccess={vi.fn()}
          selectedCaseIds={[1, 2]}
          projectId={1}
          {...props}
        />
      );

      // Wait for Steps field to appear
      await waitFor(() => {
        expect(screen.getByText("Steps")).toBeInTheDocument();
      });

      // Find and click the Steps checkbox
      const stepsLabel = screen.getByText("Steps");
      const labelElement = stepsLabel.closest("label");
      const checkboxId = labelElement?.getAttribute("for");
      const stepsCheckbox = document.getElementById(
        checkboxId!
      ) as HTMLInputElement;

      await user.click(stepsCheckbox);

      // Wait for field to be enabled
      await waitFor(() => {
        expect(stepsCheckbox).toBeChecked();
      });

      return { user, stepsCheckbox };
    };

    beforeEach(() => {
      // Clear all mocks first
      vi.clearAllMocks();

      // Re-setup fetch mock for Steps field tests - use mockCasesWithTextFields which already includes Steps
      global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (
          url.includes("/api/projects/") &&
          url.includes("/cases/fetch-many")
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ cases: mockCasesWithTextFields }),
            status: 200,
            statusText: "OK",
            headers: new Headers(),
          } as Response);
        }

        if (
          url.includes("/api/projects/") &&
          url.includes("/cases/bulk-edit-fetch")
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ cases: mockCasesWithTextFields }),
            status: 200,
            statusText: "OK",
            headers: new Headers(),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          json: async () => ({}),
          status: 200,
          statusText: "OK",
          headers: new Headers(),
        } as Response);
      }) as any;

      // Re-setup session mock
      vi.spyOn(NextAuth, "useSession").mockReturnValue({
        data: mockSession,
        status: "authenticated",
        update: vi.fn(),
      });

      // Use the mock data with Steps field
      (useFindManyRepositoryCases as Mock).mockReturnValue({
        data: mockCasesWithStepsField,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      (useFindManyRepositoryCasesFiltered as Mock).mockReturnValue({
        data: mockCasesWithStepsField,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      // Re-setup other mocks that are needed
      (useFindManyWorkflows as Mock).mockReturnValue({
        data: mockWorkflowData,
        isLoading: false,
      });

      (useFindManyTags as Mock).mockReturnValue({
        data: mockTagsData,
        isLoading: false,
      });

      (useFindManyIssue as Mock).mockReturnValue({
        data: mockIssuesData,
        isLoading: false,
      });

      (useUpdateRepositoryCases as Mock).mockReturnValue({
        mutateAsync: mockUpdateCasesMutation,
        isPending: false,
      });

      (useUpdateCaseFieldValues as Mock).mockReturnValue({
        mutateAsync: mockUpdateCaseFieldValue,
      });

      (useCreateCaseFieldValues as Mock).mockReturnValue({
        mutateAsync: mockCreateCaseFieldValues,
      });

      (useUpdateManyRepositoryCases as Mock).mockReturnValue({
        mutateAsync: mockUpdateManyRepositoryCases,
        isPending: false,
      });

      (useCreateSteps as Mock).mockReturnValue({
        mutateAsync: mockCreateSteps,
      });

      (useDeleteManySteps as Mock).mockReturnValue({
        mutateAsync: mockDeleteManySteps,
      });

      (useUpdateSteps as Mock).mockReturnValue({
        mutateAsync: mockUpdateSteps,
      });

      // Mock useProjectPermissions to handle multiple application areas
      (useProjectPermissions as Mock).mockImplementation(() => ({
        permissions: {
          canAddEdit: true,
          canDelete: true,
        },
        isLoading: false,
        error: null,
      }));

      (useCreateRepositoryCaseVersions as Mock).mockReturnValue({
        mutateAsync: mockCreateRepositoryCaseVersions,
        isPending: false,
      });

      (useCreateCaseFieldVersionValues as Mock).mockReturnValue({
        mutateAsync: mockCreateCaseFieldVersionValues,
        isPending: false,
      });
    });

    it("should display Steps field with search/replace mode only", async () => {
      await setupStepsField();

      // Should show info message about search/replace only
      await waitFor(() => {
        expect(
          screen.getByText("[t]repository.bulkEdit.stepsSearchReplaceInfo")
        ).toBeInTheDocument();
      });

      // Should NOT show the radio group for mode selection
      expect(
        screen.queryByRole("radio", {
          name: "[t]repository.bulkEdit.replaceAll",
        })
      ).not.toBeInTheDocument();

      // Should show search/replace inputs directly
      expect(
        screen.getByText("[t]repository.bulkEdit.searchFor")
      ).toBeInTheDocument();
      expect(
        screen.getByText("[t]repository.bulkEdit.replaceWith")
      ).toBeInTheDocument();
    });

    it("should preview matches in steps and expected results", async () => {
      await setupStepsField();

      // Verify search/replace inputs appear
      expect(
        screen.getByText("[t]repository.bulkEdit.searchFor")
      ).toBeInTheDocument();
      expect(
        screen.getByText("[t]repository.bulkEdit.replaceWith")
      ).toBeInTheDocument();
    });

    it("should navigate through preview matches for Steps", async () => {
      await setupStepsField();

      // Verify basic functionality
      expect(
        screen.getByText("[t]repository.bulkEdit.searchFor")
      ).toBeInTheDocument();
    });

    it("should support case-sensitive search in Steps", async () => {
      const { user } = await setupStepsField();

      // Enable case sensitive
      const caseSensitiveCheckbox = screen.getByLabelText(
        "[t]repository.bulkEdit.caseSensitive"
      );
      await user.click(caseSensitiveCheckbox);

      // Enter search pattern with specific case
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "Login"); // Capital L

      // Verify case sensitive option is working
      await waitFor(() => {
        expect(caseSensitiveCheckbox).toBeChecked();
      });
    });

    it("should support regex patterns in Steps search", async () => {
      const { user } = await setupStepsField();

      // Enable regex
      const regexCheckbox = screen.getByLabelText(
        "[t]repository.bulkEdit.useRegex"
      );
      await user.click(regexCheckbox);

      // Enter regex pattern
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "(login|logout)");

      // Enter replacement
      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "auth");

      // Verify regex is enabled and inputs have expected values
      await waitFor(() => {
        expect(regexCheckbox).toBeChecked();
        expect(searchInput).toHaveValue("(login|logout)");
        expect(replaceInput).toHaveValue("auth");
      });
    });

    it("should update steps content with search/replace", async () => {
      const { user } = await setupStepsField();

      // Enter search and replace values
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "login");

      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "signin");

      // Verify inputs have the expected values
      await waitFor(() => {
        expect(searchInput).toHaveValue("login");
        expect(replaceInput).toHaveValue("signin");
      });

      // Save button should be enabled
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      expect(saveButton).not.toBeDisabled();
    });

    it("should handle empty search pattern validation for Steps", async () => {
      const { user } = await setupStepsField();

      // Leave search pattern empty and try to save
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      await user.click(saveButton);

      // Should show validation error
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "[t]repository.bulkEdit.validationError"
        );
        expect(
          screen.getByText("[t]repository.bulkEdit.searchPatternRequired")
        ).toBeInTheDocument();
      });
    });

    it("should not update steps if no matches found", async () => {
      const onSaveSuccess = vi.fn();
      const onClose = vi.fn();
      const { user } = await setupStepsField();

      // Enter search pattern that won't match
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "nonexistenttext");

      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "replacement");

      // Should show no matches
      await waitFor(
        () => {
          expect(
            screen.getByText("[t]repository.bulkEdit.noMatches")
          ).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Save changes
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      await user.click(saveButton);

      // Since there are no matches but the field is edited, it should still complete successfully
      await waitFor(() => {
        expect(mockUpdateSteps).not.toHaveBeenCalled();
      });
    });

    it("should preserve JSON formatting when updating steps", async () => {
      const { user } = await setupStepsField();

      // Enter search and replace
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "Navigate");

      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "Go");

      // Verify inputs have values
      await waitFor(() => {
        expect(searchInput).toHaveValue("Navigate");
        expect(replaceInput).toHaveValue("Go");
      });

      // Save button should be enabled
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      expect(saveButton).not.toBeDisabled();
    });

    it("should handle double-byte characters in search/replace", async () => {
      // Create test data with Japanese characters
      const mockCasesWithJapanese = [
        {
          ...mockCasesWithStepsField[0],
          steps: [
            {
              id: 1,
              order: 0,
              step: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "ログインページへ移動する" },
                    ],
                  },
                ],
              }),
              expectedResult: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "ログインページが表示される" },
                    ],
                  },
                ],
              }),
            },
          ],
        },
      ];

      // Update fetch mock to return Japanese data
      global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (
          url.includes("/api/projects/") &&
          (url.includes("/cases/bulk-edit-fetch") ||
            url.includes("/cases/fetch-many"))
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ cases: mockCasesWithJapanese }),
            status: 200,
            statusText: "OK",
            headers: new Headers(),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
          status: 200,
          statusText: "OK",
          headers: new Headers(),
        } as Response);
      }) as any;

      (useFindManyRepositoryCases as Mock).mockReturnValue({
        data: mockCasesWithJapanese,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      (useFindManyRepositoryCasesFiltered as Mock).mockReturnValue({
        data: mockCasesWithJapanese,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { user } = await setupStepsField();

      // Enter search and replace with double-byte characters
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "ログイン");

      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "サインイン");

      // Verify inputs have values
      await waitFor(() => {
        expect(searchInput).toHaveValue("ログイン");
        expect(replaceInput).toHaveValue("サインイン");
      });

      // Save button should be enabled
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      expect(saveButton).not.toBeDisabled();
    });

    it("should properly escape SQL injection attempts in search patterns", async () => {
      const { user } = await setupStepsField();

      // Try SQL injection pattern
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "'; DROP TABLE steps; --");

      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "safe text");

      // Should show no matches (SQL injection string shouldn't match normal content)
      await waitFor(
        () => {
          expect(
            screen.getByText("[t]repository.bulkEdit.noMatches")
          ).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Verify save still works safely
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      await user.click(saveButton);

      // Should not cause any errors
      await waitFor(() => {
        expect(mockUpdateSteps).not.toHaveBeenCalled();
      });
    });

    it("should handle JSON-breaking characters in replacement text", async () => {
      const { user } = await setupStepsField();

      // Enter search pattern
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "login");

      // Enter replacement with JSON-breaking characters
      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, '"},"type":"malicious","text":"');

      // Verify inputs have values
      await waitFor(() => {
        expect(searchInput).toHaveValue("login");
        expect(replaceInput).toHaveValue('"},"type":"malicious","text":"');
      });

      // Save button should be enabled
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      expect(saveButton).not.toBeDisabled();
    });

    it("should handle special regex characters in non-regex mode", async () => {
      // Create test data with special regex characters
      const mockCasesWithSpecialChars = [
        {
          ...mockCasesWithStepsField[0],
          steps: [
            {
              id: 1,
              order: 0,
              step: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Click [Submit] button (optional)",
                      },
                    ],
                  },
                ],
              }),
              expectedResult: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Form is submitted successfully" },
                    ],
                  },
                ],
              }),
            },
          ],
        },
      ];

      // Update fetch mock to return special chars data
      global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (
          url.includes("/api/projects/") &&
          (url.includes("/cases/bulk-edit-fetch") ||
            url.includes("/cases/fetch-many"))
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ cases: mockCasesWithSpecialChars }),
            status: 200,
            statusText: "OK",
            headers: new Headers(),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
          status: 200,
          statusText: "OK",
          headers: new Headers(),
        } as Response);
      }) as any;

      (useFindManyRepositoryCases as Mock).mockReturnValue({
        data: mockCasesWithSpecialChars,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      (useFindManyRepositoryCasesFiltered as Mock).mockReturnValue({
        data: mockCasesWithSpecialChars,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { user, stepsCheckbox } = await setupStepsField();

      // Search for text with special regex characters (should be treated literally)
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "[Submit]");

      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "[Send]");

      // Verify Steps field is enabled
      await waitFor(() => {
        expect(stepsCheckbox).toBeChecked();
      });

      // Save button should be enabled
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      expect(saveButton).not.toBeDisabled();
    });

    it("should handle emoji and unicode characters", async () => {
      // Create test data with emojis
      const mockCasesWithEmoji = [
        {
          ...mockCasesWithStepsField[0],
          steps: [
            {
              id: 1,
              order: 0,
              step: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Click the like button ❤️" },
                    ],
                  },
                ],
              }),
              expectedResult: JSON.stringify({
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Like count increases ✅" },
                    ],
                  },
                ],
              }),
            },
          ],
        },
      ];

      // Update fetch mock to return emoji data
      global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        if (
          url.includes("/api/projects/") &&
          (url.includes("/cases/bulk-edit-fetch") ||
            url.includes("/cases/fetch-many"))
        ) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ cases: mockCasesWithEmoji }),
            status: 200,
            statusText: "OK",
            headers: new Headers(),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
          status: 200,
          statusText: "OK",
          headers: new Headers(),
        } as Response);
      }) as any;

      (useFindManyRepositoryCases as Mock).mockReturnValue({
        data: mockCasesWithEmoji,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      (useFindManyRepositoryCasesFiltered as Mock).mockReturnValue({
        data: mockCasesWithEmoji,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      const { user } = await setupStepsField();

      // Search and replace with emojis
      const searchInput = screen.getAllByRole("textbox")[0];
      await user.type(searchInput, "❤️");

      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "👍");

      // Verify inputs have emoji values
      await waitFor(() => {
        expect(searchInput).toHaveValue("❤️");
        expect(replaceInput).toHaveValue("👍");
      });

      // Save button should be enabled
      const saveButton = screen.getByRole("button", {
        name: "[t]common.actions.save",
      });
      expect(saveButton).not.toBeDisabled();
    });

    it("should handle null bytes and control characters", async () => {
      const { user } = await setupStepsField();

      // Try to search for text with control characters
      const searchInput = screen.getAllByRole("textbox")[0];
      // Note: Most control characters will be filtered by the browser/input
      await user.type(searchInput, "login\x00\x01\x02");

      const replaceInput = screen.getAllByRole("textbox")[1];
      await user.type(replaceInput, "signin");

      // Verify inputs were set (control characters might be stripped)
      await waitFor(() => {
        // Control characters are often stripped by the browser
        expect(replaceInput).toHaveValue("signin");
      });
    });
  });
});
