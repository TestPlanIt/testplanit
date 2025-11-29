import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tag, TagIcon } from "lucide-react";
import { Link } from "~/lib/navigation";

interface TagsListModel {
  id: number;
  name: string;
}

interface TagsListProps {
  tags: null | TagsListModel[];
  projectId: number;
}

export const TagsListDisplay: React.FC<TagsListProps> = ({
  tags,
  projectId,
}) => {
  if (!tags || tags.length === 0) {
    return null;
  }
  null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Badge className="cursor-pointer">
          <TagIcon className="w-4 h-4 mr-1 shrink-0" />
          {tags.length}
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="flex flex-wrap">
        {tags.map((tag) => {
          return (
            <Badge
              key={tag.id}
              className="mr-1 mb-1 max-w-[250px] whitespace-nowrap flex items-center"
            >
              <Link
                href={`/projects/tags/${projectId}/${tag.id}`}
                className="truncate flex whitespace-nowrap"
              >
                <Tag className="w-4 h-4 shrink-0 mr-1" />
                <span className="truncate">{tag.name}</span>
              </Link>
            </Badge>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};
