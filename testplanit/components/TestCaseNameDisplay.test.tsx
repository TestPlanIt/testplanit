import { describe, expect, it } from "vitest";
import { render, screen } from "~/test/test-utils";
import { TestCaseNameDisplay } from "./TestCaseNameDisplay";

describe("TestCaseNameDisplay", () => {
  describe("hasParameters corner badge", () => {
    it("does NOT render the badge when hasParameters is false", () => {
      render(
        <TestCaseNameDisplay
          testCase={{ id: 1, name: "Plain manual case", hasParameters: false }}
        />
      );
      expect(screen.queryByTestId("has-parameters-badge")).toBeNull();
    });

    it("does NOT render the badge when hasParameters is omitted", () => {
      render(
        <TestCaseNameDisplay
          testCase={{ id: 2, name: "Legacy case payload" }}
        />
      );
      expect(screen.queryByTestId("has-parameters-badge")).toBeNull();
    });

    it("renders the badge when hasParameters is true on a manual case", () => {
      render(
        <TestCaseNameDisplay
          testCase={{ id: 3, name: "Manual params", hasParameters: true }}
        />
      );
      expect(screen.getByTestId("has-parameters-badge")).toBeInTheDocument();
    });

    it("renders the badge when hasParameters is true on an automated case", () => {
      render(
        <TestCaseNameDisplay
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
        <TestCaseNameDisplay
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
        <TestCaseNameDisplay
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
        <TestCaseNameDisplay
          testCase={{ id: 7, name: "No icon", hasParameters: true }}
          showIcon={false}
        />
      );
      expect(screen.queryByTestId("has-parameters-badge")).toBeNull();
    });
  });
});
