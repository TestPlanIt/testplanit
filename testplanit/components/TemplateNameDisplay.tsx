import { LayoutTemplate } from "lucide-react";

export interface TemplateNameProps {
  name: string;
  /** "sm" matches WorkflowStateDisplay's small size, for pickers and badges. */
  size?: "sm" | "lg";
}

export const TemplateNameDisplay: React.FC<TemplateNameProps> = ({
  name,
  size = "lg",
}) => {
  if (!name) {
    return null;
  }

  return (
    <span className="flex items-center space-x-1 shrink-0 overflow-hidden">
      <LayoutTemplate
        className={`shrink-0 ${size === "sm" ? "h-4 w-4" : ""}`}
      />
      <span className={`truncate ${size === "sm" ? "text-sm" : ""}`}>
        {name}
      </span>
    </span>
  );
};
