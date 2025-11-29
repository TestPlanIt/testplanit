import DynamicIcon from "./DynamicIcon";
import { IconName } from "~/types/globals";

export interface WorkflowStateProps {
  state: {
    name: string;
    icon: { name: IconName };
    color: { value: string };
  } | null;
  size?: "sm" | "lg";
}

export const WorkflowStateDisplay: React.FC<WorkflowStateProps> = ({
  state,
  size = "lg",
}) => {
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
    </span>
  );
};
