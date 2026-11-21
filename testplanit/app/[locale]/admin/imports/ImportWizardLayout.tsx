"use client";

import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";
import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

export type StepStatus = "pending" | "active" | "completed";

export interface WizardStepDefinition {
  id: number;
  label: string;
  icon: LucideIcon;
}

interface SummaryTileProps {
  label: string;
  value: ReactNode;
  status?: "warning";
  hint?: ReactNode;
}

export function SummaryTile({ label, value, status, hint }: SummaryTileProps) {
  const containerClasses =
    status === "warning"
      ? "rounded-md border bg-card p-4 border-destructive/60 bg-destructive/5"
      : "rounded-md border bg-card p-4";
  const valueClasses =
    status === "warning"
      ? "mt-2 text-lg font-semibold text-destructive"
      : "mt-2 text-lg font-semibold text-foreground";
  const hintClasses =
    status === "warning"
      ? "mt-2 text-xs text-destructive"
      : "mt-2 text-xs text-muted-foreground";

  return (
    <div className={containerClasses}>
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className={valueClasses}>{value}</div>
      {hint ? <div className={hintClasses}>{hint}</div> : null}
    </div>
  );
}

interface StepSectionProps {
  stepNumber: number;
  title: string;
  status: StepStatus;
  statusLabel: string;
  description?: ReactNode;
  children: ReactNode;
}

export function StepSection({
  stepNumber,
  title,
  status,
  description,
  children,
}: StepSectionProps) {
  const indicatorClasses = (() => {
    switch (status) {
      case "completed":
        return "bg-primary text-primary-foreground";
      case "active":
        return "border-2 border-primary text-primary bg-background";
      default:
        return "bg-muted text-muted-foreground";
    }
  })();

  return (
    <section
      className={`space-y-4 rounded-md border p-4 ${
        status === "active"
          ? "border-primary shadow-sm"
          : status === "completed"
            ? "bg-muted/40"
            : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${indicatorClasses}`}
          >
            {status === "completed" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              stepNumber
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface WizardProgressProps {
  steps: WizardStepDefinition[];
  activeStep: number;
  maxUnlockedStep: number;
  onStepSelect?: (step: number) => void;
}

export function WizardProgress({
  steps,
  activeStep,
  maxUnlockedStep,
  onStepSelect,
}: WizardProgressProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {steps.map((step, index) => {
        const status: StepStatus =
          step.id === activeStep
            ? "active"
            : step.id < maxUnlockedStep
              ? "completed"
              : "pending";
        const Icon = step.icon;
        const isEnabled = step.id <= maxUnlockedStep;
        const indicatorClasses =
          status === "completed"
            ? "bg-muted-foreground/60 text-primary-foreground"
            : status === "active"
              ? "border-2 border-primary text-primary bg-background ring-offset-1 ring-offset-primary ring-1 ring-primary"
              : "bg-muted border-2 border-muted-foreground/20 text-muted-foreground";
        return (
          <div key={step.id} className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => isEnabled && onStepSelect?.(step.id)}
              disabled={!isEnabled}
              className={`flex items-center gap-2 rounded-full border border-primary/60 py-6 text-sm font-medium shadow-md transition ${
                isEnabled
                  ? "cursor-pointer text-foreground hover:bg-muted "
                  : "cursor-not-allowed border-muted-foreground/20 text-muted-foreground"
              }`}
            >
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full ${indicatorClasses}`}
              >
                {status === "completed" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </span>
              <span
                className={
                  status === "pending"
                    ? "text-muted-foreground"
                    : "text-foreground"
                }
              >
                {step.label}
              </span>
            </Button>
            {index < steps.length - 1 && (
              <div
                className={`hidden h-px w-12 sm:block ${
                  step.id < maxUnlockedStep
                    ? "animate-pulse bg-primary"
                    : "bg-muted"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
