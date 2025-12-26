"use client";
import { useState } from "react";
import {
  useCreateGroups,
  useFindManyUser,
  useCreateManyGroupAssignment,
} from "~/lib/hooks";
import { useTranslations } from "next-intl";
import { User } from "@prisma/client";
import { HelpPopover } from "@/components/ui/help-popover";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateModelQueries } from "~/utils/optimistic-updates";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { CirclePlus, Trash2, Users } from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Combobox } from "@/components/ui/combobox";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { toast } from "sonner";

const AddGroupFormSchema = z.object({
  name: z.string().min(1, {
    error: "Group Name is required",
  }),
});

type AddGroupFormData = z.infer<typeof AddGroupFormSchema>;

export function AddGroupModal() {
  const t = useTranslations("admin.groups");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedUsers, setAssignedUsers] = useState<User[]>([]);
  const queryClient = useQueryClient();

  const { mutateAsync: createGroup } = useCreateGroups();
  const { mutateAsync: createManyGroupAssignment } =
    useCreateManyGroupAssignment();
  const { data: allUsersData, isLoading: usersLoading } = useFindManyUser(
    {
      where: { isActive: true, isDeleted: false },
      orderBy: { name: "asc" },
    },
    { enabled: open }
  );

  const allUsers: User[] | undefined = allUsersData as User[] | undefined;

  const handleCancel = () => {
    setAssignedUsers([]);
    setOpen(false);
  };

  const form = useForm<AddGroupFormData>({
    resolver: zodResolver(AddGroupFormSchema),
    defaultValues: {
      name: "",
    },
  });

  const {
    reset,
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = form;

  const handleAddUser = (userId: string | null) => {
    if (!userId || !allUsers) return;
    const userToAdd = allUsers.find((u) => u.id === userId);
    if (userToAdd && !assignedUsers.some((u) => u.id === userId)) {
      setAssignedUsers((prev) => [...prev, userToAdd]);
    }
  };

  const handleRemoveUser = (userId: string) => {
    setAssignedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  async function onSubmit(data: AddGroupFormData) {
    setIsSubmitting(true);
    let newGroupId: number | undefined = undefined;
    try {
      const newGroup = await createGroup({
        data: {
          name: data.name,
        },
      });
      newGroupId = newGroup?.id;

      if (!newGroupId) {
        throw new Error("Group creation failed, no ID returned.");
      }

      const assignedUserIds = assignedUsers.map((u) => u.id);
      if (assignedUserIds.length > 0) {
        await createManyGroupAssignment({
          data: assignedUserIds.map((userId) => ({
            userId: userId,
            groupId: newGroupId!,
          })),
        });
      }

      // Invalidate queries to show the new group in the list
      await invalidateModelQueries(queryClient, "Groups");

      toast.success(
        tCommon("messages.created", { item: tGlobal("common.fields.groups") })
      );
      setOpen(false);
      reset({ name: "" });
      setAssignedUsers([]);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        setError("name", {
          type: "custom",
          message: t("add.errors.nameExists"),
        });
      } else {
        console.error("Failed to create group or assign users:", err);
        setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
        toast.error(tCommon("errors.unknown"));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const availableUsersToAdd =
    allUsers?.filter((u) => !assignedUsers.some((a) => a.id === u.id)) ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CirclePlus className="w-4 mr-1" />
          <span className="hidden md:inline">{t("add.button")}</span>
          <span className="md:hidden">{tCommon("add")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[700px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("add.title")}</DialogTitle>
              <DialogDescription>
                {t("description.groupInfo")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tGlobal("sharedSteps.manualEntry.groupNameLabel")}
                    <HelpPopover helpKey="group.name" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={tCommon("placeholders.name")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2 pt-4 border-t">
              <FormLabel className="flex items-center">
                <Users className="w-4 h-4 mr-1" />
                {tCommon("labels.assignedUsersCount", {
                  count: assignedUsers.length,
                })}
                <HelpPopover helpKey="group.users" />
              </FormLabel>
              <div className="space-y-2 max-h-48 overflow-y-auto rounded-md border p-2">
                {assignedUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    {t("noUsersSelected")}
                  </p>
                ) : (
                  assignedUsers.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center justify-between px-2 bg-muted rounded"
                    >
                      <UserNameCell userId={user.id} hideLink={true} />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveUser(user.id)}
                        aria-label={tCommon("actions.delete")}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
              <Combobox
                users={availableUsersToAdd}
                showUnassigned={false}
                onValueChange={handleAddUser}
                placeholder={tCommon("placeholders.select")}
                className="w-full"
              />
            </div>

            <DialogFooter>
              {errors.root && (
                <div
                  className="bg-destructive text-destructive-foreground text-sm p-2 rounded"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <Button
                variant="outline"
                type="button"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting || usersLoading}>
                {isSubmitting || usersLoading
                  ? tCommon("actions.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
