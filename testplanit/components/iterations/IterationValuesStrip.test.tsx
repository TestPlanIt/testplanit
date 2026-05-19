import { describe, expect, it } from "vitest";

import { render, screen } from "~/test/test-utils";

import { IterationValuesStrip } from "./IterationValuesStrip";
import type { IterationParameterMeta } from "./types";

const parametersSchema: IterationParameterMeta[] = [
  { name: "username", type: "STRING", order: 0 },
  { name: "password", type: "STRING", order: 1, sensitive: true },
  { name: "count", type: "INTEGER", order: 2 },
];

describe("IterationValuesStrip", () => {
  it("renders nothing when valuesJson is empty", () => {
    const { container } = render(
      <IterationValuesStrip
        valuesJson={null}
        snapshotRow={null}
        parametersSchema={parametersSchema}
      />
    );
    expect(
      container.querySelector('[data-testid="iteration-values-strip"]')
    ).toBeNull();
  });

  it("renders a chip per parameter and masks sensitive ones", () => {
    render(
      <IterationValuesStrip
        valuesJson={{ username: "alice", password: "hunter2", count: 7 }}
        snapshotRow={{ username: "alice", password: "hunter2", count: 7 }}
        parametersSchema={parametersSchema}
      />
    );
    expect(screen.getByTestId("iteration-values-strip")).toBeInTheDocument();
    expect(
      screen.getByTestId("iteration-values-chip-username").textContent
    ).toContain("alice");
    const passwordChip = screen.getByTestId("iteration-values-chip-password");
    expect(passwordChip.textContent).toContain("••••••");
    expect(passwordChip.textContent).not.toContain("hunter2");
    expect(
      screen.getByTestId("iteration-values-chip-count").textContent
    ).toContain("7");
  });

  it("shows the Overridden badge when value differs from snapshot", () => {
    render(
      <IterationValuesStrip
        valuesJson={{ username: "bob", password: "hunter2", count: 7 }}
        snapshotRow={{ username: "alice", password: "hunter2", count: 7 }}
        parametersSchema={parametersSchema}
      />
    );
    expect(
      screen.getByTestId("iteration-values-chip-username-overridden")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("iteration-values-chip-username")
    ).toHaveAttribute("data-overridden", "true");
    // Untouched chips have no overridden badge
    expect(
      screen.queryByTestId("iteration-values-chip-password-overridden")
    ).toBeNull();
  });

  it("does not show the Overridden badge when snapshotRow is missing", () => {
    render(
      <IterationValuesStrip
        valuesJson={{ username: "alice" }}
        snapshotRow={null}
        parametersSchema={parametersSchema}
      />
    );
    expect(
      screen.queryByTestId("iteration-values-chip-username-overridden")
    ).toBeNull();
  });
});
