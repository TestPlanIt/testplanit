"use client";

import { CheckCircle2 } from "lucide-react";
import type { JSX } from "react";

import { cn } from "~/utils";

export interface WizardStepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  labels?: string[];
  className?: string;
}

export function WizardStepIndicator({
  currentStep,
  totalSteps,
  labels,
  className,
}: WizardStepIndicatorProps): JSX.Element {
  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);

  return (
    <div
      className={cn("mb-4 flex shrink-0 items-center gap-2", className)}
      data-testid="wizard-step-indicator"
    >
      {steps.map((step) => {
        const isComplete = step < currentStep;
        const isActive = step === currentStep;
        const label = labels?.[step - 1];

        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium",
                  isComplete && "bg-primary text-primary-foreground",
                  isActive &&
                    "border-2 border-primary bg-primary/10 text-primary",
                  !isComplete && !isActive && "bg-muted text-muted-foreground"
                )}
                data-testid={`wizard-step-${step}`}
                data-active={isActive ? "true" : undefined}
              >
                {isComplete ? <CheckCircle2 className="h-4 w-4" /> : step}
              </div>
              {label !== undefined && (
                <span className="text-xs text-muted-foreground">{label}</span>
              )}
            </div>
            {step < totalSteps && (
              <div
                className={cn(
                  "mx-2 h-0.5 w-12",
                  isComplete ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
