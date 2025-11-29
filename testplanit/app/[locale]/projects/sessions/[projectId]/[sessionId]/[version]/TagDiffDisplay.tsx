import { TagsDisplay } from "@/components/tables/TagDisplay";
import { Minus, Plus } from "lucide-react";

interface TagDiffDisplayProps {
  tag: string;
  type: "added" | "removed" | "common";
  isFirstVersion?: boolean;
}

export function TagDiffDisplay({
  tag,
  type,
  isFirstVersion,
}: TagDiffDisplayProps) {
  let prefix: React.ReactNode = null;
  let bgColor = "";
  let paddingClass = "";

  if (isFirstVersion && type === "added") {
    type = "common";
  }

  switch (type) {
    case "added":
      prefix = (
        <span>
          <Plus className="w-4 h-4" />
        </span>
      );
      bgColor = "bg-green-100 text-green-600";
      paddingClass = "px-2 py-2";
      break;
    case "removed":
      prefix = (
        <span>
          <Minus className="w-4 h-4" />
        </span>
      );
      bgColor = "bg-red-100 text-red-600";
      paddingClass = "px-2 py-2";
      break;
    case "common":
      bgColor = "";
      paddingClass = "";
      break;
  }

  return (
    <div
      className={`flex font-extrabold items-center m-1 rounded ${bgColor} ${paddingClass}`}
    >
      {prefix && <span className="mr-1">{prefix}</span>}
      <TagsDisplay id={tag} name={tag} size="small" />
    </div>
  );
}
