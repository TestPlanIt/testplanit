"use client";
import { useState, useEffect, useMemo } from "react";
import {
  useUpdateGroups,
  useFindManyUser,
  useFindManyGroupAssignment,
  useCreateManyGroupAssignment,
  useDeleteManyGroupAssignment,
} from "~/lib/hooks";
import { Groups, User } from "@prisma/client";
import { useTranslations } from "next-intl";
import { HelpPopover } from "@/components/ui/help-popover";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { UserNameCell } from "@/components/tables/UserNameCell";

import { SquarePen, Trash2, Users } from "lucide-react";

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
import { toast } from "sonner";

interface EditGroupModalProps {
  group: Groups & { assignedUsers: { userId: string }[] };
}

const EditGroupFormSchema = z.object({
  name: z.string().min(1, {
      error: "Group Name is required"
}),
});

type EditGroupFormData = z.infer<typeof EditGroupFormSchema>;

export function EditGroupModal({ group }: EditGroupModalProps) {
  const t = useTranslations("admin.groups");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedUsers, setAssignedUsers] = useState<User[]>([]);
  const [initialAssignedUserIds, setInitialAssignedUserIds] = useState<
    Set<string>
  >(new Set());

  const { mutateAsync: updateGroup } = useUpdateGroups();
  const { data: allUsersData, isLoading: usersLoading } = useFindManyUser(
    {
      where: { isActive: true, isDeleted: false },
      orderBy: { name: "asc" },
    },
    { enabled: open }
  );
  const { data: groupAssignments, isLoading: assignmentsLoading } =
    useFindManyGroupAssignment(
      { where: { groupId: group.id } },
      { enabled: open }
    );
  const { mutateAsync: createManyGroupAssignment } =
    useCreateManyGroupAssignment();
  const { mutateAsync: deleteManyGroupAssignment } =
    useDeleteManyGroupAssignment();

  const allUsers: User[] | undefined = allUsersData as User[] | undefined;

  useEffect(() => {
    if (open && allUsers && groupAssignments) {
      const currentAssignedIds = new Set(groupAssignments.map((a) => a.userId));
      const currentAssignedUsers = allUsers.filter((u) =>
        currentAssignedIds.has(u.id)
      );
      setAssignedUsers(currentAssignedUsers);
      setInitialAssignedUserIds(currentAssignedIds);
    } else if (!open) {
      setAssignedUsers([]);
      setInitialAssignedUserIds(new Set());
    }
  }, [open, allUsers, groupAssignments]);

  const defaultFormValues = useMemo(
    () => ({
      name: group.name,
    }),
    [group.name]
  );

  const form = useForm<EditGroupFormData>({
    resolver: zodResolver(EditGroupFormSchema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open) {
      form.reset(defaultFormValues);
    }
  }, [open, defaultFormValues, form]);

  const {
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

  async function onSubmit(data: EditGroupFormData) {
    setIsSubmitting(true);
    try {
      await updateGroup({
        where: { id: group.id },
        data: {
          name: data.name,
        },
      });

      const currentAssignedIds = new Set(assignedUsers.map((u) => u.id));
      const assignmentsToCreate = assignedUsers
        .filter((user) => !initialAssignedUserIds.has(user.id))
        .map((user) => ({ userId: user.id, groupId: group.id }));

      const assignmentsToDelete = Array.from(initialAssignedUserIds)
        .filter((userId) => !currentAssignedIds.has(userId))
        .map((userId) => ({ userId, groupId: group.id }));

      let assignmentErrors = false;
      if (assignmentsToCreate.length > 0) {
        try {
          await createManyGroupAssignment({ data: assignmentsToCreate });
        } catch (err) {
          console.error("Failed to create group assignments:", err);
          assignmentErrors = true;
        }
      }
      if (assignmentsToDelete.length > 0) {
        try {
          await deleteManyGroupAssignment({
            where: {
              OR: assignmentsToDelete.map((a) => ({
                userId: a.userId,
                groupId: a.groupId,
              })),
            },
          });
        } catch (err) {
          console.error("Failed to delete group assignments:", err);
          assignmentErrors = true;
        }
      }

      if (assignmentErrors) {
        toast.error(tCommon("messages.updateError"));
      } else {
        toast.success(tCommon("messages.updateSuccess"));
        setOpen(false);
      }
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        setError("name", {
          type: "custom",
          message: t("add.errors.nameExists"),
        });
      } else {
        console.error("Failed to update group:", err);
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

  const isLoading = usersLoading || assignmentsLoading;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="icon">
          <SquarePen className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[700px]">
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("edit.title")}</DialogTitle>
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
                    {tCommon("fields.name")}
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
                {isLoading && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    {tCommon("loading")}
                  </p>
                )}
                {!isLoading && assignedUsers.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    {t("noUsersAssigned")}
                  </p>
                )}
                {!isLoading &&
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
                  ))}
              </div>
              <Combobox
                users={availableUsersToAdd}
                showUnassigned={false}
                onValueChange={handleAddUser}
                placeholder={tCommon("placeholders.select")}
                className="w-full"
                disabled={isLoading}
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
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting || isLoading}>
                {isSubmitting || isLoading
                  ? tCommon("actions.saving")
                  : tCommon("actions.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
