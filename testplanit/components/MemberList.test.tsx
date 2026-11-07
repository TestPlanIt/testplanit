import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "~/test/test-utils";
import { MemberList } from "./MemberList";

const USERS = [
  { id: "u1", name: "Ada Lovelace", image: null, isDeleted: false },
  { id: "u2", name: "Grace Hopper", image: null, isDeleted: false },
];

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    user: {
      useFindMany: () => ({ data: USERS }),
      // UserNameCell (overflow popover) looks each user up by id.
      useFindFirst: ({ where }: any) => ({
        data: USERS.find((u) => u.id === where.id),
      }),
    },
  }),
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("MemberList", () => {
  it("links each avatar to the user's profile page", () => {
    render(<MemberList users={[{ userId: "u1" }, { userId: "u2" }]} />);

    const ada = screen.getByRole("link", { name: "Profile of Ada Lovelace" });
    expect(ada).toHaveAttribute("href", "/users/profile/u1");
    expect(ada).toHaveAttribute("data-testid", "member-profile-link-u1");

    const grace = screen.getByRole("link", {
      name: "Profile of Grace Hopper",
    });
    expect(grace).toHaveAttribute("href", "/users/profile/u2");
  });

  it("links overflow users to their profile page from the popover", () => {
    render(
      <MemberList users={[{ userId: "u1" }, { userId: "u2" }]} maxUsers={1} />
    );

    expect(
      screen.getByRole("link", { name: "Profile of Ada Lovelace" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Grace Hopper/ })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+1 more..." }));

    const grace = screen.getByTestId("user-profile-link-u2");
    expect(grace).toHaveAttribute("href", "/users/profile/u2");
    expect(grace).toHaveTextContent("Grace Hopper");
  });
});
