import { useState } from "react";
import { useSession } from "next-auth/react";
import { useUpdateUser } from "~/lib/hooks";
import { User } from "@prisma/client";
import { useTranslations } from "next-intl";

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
  const { mutateAsync: updateUser } = useUpdateUser();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [openPopover, setOpenPopover] = useState(false);
  const t = useTranslations("users.avatar");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  async function onRemove() {
    setIsLoading(true);
    try {
      await updateUser({
        where: { id: user.id },
        data: {
          image: null,
        },
      });
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
              {tCommon("actions.cancel")}
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
