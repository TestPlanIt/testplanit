import React from "react";
import { Link } from "~/lib/navigation";
import DynamicIcon from "@/components/DynamicIcon";
import { LinkIcon } from "lucide-react";

interface TestRunsTableDisplayProps {
  id: number;
  name: string;
  link: string;
  large?: boolean;
}

export const TestRunsTableDisplay: React.FC<TestRunsTableDisplayProps> = ({
  id,
  name,
  link,
  large,
}) => {
  return (
    <Link
      href={link}
      className="flex items-center gap-2 hover:text-primary group"
    >
      <DynamicIcon name="play-circle" className="h-4 w-4 shrink-0" />
      <span className="truncate">{name}</span>
      {large && (
        <LinkIcon className="w-4 h-4 inline ml-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      )}
    </Link>
  );
};
