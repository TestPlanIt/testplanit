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
      className={cn("flex items-center gap-2 mb-4 shrink-0", className)}
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
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                  isComplete && "bg-primary text-primary-foreground",
                  isActive &&
                    "bg-primary/10 text-primary border-2 border-primary",
                  !isComplete && !isActive && "bg-muted text-muted-foreground"
                )}
                data-testid={`wizard-step-${step}`}
                data-active={isActive ? "true" : undefined}
              >
                {isComplete ? <CheckCircle2 className="w-4 h-4" /> : step}
              </div>
              {label !== undefined && (
                <span className="text-xs text-muted-foreground">{label}</span>
              )}
            </div>
            {step < totalSteps && (
              <div
                className={cn(
                  "w-12 h-0.5 mx-2",
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
