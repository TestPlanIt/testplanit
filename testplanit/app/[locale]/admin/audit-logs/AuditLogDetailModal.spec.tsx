import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import type { ExtendedAuditLog } from "./columns";
import { AuditLogDetailModal } from "./AuditLogDetailModal";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        preferences: {
          timezone: "Etc/UTC",
          dateFormat: "MM-dd-yyyy",
        },
      },
    },
  }),
}));

// Mock DateFormatter to avoid date formatting complexity
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: Date | string }) => (
    <span data-testid="date-formatter">{String(date)}</span>
  ),
}));

const baseLog: ExtendedAuditLog = {
  id: "log-001",
  action: "CREATE" as any,
  entityType: "TestCase",
  entityId: "abc-123",
  entityName: "My Test",
  userId: "user-001",
  userName: "Admin User",
  userEmail: "admin@test.com",
  timestamp: new Date("2024-01-15T10:00:00Z"),
  changes: null,
  metadata: null,
  projectId: null,
  project: null,
};

describe("AuditLogDetailModal", () => {
  test("renders nothing when log is null", () => {
    const { container } = render(
      <AuditLogDetailModal log={null} open={true} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders basic info for a log entry", () => {
    render(
      <AuditLogDetailModal log={baseLog} open={true} onClose={vi.fn()} />
    );

    // Entity type
    expect(screen.getByText("TestCase")).toBeInTheDocument();

    // Entity ID
    expect(screen.getByText("abc-123")).toBeInTheDocument();

    // Entity name
    expect(screen.getByText("My Test")).toBeInTheDocument();

    // User name
    expect(screen.getByText("Admin User")).toBeInTheDocument();

    // User email
    expect(screen.getByText("admin@test.com")).toBeInTheDocument();
  });

  test("renders action badge with CREATE text", () => {
    render(
      <AuditLogDetailModal log={baseLog} open={true} onClose={vi.fn()} />
    );

    // The action badge shows action.replace(/_/g, " ") = "CREATE"
    expect(screen.getByText("CREATE")).toBeInTheDocument();
  });

  test("renders changes section with old and new values", () => {
    const logWithChanges: ExtendedAuditLog = {
      ...baseLog,
      changes: {
        name: { old: "Old Name", new: "New Name" },
      } as any,
    };

    render(
      <AuditLogDetailModal log={logWithChanges} open={true} onClose={vi.fn()} />
    );

    // Changes section header
    expect(screen.getByText("admin.auditLogs.changes")).toBeInTheDocument();

    // Field name
    expect(screen.getByText("name")).toBeInTheDocument();

    // Old and new value labels
    expect(screen.getByText(/admin\.auditLogs\.oldValue/)).toBeInTheDocument();
    expect(screen.getByText(/admin\.auditLogs\.newValue/)).toBeInTheDocument();

    // Old and new values rendered in pre elements
    expect(screen.getByText("Old Name")).toBeInTheDocument();
    expect(screen.getByText("New Name")).toBeInTheDocument();
  });

  test("renders metadata section as JSON", () => {
    const logWithMetadata: ExtendedAuditLog = {
      ...baseLog,
      metadata: {
        ipAddress: "1.2.3.4",
        userAgent: "Mozilla/5.0",
      } as any,
    };

    render(
      <AuditLogDetailModal log={logWithMetadata} open={true} onClose={vi.fn()} />
    );

    // Metadata section header
    expect(screen.getByText("admin.auditLogs.metadata")).toBeInTheDocument();

    // Metadata content rendered in pre block
    expect(screen.getByText(/1\.2\.3\.4/)).toBeInTheDocument();
    expect(screen.getByText(/Mozilla\/5\.0/)).toBeInTheDocument();
  });

  test("hides changes section when changes is null", () => {
    const logNullChanges: ExtendedAuditLog = {
      ...baseLog,
      changes: null,
    };

    render(
      <AuditLogDetailModal log={logNullChanges} open={true} onClose={vi.fn()} />
    );

    // Changes section should NOT be present
    expect(screen.queryByText("admin.auditLogs.changes")).not.toBeInTheDocument();
  });

  test("hides changes section when changes is empty object", () => {
    const logEmptyChanges: ExtendedAuditLog = {
      ...baseLog,
      changes: {} as any,
    };

    render(
      <AuditLogDetailModal log={logEmptyChanges} open={true} onClose={vi.fn()} />
    );

    // Changes section should NOT be present (Object.keys(changes).length === 0)
    expect(screen.queryByText("admin.auditLogs.changes")).not.toBeInTheDocument();
  });

  test("renders project name when project is present", () => {
    const logWithProject: ExtendedAuditLog = {
      ...baseLog,
      projectId: 1,
      project: { name: "My Project" },
    };

    render(
      <AuditLogDetailModal log={logWithProject} open={true} onClose={vi.fn()} />
    );

    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  test("calls onClose when dialog close is triggered", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <AuditLogDetailModal log={baseLog} open={true} onClose={onClose} />
    );

    // Radix Dialog close button (aria-label="Close")
    const closeButton = screen.getByRole("button", { name: /close/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  test("renders date formatter for the log timestamp", () => {
    render(
      <AuditLogDetailModal log={baseLog} open={true} onClose={vi.fn()} />
    );

    // DateFormatter should be rendered (mocked to show the date string)
    expect(screen.getByTestId("date-formatter")).toBeInTheDocument();
  });
});
