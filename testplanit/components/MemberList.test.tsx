import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "~/test/test-utils";
import { MemberList } from "./MemberList";

const USERS = [
  { id: "u1", name: "Ada Lovelace", image: null, isDeleted: false },
  { id: "u2", name: "Grace Hopper", image: null, isDeleted: false },
];

const useFindMany = vi.fn(
  (_args: unknown, options?: { enabled?: boolean }) => ({
    data: options?.enabled === false ? undefined : USERS,
  })
);

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    user: {
      useFindMany: (args: unknown, options?: { enabled?: boolean }) =>
        useFindMany(args, options),
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

  it("draws members from a directory the caller loaded, without fetching", () => {
    useFindMany.mockClear();
    render(
      <MemberList
        users={[{ userId: "d2" }]}
        directory={[
          { id: "d1", name: "Alan Turing", image: null },
          { id: "d2", name: "Edsger Dijkstra", image: null },
        ]}
      />
    );

    expect(
      screen.getByRole("link", { name: "Profile of Edsger Dijkstra" })
    ).toHaveAttribute("href", "/users/profile/d2");
    expect(
      screen.queryByRole("link", { name: /Alan Turing/ })
    ).not.toBeInTheDocument();
    expect(useFindMany).toHaveBeenCalledWith(expect.anything(), {
      enabled: false,
    });
  });

  it("keeps a capped list on one row by moving what does not fit behind the button", () => {
    const original = globalThis.ResizeObserver;
    let report: (width: number) => void = () => {};
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        report = (width) =>
          callback(
            [{ contentRect: { width } } as ResizeObserverEntry],
            this as unknown as ResizeObserver
          );
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    try {
      const directory = Array.from({ length: 12 }, (_, i) => ({
        id: `m${i}`,
        name: `Member ${i}`,
        image: null,
      }));
      render(
        <MemberList
          users={directory.map((m) => ({ userId: m.id }))}
          maxUsers={10}
          directory={directory}
        />
      );
      expect(screen.getAllByRole("link")).toHaveLength(10);

      // 200px holds four 25px avatars beside the 96px button.
      act(() => report(200));
      expect(screen.getAllByRole("link")).toHaveLength(4);
      expect(
        screen.getByRole("button", { name: "+8 more..." })
      ).toBeInTheDocument();

      act(() => report(600));
      expect(screen.getAllByRole("link")).toHaveLength(10);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it("fetches its own users when no directory is given", () => {
    useFindMany.mockClear();
    render(<MemberList users={[{ userId: "u1" }]} />);

    expect(useFindMany).toHaveBeenCalledWith(expect.anything(), {
      enabled: true,
    });
  });
});
