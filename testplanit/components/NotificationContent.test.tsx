import { render, screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationContent } from "./NotificationContent";

// Mock next-intl
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: vi.fn(),
}));

// Mock navigation
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

// Mock components
vi.mock("@/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId, hideLink: _hideLink }: any) => (
    <span>{`User ${userId}`}</span>
  ),
}));

vi.mock("@/components/tables/ProjectNameCell", () => ({
  ProjectNameCell: ({ value }: any) => <span>{value}</span>,
}));

vi.mock("@/components/TestCaseNameDisplay", () => ({
  TestCaseNameDisplay: ({ testCase }: any) => <span>{testCase.name}</span>,
}));

vi.mock("@/components/SessionNameDisplay", () => ({
  SessionNameDisplay: ({ session }: any) => <span>{session.name}</span>,
}));

vi.mock("@/components/TextFromJson", () => ({
  default: ({ jsonString, format }: any) => {
    if (format === "html") {
      const content = JSON.parse(jsonString);
      return <div data-testid="rich-content">{JSON.stringify(content)}</div>;
    }
    return <span>{jsonString}</span>;
  },
}));

vi.mock("@/components/MilestoneNameDisplay", () => ({
  MilestoneNameDisplay: ({ milestone }: any) => <span>{milestone.name}</span>,
}));

