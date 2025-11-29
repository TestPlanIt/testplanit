import { describe, it, expect, vi } from "vitest";
import { render, screen } from "~/test/test-utils";
import { UserDisplay } from "./UserDisplay";
import React from "react";

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: {
      user: {
        id: "current-user-id",
        name: "Current User",
      },
    },
  })),
}));

// Mock Avatar component
vi.mock("@/components/Avatar", () => ({
  Avatar: ({
    alt,
    width,
    height,
    image,
  }: {
    alt: string;
    width: number;
    height: number;
    image: string;
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-testid="avatar"
      src={image || "default-avatar.png"}
      alt={alt}
      width={width}
      height={height}
    />
  ),
}));

// Mock tooltip components
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <span className={className} data-testid="tooltip-trigger">
      {children}
    </span>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

describe("UserDisplay Component", () => {
  describe("Basic rendering", () => {
    it("should render user name", () => {
      render(<UserDisplay userId="user-1" userName="John Doe" />);

      // Use getAllByText since tooltip duplicates the text
      const userNames = screen.getAllByText("John Doe");
      expect(userNames).toHaveLength(2); // One in display, one in tooltip
    });

    it("should return null when userName is not provided", () => {
      const { container } = render(<UserDisplay userId="user-1" />);
      expect(container.firstChild).toBeNull();
    });

    it("should return null when userName is empty string", () => {
      const { container } = render(<UserDisplay userId="user-1" userName="" />);
      expect(container.firstChild).toBeNull();
    });

    it("should render with prefix", () => {
      render(
        <UserDisplay userId="user-1" userName="John Doe" prefix="Created by" />
      );

      expect(screen.getByText("Created by:")).toBeInTheDocument();
      const userNames = screen.getAllByText("John Doe");
      expect(userNames).toHaveLength(2);
    });
  });

  describe("Avatar rendering", () => {
    it("should render avatar with user image", () => {
      render(
        <UserDisplay
          userId="user-1"
          userName="John Doe"
          userImage="https://example.com/avatar.jpg"
        />
      );

      const avatar = screen.getByTestId("avatar");
      expect(avatar).toHaveAttribute("src", "https://example.com/avatar.jpg");
      expect(avatar).toHaveAttribute("alt", "John Doe");
      expect(avatar).toHaveAttribute("width", "16");
      expect(avatar).toHaveAttribute("height", "16");
    });

    it("should render avatar with empty string when userImage is null", () => {
      render(
        <UserDisplay userId="user-1" userName="John Doe" userImage={null} />
      );

      const avatar = screen.getByTestId("avatar");
      expect(avatar).toHaveAttribute("src", "default-avatar.png");
    });

    it("should render avatar with empty string when userImage is undefined", () => {
      render(<UserDisplay userId="user-1" userName="John Doe" />);

      const avatar = screen.getByTestId("avatar");
      expect(avatar).toHaveAttribute("src", "default-avatar.png");
    });
  });

  describe("Current user handling", () => {
    it("should show star icon for current user", () => {
      render(<UserDisplay userId="current-user-id" userName="Current User" />);

      const userNames = screen.getAllByText("Current User");
      const star = userNames[0].parentElement?.querySelector("svg");
      expect(star).toBeInTheDocument();
      expect(star).toHaveClass("lucide-star");
      expect(star).toHaveClass("fill-primary");
      expect(star).toHaveClass("text-primary");
    });

    it("should apply font-semibold class for current user", () => {
      render(<UserDisplay userId="current-user-id" userName="Current User" />);

      const userNames = screen.getAllByText("Current User");
      const nameContainer = userNames[0].parentElement;
      expect(nameContainer).toHaveClass("font-semibold");
    });

    it("should not show star icon for other users", () => {
      render(<UserDisplay userId="other-user-id" userName="Other User" />);

      const userNames = screen.getAllByText("Other User");
      const star = userNames[0].parentElement?.querySelector("svg");
      expect(star).not.toBeInTheDocument();
    });

    it("should not apply font-semibold class for other users", () => {
      render(<UserDisplay userId="other-user-id" userName="Other User" />);

      const userNames = screen.getAllByText("Other User");
      const nameContainer = userNames[0].parentElement;
      expect(nameContainer).not.toHaveClass("font-semibold");
    });

    it("should not show star when userId is not provided", () => {
      render(<UserDisplay userName="No ID User" />);

      const userNames = screen.getAllByText("No ID User");
      const star = userNames[0].parentElement?.querySelector("svg");
      expect(star).not.toBeInTheDocument();
    });
  });

  describe("Session handling", () => {
    it("should handle when session is null", async () => {
      const { useSession } = await import("next-auth/react");
      (useSession as any).mockReturnValueOnce({ data: null });

      render(<UserDisplay userId="user-1" userName="John Doe" />);

      // Should still render, but no current user styling
      const userNames = screen.getAllByText("John Doe");
      expect(userNames).toHaveLength(2);
      const nameContainer = userNames[0].parentElement;
      expect(nameContainer).not.toHaveClass("font-semibold");
    });

    it("should handle when session user has no id", async () => {
      const { useSession } = await import("next-auth/react");
      (useSession as any).mockReturnValueOnce({
        data: {
          user: {
            name: "No ID User",
          },
        },
      });

      render(<UserDisplay userId="user-1" userName="John Doe" />);

      // Should not show as current user
      const userNames = screen.getAllByText("John Doe");
      const nameContainer = userNames[0].parentElement;
      expect(nameContainer).not.toHaveClass("font-semibold");
    });
  });

  describe("Styling", () => {
    it("should apply custom className", () => {
      render(
        <UserDisplay
          userId="user-1"
          userName="John Doe"
          className="custom-class"
        />
      );

      const container = screen.getByTestId("avatar").parentElement;
      expect(container).toHaveClass("custom-class");
      expect(container).toHaveClass("flex");
      expect(container).toHaveClass("items-center");
      expect(container).toHaveClass("gap-1");
    });

    it("should apply default empty className", () => {
      render(<UserDisplay userId="user-1" userName="John Doe" />);

      const container = screen.getByTestId("avatar").parentElement;
      expect(container).toHaveClass("flex");
      expect(container).toHaveClass("items-center");
      expect(container).toHaveClass("gap-1");
    });
  });

  describe("Tooltip functionality", () => {
    it("should render tooltip trigger with proper classes", () => {
      render(
        <UserDisplay
          userId="user-1"
          userName="Very Long User Name That Should Be Truncated"
        />
      );

      const tooltipTrigger = screen.getByTestId("tooltip-trigger");
      expect(tooltipTrigger).toHaveClass("text-left");
      expect(tooltipTrigger).toHaveClass("min-w-0");
      expect(tooltipTrigger).toHaveClass("flex-1");
      expect(tooltipTrigger).toHaveClass("overflow-hidden");
    });

    it("should render full name in tooltip content", () => {
      const longName = "Very Long User Name That Should Be Truncated";
      render(<UserDisplay userId="user-1" userName={longName} />);

      const tooltipContent = screen.getByTestId("tooltip-content");
      expect(tooltipContent).toHaveTextContent(longName);
    });

    it("should apply truncate class to name span", () => {
      render(<UserDisplay userId="user-1" userName="John Doe" />);

      const userNames = screen.getAllByText("John Doe");
      // The first one is the actual display, not the tooltip
      expect(userNames[0]).toHaveClass("truncate");
    });
  });

  describe("Complete scenarios", () => {
    it("should render with all props for current user", () => {
      render(
        <UserDisplay
          userId="current-user-id"
          userName="Current User"
          userImage="https://example.com/current.jpg"
          prefix="Assigned to"
          className="highlight"
        />
      );

      // Check prefix
      expect(screen.getByText("Assigned to:")).toBeInTheDocument();

      // Check avatar
      const avatar = screen.getByTestId("avatar");
      expect(avatar).toHaveAttribute("src", "https://example.com/current.jpg");

      // Check name with star
      const userNames = screen.getAllByText("Current User");
      expect(userNames).toHaveLength(2);
      const star = userNames[0].parentElement?.querySelector("svg");
      expect(star).toBeInTheDocument();

      // Check custom class
      const container = avatar.parentElement;
      expect(container).toHaveClass("highlight");
    });

    it("should render with all props for other user", () => {
      render(
        <UserDisplay
          userId="other-user-id"
          userName="Other User"
          userImage="https://example.com/other.jpg"
          prefix="Created by"
          className="muted"
        />
      );

      // Check prefix
      expect(screen.getByText("Created by:")).toBeInTheDocument();

      // Check avatar
      const avatar = screen.getByTestId("avatar");
      expect(avatar).toHaveAttribute("src", "https://example.com/other.jpg");

      // Check name without star
      const userNames = screen.getAllByText("Other User");
      expect(userNames).toHaveLength(2);
      const star = userNames[0].parentElement?.querySelector("svg");
      expect(star).not.toBeInTheDocument();

      // Check custom class
      const container = avatar.parentElement;
      expect(container).toHaveClass("muted");
    });
  });
});
