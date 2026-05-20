import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Per-file next-intl mock: returns concrete English copy for the keys
// the component renders so tests assert on user-facing strings.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const dictionary: Record<string, string> = {
      configureButtonEmpty: "Configure parameters",
      configureButtonSet: "Parameters ({count})",
    };
    let value = dictionary[key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        value = value.replace(`{${k}}`, String(v));
      });
    }
    return value;
  },
}));

import { ConfigureParametersButton } from "@/components/parameters/ConfigureParametersButton";

describe("ConfigureParametersButton", () => {
  it("renders 'Configure parameters' label when parameterCount is 0 and canEdit is true", () => {
    render(
      <ConfigureParametersButton
        parameterCount={0}
        canEdit={true}
        onOpen={() => {}}
      />
    );
    const button = screen.getByTestId("configure-parameters-button");
    expect(button).toBeInTheDocument();
    expect(button.textContent).toContain("Configure parameters");
  });

  it("renders count-aware label when parameterCount > 0", () => {
    render(
      <ConfigureParametersButton
        parameterCount={3}
        canEdit={true}
        onOpen={() => {}}
      />
    );
    const button = screen.getByTestId("configure-parameters-button");
    expect(button.textContent).toContain("Parameters (3)");
  });

  it("renders an icon (Braces) inside the button", () => {
    render(
      <ConfigureParametersButton
        parameterCount={0}
        canEdit={true}
        onOpen={() => {}}
      />
    );
    const button = screen.getByTestId("configure-parameters-button");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("calls onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(
      <ConfigureParametersButton
        parameterCount={0}
        canEdit={true}
        onOpen={onOpen}
      />
    );
    fireEvent.click(screen.getByTestId("configure-parameters-button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when canEdit is false (PARAM-07 invariant)", () => {
    const { container } = render(
      <ConfigureParametersButton
        parameterCount={5}
        canEdit={false}
        onOpen={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("configure-parameters-button")).toBeNull();
  });
});
