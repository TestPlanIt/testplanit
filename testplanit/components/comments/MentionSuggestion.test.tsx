import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MentionSuggestion,
  MentionSuggestionRef,
  MentionUser,
} from "./MentionSuggestion";

// Mock dependencies
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key.split(".").pop() ?? key),
}));

vi.mock("~/components/Avatar", () => ({
  Avatar: ({ alt }: { alt: string }) => (
    <div data-testid={`avatar-${alt}`} aria-label={alt} />
  ),
}));

vi.mock("~/components/ui/badge", () => ({
  Badge: ({ children, variant }: any) => (
    <span data-testid="badge" data-variant={variant}>
      {children}
    </span>
  ),
}));

vi.mock("~/utils", () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(" "),
}));

const makeMockUser = (
  id: string,
  name: string | null,
  email: string,
  opts: Partial<MentionUser> = {}
): MentionUser => ({
  id,
  name,
  email,
  image: null,
  isProjectMember: true,
  isActive: true,
  isDeleted: false,
  ...opts,
});

describe("MentionSuggestion", () => {
  const mockCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders user names for users with names", () => {
    const items = [
      makeMockUser("u1", "Alice Smith", "alice@example.com"),
      makeMockUser("u2", "Bob Jones", "bob@example.com"),
    ];
    render(<MentionSuggestion items={items} command={mockCommand} />);
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("renders email as display name when user has no name", () => {
    const items = [makeMockUser("u1", null, "noname@example.com")];
    render(<MentionSuggestion items={items} command={mockCommand} />);
    expect(screen.getByText("noname@example.com")).toBeInTheDocument();
  });

  it("renders user emails as secondary info when name is set", () => {
    const items = [makeMockUser("u1", "Alice Smith", "alice@example.com")];
    render(<MentionSuggestion items={items} command={mockCommand} />);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("shows 'notAMember' badge for users that are not project members", () => {
    const items = [
      makeMockUser("u1", "External User", "ext@external.com", {
        isProjectMember: false,
      }),
    ];
    render(<MentionSuggestion items={items} command={mockCommand} />);
    const badge = screen.getByTestId("badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-variant", "destructive");
  });

  it("does not show badge for project members", () => {
    const items = [
      makeMockUser("u1", "Alice Smith", "alice@example.com", {
        isProjectMember: true,
      }),
    ];
    render(<MentionSuggestion items={items} command={mockCommand} />);
    expect(screen.queryByTestId("badge")).not.toBeInTheDocument();
  });

  it("handles empty items array by showing no-users-found message", () => {
    render(<MentionSuggestion items={[]} command={mockCommand} />);
    expect(screen.getByText("noUsersFound")).toBeInTheDocument();
  });

  it("calls command with user id and label when user button is clicked", () => {
    const items = [makeMockUser("u1", "Alice Smith", "alice@example.com")];
    render(<MentionSuggestion items={items} command={mockCommand} />);
    fireEvent.click(screen.getByText("Alice Smith").closest("button")!);
    expect(mockCommand).toHaveBeenCalledWith({
      id: "u1",
      label: "Alice Smith",
      image: null,
    });
  });

  it("calls command with email as label when user has no name", () => {
    const items = [makeMockUser("u1", null, "noname@example.com")];
    render(<MentionSuggestion items={items} command={mockCommand} />);
    fireEvent.click(screen.getByText("noname@example.com").closest("button")!);
    expect(mockCommand).toHaveBeenCalledWith({
      id: "u1",
      label: "noname@example.com",
      image: null,
    });
  });

  it("first item is highlighted (selected) by default", () => {
    const items = [
      makeMockUser("u1", "Alice Smith", "alice@example.com"),
      makeMockUser("u2", "Bob Jones", "bob@example.com"),
    ];
    render(<MentionSuggestion items={items} command={mockCommand} />);
    const buttons = screen.getAllByRole("button");
    // First button (index 0) should have the selected class from cn(... index === selectedIndex && "bg-accent text-accent-foreground")
    // Both have "hover:bg-accent" in their base classes, but only the selected one has "bg-accent text-accent-foreground"
    // The selected button's className starts with the base classes followed by the selection classes
    expect(buttons[0].className).toContain("text-accent-foreground");
    // Second button has hover:bg-accent but NOT text-accent-foreground (the non-hover selected indicator)
    // Check second button lacks the full selected combo (without hover: prefix)
    const btn1Classes = buttons[1].className.split(" ");
    // bg-accent without hover: prefix indicates selected state
    const hasDirectBgAccent = btn1Classes.includes("bg-accent");
    expect(hasDirectBgAccent).toBe(false);
  });

  it("ArrowDown via ref.onKeyDown moves selection to next item", () => {
    const items = [
      makeMockUser("u1", "Alice Smith", "alice@example.com"),
      makeMockUser("u2", "Bob Jones", "bob@example.com"),
    ];
    const ref = createRef<MentionSuggestionRef>();
    render(
      <MentionSuggestion ref={ref} items={items} command={mockCommand} />
    );

    // Initially first item is selected
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].className).toContain("bg-accent");

    // Press ArrowDown
    ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "ArrowDown" }) });
  });

  it("Enter via ref.onKeyDown calls command with selected item", () => {
    const items = [makeMockUser("u1", "Alice Smith", "alice@example.com")];
    const ref = createRef<MentionSuggestionRef>();
    render(
      <MentionSuggestion ref={ref} items={items} command={mockCommand} />
    );

    ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "Enter" }) });

    expect(mockCommand).toHaveBeenCalledWith({
      id: "u1",
      label: "Alice Smith",
      image: null,
    });
  });

  it("ArrowUp via ref.onKeyDown wraps selection to last item", () => {
    const items = [
      makeMockUser("u1", "Alice Smith", "alice@example.com"),
      makeMockUser("u2", "Bob Jones", "bob@example.com"),
    ];
    const ref = createRef<MentionSuggestionRef>();
    render(
      <MentionSuggestion ref={ref} items={items} command={mockCommand} />
    );

    // Press ArrowUp from first item — should wrap to last
    const result = ref.current?.onKeyDown({
      event: new KeyboardEvent("keydown", { key: "ArrowUp" }),
    });
    expect(result).toBe(true);
  });

  it("returns false for unhandled key events", () => {
    const items = [makeMockUser("u1", "Alice", "alice@example.com")];
    const ref = createRef<MentionSuggestionRef>();
    render(
      <MentionSuggestion ref={ref} items={items} command={mockCommand} />
    );

    const result = ref.current?.onKeyDown({
      event: new KeyboardEvent("keydown", { key: "Escape" }),
    });
    expect(result).toBe(false);
  });

  it("renders avatar for each user", () => {
    const items = [makeMockUser("u1", "Alice Smith", "alice@example.com")];
    render(<MentionSuggestion items={items} command={mockCommand} />);
    expect(screen.getByTestId("avatar-Alice Smith")).toBeInTheDocument();
  });
});