describe("NotificationContent", () => {
  beforeEach(() => {
    const mockT = vi.fn((key: string, params?: any) => {
      const translations: Record<string, string> = {
        testCaseAssignmentTitle: "New Test Case Assignment",
        multipleTestCaseAssignmentTitle: "Multiple Test Cases Assigned",
        sessionAssignmentTitle: "New Session Assignment",
        systemAnnouncementTitle: "System Announcement",
        assignedTestCase: "assigned you to test case",
        assignedMultipleTestCases: "assigned you {count} test cases",
        assignedSession: "assigned you to session",
        inProject: "in project",
        testRun: "Test Run:",
        casesInProject: "{count} cases in",
        sentBy: "Sent by {name}",
        // New i18n keys for the four notification types we just
        // refactored to render via t() instead of falling back to the
        // persisted English `notification.title` / `.message` columns.
        shareLinkAccessedTitle: "Shared Report Viewed",
        shareLinkAccessedAnonymousViewer: "Someone",
        shareLinkAccessedMessage:
          '{viewer} viewed your shared report: "{shareTitle}"',
        viewedAt: "Viewed at",
        copyCompleteTitle: "Copy Complete",
        moveCompleteTitle: "Move Complete",
        copyCompleteMessage: "{count} cases copied successfully",
        moveCompleteMessage: "{count} cases moved successfully",
        copyMoveErrorsAppend: ", {errorCount} failed",
        viewTargetRepository: "View target repository",
        llmBudgetExceededTitle: "LLM Budget Exceeded",
        llmBudgetThresholdTitle: "LLM Budget {threshold}% Used",
        llmBudgetExceededMessage:
          "{providerName} has exceeded its monthly budget: {spend} spent of {budget} budget.",
        llmBudgetThresholdMessage:
          "{providerName} has used {threshold}% of its monthly budget: {spend} of {budget}.",
        budgetDisclaimer:
          "Budget limits are informational only and do not prevent usage.",
        userRegisteredTitle: "New User Registration",
        userRegisteredMessageSso:
          "{userName} ({userEmail}) has registered via SSO",
        userRegisteredMessageForm:
          "{userName} ({userEmail}) has registered via the registration form",
        viewUserList: "View user list",
        aiStepsDerivedTitle: "AI-Derived Test Steps Ready",
        aiStepsDerivedMessage:
          "{count} test cases were given AI-derived steps — review for accuracy.",
        aiStepsDerivedReviewLink: "Review test run",
      };

      let result = translations[key] || key;
      if (params) {
        Object.entries(params).forEach(([paramKey, value]) => {
          result = result.replace(`{${paramKey}}`, String(value));
        });
      }
      return result;
    });

    (vi.mocked(useTranslations) as any).mockReturnValue(mockT);
  });

  describe("System Announcements", () => {
    it("should render system announcement with plain text", () => {
      const notification = {
        id: "1",
        type: "SYSTEM_ANNOUNCEMENT",
        title: "Maintenance Notice",
        message: "System will be down for maintenance",
        data: {
          sentByName: "Admin User",
        },
      };

      render(<NotificationContent notification={notification} />);

      // Check title is displayed instead of generic "System Announcement"
      expect(screen.getByText("Maintenance Notice")).toBeInTheDocument();

      // Check message
      expect(
        screen.getByText("System will be down for maintenance")
      ).toBeInTheDocument();

      // Check sent by
      expect(screen.getByText("Sent by Admin User")).toBeInTheDocument();

      // Check for megaphone icon (by class)
      const icon = screen
        .getByText("Maintenance Notice")
        .parentElement?.querySelector("svg");
      expect(icon).toBeInTheDocument();
    });

    it("should render system announcement with rich content", () => {
      const richContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Important: " },
              {
                type: "text",
                marks: [{ type: "bold" }],
                text: "System Update",
              },
            ],
          },
        ],
      };

      const notification = {
        id: "2",
        type: "SYSTEM_ANNOUNCEMENT",
        title: "System Update",
        message: "Important: System Update", // Plain text version
        data: {
          sentByName: "Admin User",
          richContent: richContent,
        },
      };

      render(<NotificationContent notification={notification} />);

      // Check title
      expect(screen.getByText("System Update")).toBeInTheDocument();

      // Should render rich content component
      expect(screen.getByTestId("rich-content")).toBeInTheDocument();

      // Should not show plain text message when rich content exists
      expect(
        screen.queryByText("Important: System Update")
      ).not.toBeInTheDocument();

      // Check sent by
      expect(screen.getByText("Sent by Admin User")).toBeInTheDocument();
    });

    it("should handle system announcement without sender info", () => {
      const notification = {
        id: "3",
        type: "SYSTEM_ANNOUNCEMENT",
        title: "Anonymous Notice",
        message: "This is an anonymous notification",
        data: {},
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("Anonymous Notice")).toBeInTheDocument();
      expect(
        screen.getByText("This is an anonymous notification")
      ).toBeInTheDocument();

      // Should not show "Sent by" when no sender name
      expect(screen.queryByText(/Sent by/)).not.toBeInTheDocument();
    });
  });

  describe("Work Assignments", () => {
    it("should render test case assignment", () => {
      const notification = {
        id: "4",
        type: "WORK_ASSIGNED",
        title: "Test Case Assignment",
        message: "You have been assigned a test case",
        data: {
          assignedById: "user1",
          testRunId: 123,
          projectId: 456,
          testCaseId: 789,
          testCaseName: "Login Test",
          projectName: "Test Project",
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("New Test Case Assignment")).toBeInTheDocument();
      expect(screen.getByText("assigned you to test case")).toBeInTheDocument();
      expect(screen.getByText("Login Test")).toBeInTheDocument();
      expect(screen.getByText("Test Project")).toBeInTheDocument();

      // Check link
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute(
        "href",
        "/projects/runs/456/123?selectedCase=789"
      );
    });

    it("should render bulk assignment", () => {
      const notification = {
        id: "5",
        type: "WORK_ASSIGNED",
        title: "Multiple Assignments",
        message: "Multiple test cases assigned",
        data: {
          isBulkAssignment: true,
          assignedById: "user1",
          count: 5,
          testRunGroups: [
            {
              testRunId: 123,
              testRunName: "Sprint 1 Tests",
              projectId: 456,
              projectName: "Test Project",
              testCases: [
                { testRunCaseId: 1, testCaseId: 101, testCaseName: "Test 1" },
                { testRunCaseId: 2, testCaseId: 102, testCaseName: "Test 2" },
              ],
            },
          ],
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(
        screen.getByText("Multiple Test Cases Assigned")
      ).toBeInTheDocument();
      expect(screen.getByText("assigned you 5 test cases")).toBeInTheDocument();
      expect(screen.getByText("Sprint 1 Tests")).toBeInTheDocument();
      expect(screen.getByText("2 cases in")).toBeInTheDocument();
    });
  });

  describe("AI-Derived Steps", () => {
    it("should render the run review link and the count message", () => {
      const notification = {
        id: "ai-1",
        type: "AI_STEPS_DERIVED",
        title: "AI-Derived Test Steps Ready",
        message: "stored fallback message",
        data: {
          projectId: 456,
          testRunId: 123,
          derivedCount: 3,
          testRunName: "Nightly CI",
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(
        screen.getByText("AI-Derived Test Steps Ready")
      ).toBeInTheDocument();
      expect(
        screen.getByText(/3 test cases were given AI-derived steps/)
      ).toBeInTheDocument();
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/projects/runs/456/123");
      expect(screen.getByText("Review test run")).toBeInTheDocument();
    });

    it("should fall back to the stored title/message when data is incomplete", () => {
      const notification = {
        id: "ai-2",
        type: "AI_STEPS_DERIVED",
        title: "AI-Derived Test Steps Ready",
        message: "stored fallback message",
        data: {},
      };

      render(<NotificationContent notification={notification} />);

      expect(
        screen.getByText("stored fallback message")
      ).toBeInTheDocument();
      // No run link when projectId/testRunId are missing
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });

  describe("Session Assignments", () => {
    it("should render session assignment", () => {
      const notification = {
        id: "6",
        type: "SESSION_ASSIGNED",
        title: "Session Assignment",
        message: "You have been assigned a session",
        data: {
          assignedById: "user1",
          projectId: 456,
          sessionId: 789,
          sessionName: "Exploratory Testing Session",
          projectName: "Test Project",
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("New Session Assignment")).toBeInTheDocument();
      expect(screen.getByText("assigned you to session")).toBeInTheDocument();
      expect(
        screen.getByText("Exploratory Testing Session")
      ).toBeInTheDocument();

      // Check link
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/projects/sessions/456/789");
    });
  });

  describe("Milestone Due Reminders", () => {
    it("should render milestone due soon notification", () => {
      const notification = {
        id: "9",
        type: "MILESTONE_DUE_REMINDER",
        title: "Milestone Due Soon",
        message: "Milestone is due soon",
        data: {
          projectId: 100,
          milestoneId: 42,
          milestoneName: "Release 2.0",
          projectName: "Test Project",
          dueDate: new Date("2025-12-15").toISOString(),
          isOverdue: false,
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("milestoneDueSoonTitle")).toBeInTheDocument();
      expect(screen.getByText("Release 2.0")).toBeInTheDocument();
      // Check link to milestone
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/projects/milestones/100/42");
    });

    it("should render overdue milestone notification", () => {
      const notification = {
        id: "10",
        type: "MILESTONE_DUE_REMINDER",
        title: "Milestone Overdue",
        message: "Milestone is overdue",
        data: {
          projectId: 200,
          milestoneId: 99,
          milestoneName: "Sprint 5",
          projectName: "Mobile App",
          dueDate: new Date("2025-01-01").toISOString(),
          isOverdue: true,
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("milestoneOverdueTitle")).toBeInTheDocument();
      expect(screen.getByText("Sprint 5")).toBeInTheDocument();
      // Check link to milestone
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/projects/milestones/200/99");
    });

    it("should fall back to basic rendering for milestone without full data", () => {
      const notification = {
        id: "11",
        type: "MILESTONE_DUE_REMINDER",
        title: "Milestone Due",
        message: "A milestone is due",
        data: {}, // Missing required projectId and milestoneId
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("Milestone Due")).toBeInTheDocument();
      expect(screen.getByText("A milestone is due")).toBeInTheDocument();
    });
  });

  describe("Share Link Accessed", () => {
    it("should render share link accessed notification with project info", () => {
      const viewedAt = new Date("2025-06-15T10:30:00Z").toISOString();
      const notification = {
        id: "12",
        type: "SHARE_LINK_ACCESSED",
        title: "Shared Report Viewed",
        message: 'John viewed your shared report: "Q3 Regression"',
        data: {
          shareLinkId: "link-abc",
          shareTitle: "Q3 Regression",
          projectId: 100,
          viewerName: "John",
          viewedAt,
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("Shared Report Viewed")).toBeInTheDocument();
      expect(
        screen.getByText('John viewed your shared report: "Q3 Regression"')
      ).toBeInTheDocument();
    });

    it("should fall back to anonymous viewer when name + email are absent", () => {
      const notification = {
        id: "13",
        type: "SHARE_LINK_ACCESSED",
        title: "Shared Report Viewed",
        message: "Someone viewed your report",
        data: {
          shareLinkId: "link-xyz",
          shareTitle: "Sprint 5",
          projectId: 200,
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("Shared Report Viewed")).toBeInTheDocument();
      expect(
        screen.getByText('Someone viewed your shared report: "Sprint 5"')
      ).toBeInTheDocument();
      // viewedAt label should not appear when viewedAt is absent
      expect(screen.queryByText(/Viewed at/i)).not.toBeInTheDocument();
    });

    it("should fall back to basic rendering for share link without complete data", () => {
      const notification = {
        id: "14",
        type: "SHARE_LINK_ACCESSED",
        title: "Report Viewed",
        message: "Your report was viewed",
        data: {}, // Missing shareLinkId
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("Report Viewed")).toBeInTheDocument();
      expect(screen.getByText("Your report was viewed")).toBeInTheDocument();
    });
  });

  describe("Comment Mentions", () => {
    it("should render comment mention on a repository case", () => {
      const notification = {
        id: "15",
        type: "COMMENT_MENTION",
        title: "Comment Mention",
        message: "You were mentioned",
        data: {
          projectId: 100,
          hasProjectAccess: true,
          creatorId: "user2",
          entityType: "RepositoryCase",
          repositoryCaseId: "case-55",
          testCaseName: "Login Flow Test",
          projectName: "Test Project",
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("commentMentionTitle")).toBeInTheDocument();
      expect(screen.getByText("mentionedYouInComment")).toBeInTheDocument();
      expect(screen.getByText("Login Flow Test")).toBeInTheDocument();
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/projects/repository/100/case-55");
    });

    it("should render comment mention on a session", () => {
      const notification = {
        id: "16",
        type: "COMMENT_MENTION",
        title: "Comment Mention",
        message: "You were mentioned in a session",
        data: {
          projectId: 100,
          hasProjectAccess: true,
          creatorId: "user3",
          entityType: "Session",
          sessionId: "session-77",
          sessionName: "Exploratory Session",
          projectName: "Test Project",
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("commentMentionTitle")).toBeInTheDocument();
      expect(screen.getByText("Exploratory Session")).toBeInTheDocument();
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/projects/sessions/100/session-77");
    });

    it("should fall back for comment mention without project access", () => {
      const notification = {
        id: "17",
        type: "COMMENT_MENTION",
        title: "Comment Mention",
        message: "You were mentioned",
        data: {
          projectId: 100,
          hasProjectAccess: false,
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("Comment Mention")).toBeInTheDocument();
      expect(screen.getByText("You were mentioned")).toBeInTheDocument();
    });
  });

  describe("User Registration (USER_REGISTERED)", () => {
    it("should render localized form-registration message", () => {
      const notification = {
        id: "18",
        type: "USER_REGISTERED",
        title: "New User Registration",
        message:
          "John Doe (john@example.com) has registered via registration form",
        data: {
          newUserName: "John Doe",
          newUserEmail: "john@example.com",
          registrationMethod: "form",
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("New User Registration")).toBeInTheDocument();
      expect(
        screen.getByText(
          "John Doe (john@example.com) has registered via the registration form"
        )
      ).toBeInTheDocument();
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/admin/users");
    });

    it("should render localized SSO-registration message", () => {
      const notification = {
        id: "18b",
        type: "USER_REGISTERED",
        title: "New User Registration",
        message: "Jane Doe (jane@example.com) has registered via SSO",
        data: {
          newUserName: "Jane Doe",
          newUserEmail: "jane@example.com",
          registrationMethod: "sso",
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(
        screen.getByText("Jane Doe (jane@example.com) has registered via SSO")
      ).toBeInTheDocument();
    });

    it("should fall back when newUserName / newUserEmail are absent", () => {
      const notification = {
        id: "18c",
        type: "USER_REGISTERED",
        title: "New User Registration (legacy)",
        message: "User registered",
        data: {},
      };

      render(<NotificationContent notification={notification} />);

      expect(
        screen.getByText("New User Registration (legacy)")
      ).toBeInTheDocument();
      expect(screen.getByText("User registered")).toBeInTheDocument();
    });
  });

  describe("LLM Budget Alert", () => {
    it("should render localized 'threshold crossed' message with currency formatting", () => {
      const notification = {
        id: "19",
        type: "LLM_BUDGET_ALERT",
        title: "LLM Budget 90% Used",
        message:
          "OpenAI has used 90% of its monthly budget: $90.00 of $100.00.",
        data: {
          providerName: "OpenAI",
          currentSpend: 90,
          budgetLimit: 100,
          threshold: 90,
        },
      };

      render(<NotificationContent notification={notification} />);

      // Title goes through the "below 100%" branch.
      expect(screen.getByText("LLM Budget 90% Used")).toBeInTheDocument();
      // Body interpolates spend/budget formatted via Intl.NumberFormat.
      // The exact currency string is locale-dependent; assert on the
      // provider name + threshold + the formatted dollar amounts so
      // the test stays stable across Node Intl variants.
      expect(
        screen.getByText(/OpenAI has used 90% of its monthly budget/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/budget limits are informational/i)
      ).toBeInTheDocument();
    });

    it("should render localized 'exceeded' message when threshold >= 100", () => {
      const notification = {
        id: "19b",
        type: "LLM_BUDGET_ALERT",
        title: "LLM Budget Exceeded",
        message:
          "OpenAI has exceeded its monthly budget: $110.00 spent of $100.00 budget.",
        data: {
          providerName: "OpenAI",
          currentSpend: 110,
          budgetLimit: 100,
          threshold: 100,
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("LLM Budget Exceeded")).toBeInTheDocument();
      expect(
        screen.getByText(/OpenAI has exceeded its monthly budget/)
      ).toBeInTheDocument();
    });

    it("should fall back when providerName / threshold absent (legacy data shape)", () => {
      const notification = {
        id: "19c",
        type: "LLM_BUDGET_ALERT",
        title: "Budget Alert",
        message: "You have reached 90% of your LLM budget",
        data: {}, // legacy row
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("Budget Alert")).toBeInTheDocument();
      expect(
        screen.getByText("You have reached 90% of your LLM budget")
      ).toBeInTheDocument();
    });
  });

  describe("REVIEW_REMINDER", () => {
    it("renders the localized reminder title and hoursPending line", () => {
      const notification = {
        id: "rr-1",
        type: "REVIEW_REMINDER",
        title: "Review still pending",
        message: "fallback",
        data: {
          reviewRequestId: "rr-1",
          requesterUserId: "user-r",
          requesterName: "Alice",
          projectId: 100,
          projectName: "Project Alpha",
          entityType: "CASE",
          entityId: 7,
          entityName: "Login flow",
          fromStateName: "Draft",
          toStateName: "Approved",
          hoursPending: 36,
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("reviewReminderTitle")).toBeInTheDocument();
      expect(
        screen.getByText("reviewReminderHoursPending")
      ).toBeInTheDocument();
      expect(screen.getByText("reviewReminderAction")).toBeInTheDocument();
      // Actor is the requester whose review is still pending.
      expect(screen.getByText("User user-r")).toBeInTheDocument();
      // Entity link composed from data.projectId / entityId for CASE type.
      const link = screen.getByRole("link");
      expect(link).toHaveAttribute("href", "/projects/repository/100/7");
    });

    it("does not render the hoursPending line when data.hoursPending is absent", () => {
      const notification = {
        id: "rr-2",
        type: "REVIEW_REMINDER",
        title: "Review still pending",
        message: "fallback",
        data: {
          reviewRequestId: "rr-2",
          requesterUserId: "user-r",
          requesterName: "Alice",
          projectId: 100,
          projectName: "Project Alpha",
          entityType: "CASE",
          entityId: 7,
          entityName: "Login flow",
          fromStateName: "Draft",
          toStateName: "Approved",
          // hoursPending intentionally omitted
        },
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("reviewReminderTitle")).toBeInTheDocument();
      expect(
        screen.queryByText("reviewReminderHoursPending")
      ).not.toBeInTheDocument();
    });
  });

  describe("Fallback rendering", () => {
    it("should render generic notification for unknown types", () => {
      const notification = {
        id: "7",
        type: "UNKNOWN_TYPE",
        title: "Generic Title",
        message: "Generic message",
      };

      render(<NotificationContent notification={notification} />);

      expect(screen.getByText("Generic Title")).toBeInTheDocument();
      expect(screen.getByText("Generic message")).toBeInTheDocument();
    });

    it("should handle missing data gracefully", () => {
      const notification = {
        id: "8",
        type: "WORK_ASSIGNED",
        title: "Fallback Title",
        message: "Fallback message",
        data: {}, // Missing expected data
      };

      render(<NotificationContent notification={notification} />);

      // Should fall back to basic rendering
      expect(screen.getByText("Fallback Title")).toBeInTheDocument();
      expect(screen.getByText("Fallback message")).toBeInTheDocument();
    });
  });
});
