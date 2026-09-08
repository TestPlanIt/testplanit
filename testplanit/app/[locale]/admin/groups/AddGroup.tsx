"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { HelpPopover } from "@/components/ui/help-popover";
import type { User } from "~/zenstack/models";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { invalidateModelQueries } from "~/utils/optimistic-updates";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Users } from "lucide-react";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { UserNameCell } from "@/components/tables/UserNameCell";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { isUniqueConstraintError } from "~/lib/utils/errors";

function buildAddGroupFormSchema(t: (key: any) => string) {
  return z.object({
    name: z.string().min(1, {
      error: t("common.errors.groupNameRequired"),
    }),
  });
}

type AddGroupFormData = z.infer<ReturnType<typeof buildAddGroupFormSchema>>;

interface AddGroupProps {
  open: boolean;
  onClose: () => void;
}

export function AddGroup({ open, onClose }: AddGroupProps) {
  const t = useTranslations("admin.groups");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assignedUsers, setAssignedUsers] = useState<User[]>([]);
  const queryClient = useQueryClient();

  const { mutateAsync: createGroup } =
    useClientQueries(schema).groups.useCreate();
  const { mutateAsync: createManyGroupAssignment } =
    useClientQueries(schema).groupAssignment.useCreateMany();
  const { data: allUsersData, isLoading: usersLoading } = useClientQueries(
    schema
  ).user.useFindMany({
    where: { isActive: true, isDeleted: false },
    orderBy: { name: "asc" },
  });

  const allUsers: User[] | undefined = allUsersData as User[] | undefined;

  const formSchema = useMemo(() => buildAddGroupFormSchema(tGlobal), [tGlobal]);
  const form = useForm<AddGroupFormData>({
    resolver: standardSchemaResolver(formSchema),
    defaultValues: {
      name: "",
    },
  });

  const {
    handleSubmit,
    control,
    setError,
    formState: { errors },
  } = form;

  const fetchUserOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.toLowerCase();
      const filtered = (allUsers ?? []).filter(
        (user) =>
          user.name.toLowerCase().includes(q) ||
          user.email?.toLowerCase().includes(q)
      );
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    [allUsers]
  );

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
        tCommon("messages.createdItem", {
          item: tGlobal("common.fields.groups"),
        })
      );
      onClose();
    } catch (err: any) {
      if (isUniqueConstraintError(err)) {
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
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
                    {tCommon("fields.groupName")}
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
                <Users className="w-4 h-4 me-1" />
                {tCommon("labels.assignedUsersCount", {
                  count: assignedUsers.length,
                })}
                <HelpPopover helpKey="group.users" />
              </FormLabel>
              <MultiAsyncCombobox<User>
                value={assignedUsers}
                onValueChange={setAssignedUsers}
                fetchOptions={fetchUserOptions}
                renderOption={(user) => (
                  <UserNameCell userId={user.id} hideLink />
                )}
                renderSelectedOption={(user) => <span>{user.name}</span>}
                getOptionValue={(user) => user.id}
                getOptionLabel={(user) => user.name}
                placeholder={tCommon("placeholders.select")}
                className="w-full"
                pageSize={20}
                showTotal
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
                onClick={onClose}
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
