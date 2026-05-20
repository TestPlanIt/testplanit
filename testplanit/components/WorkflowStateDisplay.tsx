import { MessageSquareWarning } from "lucide-react";
import { useTranslations } from "next-intl";

import { IconName } from "~/types/globals";

import DynamicIcon from "./DynamicIcon";

export interface WorkflowStateProps {
  state: {
    name: string;
    icon: { name: IconName };
    color: { value: string };
    /**
     * Optional. When true, the display renders a small warning glyph
     * after the state name to signal that transitioning *into* this
     * state requires an approved review. Hosted here so every surface
     * that renders a workflow state (banner pills, inbox columns,
     * dialog descriptions, select options) gets the same hint — the
     * information is useful even where it's not actionable.
     */
    requiresReview?: boolean | null;
  } | null;
  size?: "sm" | "lg";
}

export const WorkflowStateDisplay: React.FC<WorkflowStateProps> = ({
  state,
  size = "lg",
}) => {
  const t = useTranslations("reviews.transitionGate");

  if (!state) {
    return null;
  }

  return (
    <span className="flex items-center space-x-1 shrink-0 overflow-hidden">
      <DynamicIcon
        name={state.icon.name as IconName}
        className={`${size === "sm" ? "h-4 w-4" : "h-6 w-6"}`}
        style={{ color: state.color.value }}
      />
      <span className={`truncate ${size === "sm" ? "text-sm" : "text-md"}`}>
        {state.name}
      </span>
      {state.requiresReview && (
        <MessageSquareWarning
          className={`shrink-0 text-warning ${size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"}`}
          aria-label={t("gatedOptionBadge")}
        />
      )}
    </span>
  );
};
