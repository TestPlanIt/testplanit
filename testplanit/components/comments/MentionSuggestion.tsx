"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "~/utils";
import { Badge } from "~/components/ui/badge";
import { Avatar } from "~/components/Avatar";

export interface MentionUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  isProjectMember: boolean;
  isActive: boolean;
  isDeleted: boolean;
}

export interface MentionSuggestionProps {
  items: MentionUser[];
  command: (props: { id: string; label: string; image?: string | null }) => void;
}

export interface MentionSuggestionRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const MentionSuggestion = forwardRef<
  MentionSuggestionRef,
  MentionSuggestionProps
>((props, ref) => {
  const t = useTranslations("comments.mentions");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index: number) => {
    const item = props.items[index];

    if (item) {
      props.command({
        id: item.id,
        label: item.name || item.email,
        image: item.image,
      });
    }
  };

  const upHandler = () => {
    setSelectedIndex(
      (selectedIndex + props.items.length - 1) % props.items.length
    );
  };

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        upHandler();
        return true;
      }

      if (event.key === "ArrowDown") {
        downHandler();
        return true;
      }

      if (event.key === "Enter") {
        enterHandler();
        return true;
      }

      return false;
    },
  }));

  if (props.items.length === 0) {
    return (
      <div className="rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        {t("noUsersFound")}
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-popover shadow-md">
      {props.items.map((item, index) => {
        const displayName = item.name || item.email;

        return (
          <button
            key={item.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm group",
              "hover:bg-accent hover:text-accent-foreground",
              index === selectedIndex && "bg-accent text-accent-foreground"
            )}
            onClick={() => selectItem(index)}
          >
            <Avatar
              image={item.image}
              alt={displayName}
              width={24}
              height={24}
              showTooltip={false}
            />

            <div className="flex flex-1 flex-col min-w-0">
              <div className="flex items- justify-between gap-2 min-w-0">
                <span
                  className={cn(
                    "font-medium truncate",
                    !item.isProjectMember && "text-destructive"
                  )}
                >
                  {displayName}
                </span>
                {!item.isProjectMember && (
                  <Badge variant="destructive" className="shrink-0">
                    {t("notAMember")}
                  </Badge>
                )}
              </div>
              {item.name && (
                <span className={cn(
                  "text-xs truncate text-muted-foreground",
                  "group-hover:text-accent-foreground/70",
                  index === selectedIndex && "text-accent-foreground/70"
                )}>
                  {item.email}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
});

MentionSuggestion.displayName = "MentionSuggestion";
