import { describe, expect, it, vi } from "vitest";
import { render, screen } from "~/test/test-utils";

// `~/lib/navigation`'s Link is next-intl's shared-navigation Link: it calls the
// real useLocale() and throws without an intl provider. Same plain-anchor stub
// the other tests around this primitive use.
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CaseDisplay } from "./CaseDisplay";

describe("CaseDisplay", () => {
  describe("hasParameters corner badge", () => {
    it("does NOT render the badge when hasParameters is false", () => {
      render(
        <CaseDisplay
          testCase={{ id: 1, name: "Plain manual case", hasParameters: false }}
        />
      );
      expect(screen.queryByTestId("has-parameters-badge")).toBeNull();
    });

    it("does NOT render the badge when hasParameters is omitted", () => {
      render(<CaseDisplay testCase={{ id: 2, name: "Legacy case payload" }} />);
      expect(screen.queryByTestId("has-parameters-badge")).toBeNull();
    });

    it("renders the badge when hasParameters is true on a manual case", () => {
      render(
        <CaseDisplay
          testCase={{ id: 3, name: "Manual params", hasParameters: true }}
        />
      );
      expect(screen.getByTestId("has-parameters-badge")).toBeInTheDocument();
    });

    it("renders the badge when hasParameters is true on an automated case", () => {
      render(
        <CaseDisplay
          testCase={{
            id: 4,
            name: "Automated params",
            automated: true,
            hasParameters: true,
          }}
        />
      );
      expect(screen.getByTestId("has-parameters-badge")).toBeInTheDocument();
    });

    it("reads hasParameters from a nested repositoryCase payload", () => {
      render(
        <CaseDisplay
          testCase={{
            id: 5,
            repositoryCase: {
              id: 5,
              name: "Nested params",
              hasParameters: true,
            },
          }}
        />
      );
      expect(screen.getByTestId("has-parameters-badge")).toBeInTheDocument();
    });

    it("suppresses the badge when the case is soft-deleted", () => {
      // Soft-deleted cases render the Trash2 icon and shouldn't carry the
      // params indicator — the row is being represented as gone.
      render(
        <CaseDisplay
          testCase={{
            id: 6,
            name: "Deleted",
            hasParameters: true,
            isDeleted: true,
          }}
        />
      );
      expect(screen.queryByTestId("has-parameters-badge")).toBeNull();
    });

    it("suppresses the badge when showIcon is false", () => {
      // Nothing to attach the badge to when the type icon is hidden.
      render(
        <CaseDisplay
          testCase={{ id: 7, name: "No icon", hasParameters: true }}
          showIcon={false}
        />
      );
      expect(screen.queryByTestId("has-parameters-badge")).toBeNull();
    });
  });

  // The two shapes this component absorbed when the second case-name
  // component was folded into it: spelled-out props and a whole row.
  describe("case fields", () => {
    it("takes fields spelled out as props", () => {
      render(<CaseDisplay id={10} name="Flat case" hasParameters />);
      expect(screen.getAllByText("Flat case").length).toBeGreaterThan(0);
      expect(screen.getByTestId("has-parameters-badge")).toBeInTheDocument();
    });

    it("prefers a spelled-out prop over the same field on the row", () => {
      render(
        <CaseDisplay
          name="Explicit"
          testCase={{ id: 11, name: "From the row" }}
        />
      );
      expect(screen.getAllByText("Explicit").length).toBeGreaterThan(0);
      expect(screen.queryByText("From the row")).toBeNull();
    });

    it("falls back to the id when there is no name", () => {
      render(<CaseDisplay testCase={{ id: 12 }} fallbackPrefix="Case" />);
      expect(screen.getAllByText("Case 12").length).toBeGreaterThan(0);
    });
  });

  describe("destination", () => {
    it("links into the project repository when given a projectId", () => {
      const { container } = render(
        <CaseDisplay testCase={{ id: 20, name: "Linked" }} projectId={5} />
      );
      expect(container.querySelector("a")?.getAttribute("href")).toContain(
        "/projects/repository/5/20"
      );
    });

    it("prefers an explicit link over the derived one", () => {
      const { container } = render(
        <CaseDisplay
          id={21}
          name="Explicit link"
          projectId={5}
          link="/somewhere/else"
        />
      );
      expect(container.querySelector("a")?.getAttribute("href")).toContain(
        "/somewhere/else"
      );
    });

    it("renders no link without a destination", () => {
      const { container } = render(
        <CaseDisplay testCase={{ id: 22, name: "No destination" }} />
      );
      expect(container.querySelector("a")).toBeNull();
    });
  });

  describe("clamping", () => {
    it("truncates at one line and clamps beyond that", () => {
      const { container: one } = render(
        <CaseDisplay id={30} name="One line" maxLines={1} />
      );
      expect(one.querySelector(".truncate")).not.toBeNull();

      const { container: two } = render(
        <CaseDisplay id={31} name="Two lines" maxLines={2} />
      );
      expect(two.querySelector(".line-clamp-2")).not.toBeNull();
    });
  });
});

/**
 * Absorbing TestCaseNameDisplay meant inheriting two components' answers for
 * the empty case, and they disagreed. Both are still reachable, so both are
 * pinned here against the exact shapes the real call sites pass.
 */
describe("empty case, per the component it replaced", () => {
  it("renders nothing when fields are spelled out and there is no id", () => {
    // Report columns (useReportColumns, useIssueTestCoverageColumns,
    // useExecutionLogColumns) pass row.testCaseId unguarded; a row with no
    // case drew a blank cell and must keep doing so.
    const { container } = render(<CaseDisplay id={undefined} name={""} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when fields are spelled out and the id is zero", () => {
    const { container } = render(<CaseDisplay id={0} name="Some case" />);
    expect(container.textContent).toBe("");
  });

  it("falls back to the unknown label for a row with a zero id", () => {
    // useDrillDownColumns passes `id: … || 0` with `name: … || ""`.
    const { container } = render(
      <CaseDisplay testCase={{ id: 0, name: "" }} />
    );
    expect(container.textContent).toContain("unknown");
    expect(container.textContent).not.toContain("Case 0");
  });

  it("renders the unknown label for a missing row", () => {
    const { container } = render(<CaseDisplay testCase={null} />);
    expect(container.textContent).toContain("unknown");
  });

  it("does not link a row whose id is zero", () => {
    const { container } = render(
      <CaseDisplay testCase={{ id: 0, name: "Zero" }} projectId={5} />
    );
    expect(container.querySelector("a")).toBeNull();
  });
});

/**
 * The wrapper below carries `overflow-hidden`, which is what makes a long
 * name truncate instead of escaping its column inside a flex parent. Merging
 * the two components once dropped it from every call site, which no assertion
 * at the time would have caught.
 */
describe("truncation wrapper", () => {
  it("keeps overflow-hidden when fields are spelled out", () => {
    const { container } = render(
      <CaseDisplay id={40} name="Long name" maxLines={1} />
    );
    expect(container.querySelector(".overflow-hidden")).not.toBeNull();
  });

  it("keeps overflow-hidden for a whole row", () => {
    const { container } = render(
      <CaseDisplay testCase={{ id: 41, name: "Long name" }} />
    );
    expect(container.querySelector(".overflow-hidden")).not.toBeNull();
  });

  it("keeps overflow-hidden on a linked row", () => {
    const { container } = render(
      <CaseDisplay testCase={{ id: 42, name: "Long name" }} projectId={3} />
    );
    const anchor = container.querySelector("a");
    expect(anchor?.className).toContain("overflow-hidden");
  });
});
