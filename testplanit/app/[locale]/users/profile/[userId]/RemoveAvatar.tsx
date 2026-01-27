import { useState } from "react";
import { useSession } from "next-auth/react";
import { User } from "@prisma/client";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Trash2, X, CircleSlash2 } from "lucide-react";

interface RemoveAvatarProps {
  user: User;
}

export function RemoveAvatar({ user }: RemoveAvatarProps) {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [openPopover, setOpenPopover] = useState(false);
  const { update: updateSession } = useSession();
  const queryClient = useQueryClient();
  const t = useTranslations("users.avatar");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  async function onRemove() {
    setIsLoading(true);
    try {
      // Use dedicated update API endpoint instead of ZenStack
      // (ZenStack 2.21+ has issues with nested update operations)
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to remove avatar");
      }

      // Update the session to reflect the removed avatar
      await updateSession();

      // Refetch all queries to refresh UI with removed avatar
      queryClient.refetchQueries();
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
      setOpenPopover(false);
    }
  }

  return (
    <Popover open={openPopover} onOpenChange={setOpenPopover}>
      <PopoverTrigger asChild>
        <Button
          id="remove-avatar"
          variant="destructive"
          className="p-0 h-6 w-6"
          disabled={isLoading}
        >
          <X className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-fit" side="bottom">
        {tGlobal("users.profile.edit.deleteAvatarConfirm", {
          name: tCommon("fields.avatar"),
        })}
        <div className="flex items-start justify-between gap-4 mt-2">
          <div className="flex items-center mb-2">
            <Button
              type="button"
              variant="secondary"
              className="ml-auto"
              onClick={() => setOpenPopover(false)}
              disabled={isLoading}
            >
              <CircleSlash2 className="h-4 w-4 mr-1" />{" "}
              {tCommon("cancel")}
            </Button>
          </div>
          <div className="flex items-center">
            <Button
              type="button"
              variant="destructive"
              onClick={onRemove}
              className="ml-auto"
              disabled={isLoading}
            >
              <Trash2 className="h-4 w-4 mr-1" /> {tCommon("actions.delete")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
