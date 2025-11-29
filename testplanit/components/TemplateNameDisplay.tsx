import { LayoutTemplate } from "lucide-react";

export interface TemplateNameProps {
  name: string;
}

export const TemplateNameDisplay: React.FC<TemplateNameProps> = ({ name }) => {
  if (!name) {
    return null;
  }

  return (
    <span className="flex items-center space-x-1 shrink-0 overflow-hidden">
      <LayoutTemplate className="text-primary" />
      <span className="truncate">{name}</span>
    </span>
  );
};
