import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WizardStepIndicator } from "~/components/ui/WizardStepIndicator";

describe("WizardStepIndicator", () => {
  it("marks the current step pill with data-active='true'", () => {
    render(<WizardStepIndicator currentStep={1} totalSteps={4} />);
    const step1 = screen.getByTestId("wizard-step-1");
    const step2 = screen.getByTestId("wizard-step-2");
    expect(step1.getAttribute("data-active")).toBe("true");
    expect(step2.getAttribute("data-active")).toBeNull();
  });

  it("renders a CheckCircle2 SVG inside completed pills (steps before currentStep)", () => {
    render(<WizardStepIndicator currentStep={3} totalSteps={4} />);
    const step1 = screen.getByTestId("wizard-step-1");
    const step2 = screen.getByTestId("wizard-step-2");
    const step3 = screen.getByTestId("wizard-step-3");
    const step4 = screen.getByTestId("wizard-step-4");

    // Completed steps contain an SVG (the CheckCircle2 icon).
    expect(step1.querySelector("svg")).not.toBeNull();
    expect(step2.querySelector("svg")).not.toBeNull();
    // Active step has no SVG.
    expect(step3.querySelector("svg")).toBeNull();
    expect(step3.getAttribute("data-active")).toBe("true");
    // Future step also has no SVG.
    expect(step4.querySelector("svg")).toBeNull();
    expect(step4.getAttribute("data-active")).toBeNull();
  });

  it("renders labels under each pill when labels prop is provided", () => {
    render(
      <WizardStepIndicator
        currentStep={2}
        totalSteps={4}
        labels={["Upload", "Map", "Preview", "Confirm"]}
      />
    );
    expect(screen.getByText("Upload")).toBeInTheDocument();
    expect(screen.getByText("Map")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
  });

  it("does not render labels when labels prop is omitted", () => {
    const { container } = render(
      <WizardStepIndicator currentStep={1} totalSteps={3} />
    );
    // Labels would be rendered as <span> siblings; assert none exist as
    // immediate text children of the wizard root with arbitrary text.
    const root = container.querySelector(
      "[data-testid='wizard-step-indicator']"
    );
    expect(root).not.toBeNull();
    // No <span> with text content exists alongside the pills.
    const labelSpans = root!.querySelectorAll(
      "span.text-xs.text-muted-foreground"
    );
    expect(labelSpans.length).toBe(0);
  });

  it("appends the className prop to the outer container", () => {
    render(
      <WizardStepIndicator
        currentStep={1}
        totalSteps={2}
        className="custom-cls"
      />
    );
    const root = screen.getByTestId("wizard-step-indicator");
    expect(root.className).toContain("custom-cls");
  });

  it("emits data-testid='wizard-step-indicator' and 'wizard-step-N' for each pill", () => {
    render(<WizardStepIndicator currentStep={2} totalSteps={5} />);
    expect(screen.getByTestId("wizard-step-indicator")).toBeInTheDocument();
    for (let n = 1; n <= 5; n++) {
      expect(screen.getByTestId(`wizard-step-${n}`)).toBeInTheDocument();
    }
  });
});
