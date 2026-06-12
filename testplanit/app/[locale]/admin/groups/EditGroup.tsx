"use client";
import { HelpPopover } from "@/components/ui/help-popover";
import { Groups, User } from "@prisma/client";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  useCreateManyGroupAssignment,
  useDeleteManyGroupAssignment,
  useFindManyGroupAssignment,
  useFindManyUser,
  useUpdateGroups,
} from "~/lib/hooks";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { UserNameCell } from "@/components/tables/UserNameCell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Cloud, Trash2, Users } from "lucide-react";

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
} from "@/components/ui/dialog";
import { toast } from "sonner";

import {
  type DowngradedUser,
  previewGroupMappingChange,
  saveMappingChange,
} from "~/app/actions/scimMappingActions";

interface EditGroupProps {
  group: Groups & { assignedUsers: { userId: string }[] };
  open: boolean;
  onClose: () => void;
}

function buildEditGroupFormSchema(t: (key: any) => string) {
  return z.object({
    name: z.string().min(1, {
      error: t("common.errors.groupNameRequired"),
    }),
    mappedAccess: z
      .enum(["ADMIN", "PROJECTADMIN", "USER", "NONE"])
      .nullable()
      .optional(),
  });
}

type EditGroupFormData = z.infer<ReturnType<typeof buildEditGroupFormSchema>>;

export function EditGroup({ group, open, onClose }: EditGroupProps) {
  const t = useTranslations("admin.groups");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedUsers, setAssignedUsers] = useState<User[]>([]);
  const [initialAssignedUserIds, setInitialAssignedUserIds] = useState<
    Set<string>
  >(new Set());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingFormData, setPendingFormData] =
    useState<EditGroupFormData | null>(null);
  const [downgradedUsers, setDowngradedUsers] = useState<DowngradedUser[]>([]);

  const { mutateAsync: updateGroup } = useUpdateGroups();
  const { data: allUsersData, isLoading: usersLoading } = useFindManyUser({
    where: { isActive: true, isDeleted: false },
    orderBy: { name: "asc" },
  });
  const { data: groupAssignments, isLoading: assignmentsLoading } =
    useFindManyGroupAssignment({ where: { groupId: group.id } });
  const { mutateAsync: createManyGroupAssignment } =
    useCreateManyGroupAssignment();
  const { mutateAsync: deleteManyGroupAssignment } =
    useDeleteManyGroupAssignment();

  const allUsers: User[] | undefined = allUsersData as User[] | undefined;

  // Initialize assignedUsers once both queries resolve. Component is mounted
  // fresh on each open by the parent, so this only runs once per edit cycle.
  useEffect(() => {
    if (allUsers && groupAssignments) {
      const currentAssignedIds = new Set(groupAssignments.map((a) => a.userId));
      const currentAssignedUsers = allUsers.filter((u) =>
        currentAssignedIds.has(u.id)
      );
      setAssignedUsers(currentAssignedUsers);
      setInitialAssignedUserIds(currentAssignedIds);
    }
  }, [allUsers, groupAssignments]);

  const formSchema = useMemo(
    () => buildEditGroupFormSchema(tGlobal),
    [tGlobal]
  );
  const form = useForm<EditGroupFormData>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      name: group.name,
      mappedAccess: group.mappedAccess ?? null,
    },
  });

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

  async function applyGroupUpdate(data: EditGroupFormData) {
    const newAccess = data.mappedAccess ?? null;
    if (newAccess !== (group.mappedAccess ?? null)) {
      const result = await saveMappingChange(group.id, newAccess);
      if (!result.success) throw new Error(result.error);
    }

    if (!isScimManaged) {
      await updateGroup({
        where: { id: group.id },
        data: {
          name: data.name,
        },
      });
    }

    const currentAssignedIds = new Set(assignedUsers.map((u) => u.id));
    const assignmentsToCreate = isScimManaged
      ? []
      : assignedUsers
          .filter((user) => !initialAssignedUserIds.has(user.id))
          .map((user) => ({ userId: user.id, groupId: group.id }));

    const assignmentsToDelete = isScimManaged
      ? []
      : Array.from(initialAssignedUserIds)
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
      onClose();
    }
  }

  async function onSubmit(data: EditGroupFormData) {
    setIsSubmitting(true);
    try {
      const newAccess = data.mappedAccess ?? null;
      if (newAccess !== (group.mappedAccess ?? null)) {
        const preview = await previewGroupMappingChange(group.id, newAccess);
        if (!preview.success) throw new Error(preview.error);
        if (preview.downgraded.length > 0) {
          setDowngradedUsers(preview.downgraded);
          setPendingFormData(data);
          setConfirmOpen(true);
          setIsSubmitting(false);
          return;
        }
      }
      await applyGroupUpdate(data);
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
  const isScimManaged = group.scimDisplayName !== null;

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[600px] lg:max-w-[700px]">
          <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{t("edit.title")}</DialogTitle>
                <DialogDescription>
                  {t("description.groupInfo")}
                </DialogDescription>
              </DialogHeader>
              {isScimManaged && (
                <Alert data-testid="scim-name-locked-alert">
                  <Cloud className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle>{t("scimNameLockedTitle")}</AlertTitle>
                  <AlertDescription>
                    {t("scimNameLockedDescription")}
                  </AlertDescription>
                </Alert>
              )}
              <FormField
                control={control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {tCommon("name")}
                      <HelpPopover helpKey="group.name" />
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={tCommon("placeholders.name")}
                        disabled={isScimManaged}
                        data-testid="edit-group-name-input"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="mappedAccess"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center">
                      {t("mappedAccessLabel")}
                      <HelpPopover helpKey="group.mappedAccess" />
                    </FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={(val) =>
                          field.onChange(val === "NONE" ? null : val)
                        }
                        value={field.value ?? "NONE"}
                      >
                        <SelectTrigger data-testid="mapped-access-select">
                          <SelectValue placeholder={t("mappedAccessSelect")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">
                            {t("mappedAccessNone")}
                          </SelectItem>
                          <SelectItem value="USER">
                            {tCommon("access.user")}
                          </SelectItem>
                          <SelectItem value="PROJECTADMIN">
                            {tCommon("access.projectAdmin")}
                          </SelectItem>
                          <SelectItem value="ADMIN">
                            {tCommon("access.admin")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
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
                        {!isScimManaged && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveUser(user.id)}
                            aria-label={tCommon("actions.delete")}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    ))}
                </div>
                {!isScimManaged && (
                  <Combobox
                    users={availableUsersToAdd}
                    showUnassigned={false}
                    onValueChange={handleAddUser}
                    placeholder={tCommon("placeholders.select")}
                    className="w-full"
                    disabled={isLoading}
                  />
                )}
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
                  onClick={onClose}
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("downgradeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("downgradeConfirmDescription", {
                count: downgradedUsers.length,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
            {downgradedUsers.map((u) => (
              <li
                key={u.userId}
                className="flex items-center justify-between gap-3"
              >
                <UserNameCell userId={u.userId} hideLink={true} />
                <span className="text-muted-foreground whitespace-nowrap">
                  {t("downgradeConfirmAccessChange", {
                    from: u.currentAccess,
                    to: u.newAccess,
                  })}
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsSubmitting(false)}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmOpen(false);
                if (pendingFormData) await applyGroupUpdate(pendingFormData);
              }}
            >
              {t("downgradeConfirmApplyAnyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
