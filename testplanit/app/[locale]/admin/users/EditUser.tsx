"use client";
import React, { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  useUpdateUser,
  useCreateManyProjectAssignment,
  useFindManyProjects,
  useDeleteManyProjectAssignment,
  useCreateManyGroupAssignment,
  useFindManyGroups,
  useDeleteManyGroupAssignment,
  useFindManyRoles,
} from "~/lib/hooks";
import { User, Roles } from "@prisma/client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller, useWatch } from "react-hook-form";
import { z } from "zod/v4";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";
import { useTheme } from "next-themes";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
} from "@/components/ui/select";

import { SquarePen } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";
import { HelpPopover } from "@/components/ui/help-popover";

interface ExtendedUser extends User {
  projects: { projectId: number }[];
  groups: { groupId: number }[];
}

interface EditUserModalProps {
  user: ExtendedUser;
}

export function EditUserModal({ user }: EditUserModalProps) {
  const t = useTranslations("admin.users.edit");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Define a Zod schema specifically for form validation
  const EditUserFormValidationSchema = z.object({
    name: z.string().min(1, {
      message: tGlobal("common.fields.validation.nameRequired"),
    }),
    email: z.email()
      .min(1, {
        message: tGlobal("auth.signup.errors.emailRequired"),
      }),
    isActive: z.boolean(),
    access: z.enum(["ADMIN", "USER", "PROJECTADMIN", "NONE"]),
    roleId: z.number({
        error: (issue) => issue.input === undefined ? "Role is required" : undefined
    }),
    isApi: z.boolean(),
    projects: z.array(z.number()).optional(),
    groups: z.array(z.number()).optional(),
  });

  // Type for the data expected by the updateUser API
  type UserUpdateApiPayload = Omit<
    z.infer<typeof EditUserFormValidationSchema>,
    "projects" | "groups"
  >;

  // Hooks for API calls
  const { mutateAsync: updateUser } = useUpdateUser();
  const { mutateAsync: createManyProjectAssignment } =
    useCreateManyProjectAssignment();
  const { mutateAsync: deleteManyProjectAssignment } =
    useDeleteManyProjectAssignment();
  const { mutateAsync: createManyGroupAssignment } =
    useCreateManyGroupAssignment();
  const { mutateAsync: deleteManyGroupAssignment } =
    useDeleteManyGroupAssignment();
  const { data: session } = useSession();

  // Theme the MultiSelect component
  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });

  // Fetch data for dropdowns/multiselects
  const { data: allRoles } = useFindManyRoles({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });
  const roleOptions = allRoles
    ? allRoles.map((role: Roles) => ({
        value: role.id,
        label: role.name,
      }))
    : [];

  const { data: projects } = useFindManyProjects({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });
  const projectOptions = projects
    ? projects.map((project) => ({
        value: project.id,
        label: project.name,
      }))
    : [];
  const selectAllProjects = () => {
    const allProjectIds = projectOptions.map((option) => option.value);
    setValue("projects", allProjectIds);
  };

  const { data: groups } = useFindManyGroups({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });
  const groupOptions = groups
    ? groups.map((group) => ({
        value: group.id,
        label: group.name,
      }))
    : [];
  const selectAllGroups = () => {
    const allGroupIds = groupOptions.map((option) => option.value);
    setValue("groups", allGroupIds);
  };

  const handleCancel = () => setOpen(false);

  // Calculate default values based on the user prop
  const defaultFormValues = useMemo(
    () => ({
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      access: user.access,
      roleId: user.roleId,
      isApi: user.isApi,
      projects: user.projects.map((project) => project.projectId),
      groups: user.groups.map((group) => group.groupId),
    }),
    [user]
  );

  // Use the new form-specific validation schema
  const form = useForm<z.infer<typeof EditUserFormValidationSchema>>({
    resolver: zodResolver(EditUserFormValidationSchema),
    defaultValues: defaultFormValues,
  });

  // Reset form when dialog opens or default values change
  useEffect(() => {
    if (open) {
      form.reset(defaultFormValues);
    }
  }, [open, defaultFormValues, form]);

  const {
    setValue,
    handleSubmit,
    control,
    formState: { errors },
  } = form;

  // Watch access field for conditional rendering (useWatch is safe for render)
  const accessValue = useWatch({ control, name: "access" });

  // Update onSubmit to use the form validation schema type and construct API payload
  async function onSubmit(data: z.infer<typeof EditUserFormValidationSchema>) {
    setIsSubmitting(true);
    try {
      // Construct payload matching UserUpdateInput for the API
      const apiPayload: UserUpdateApiPayload = {
        name: data.name,
        email: data.email,
        isActive: data.isActive,
        isApi: data.isApi,
        access: data.access,
        roleId: data.roleId,
      };

      // Update user core data
      await updateUser({
        where: { id: user.id },
        data: apiPayload,
      });

      // --- Handle Project Assignments ---  (No change needed here, logic seems correct)
      const initialProjectIds = new Set(user.projects.map((p) => p.projectId));
      const currentProjectIds = new Set(data.projects || []);

      const projectsToDelete = [...initialProjectIds].filter(
        (id) => !currentProjectIds.has(id)
      );
      const projectsToAdd = [...currentProjectIds].filter(
        (id) => !initialProjectIds.has(id)
      );

      if (projectsToDelete.length > 0) {
        await deleteManyProjectAssignment({
          where: {
            userId: user.id,
            projectId: { in: projectsToDelete },
          },
        });
      }
      if (projectsToAdd.length > 0) {
        await createManyProjectAssignment({
          data: projectsToAdd.map((projectId) => ({
            userId: user.id,
            projectId: projectId,
          })),
        });
      }

      // --- Handle Group Assignments --- (No change needed here, logic seems correct)
      const initialGroupIds = new Set(user.groups.map((g) => g.groupId));
      const currentGroupIds = new Set(data.groups || []);

      const groupsToDelete = [...initialGroupIds].filter(
        (id) => !currentGroupIds.has(id)
      );
      const groupsToAdd = [...currentGroupIds].filter(
        (id) => !initialGroupIds.has(id)
      );

      if (groupsToDelete.length > 0) {
        await deleteManyGroupAssignment({
          where: {
            userId: user.id,
            groupId: { in: groupsToDelete },
          },
        });
      }
      if (groupsToAdd.length > 0) {
        await createManyGroupAssignment({
          data: groupsToAdd.map((groupId) => ({
            userId: user.id,
            groupId: groupId,
          })),
        });
      }

      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: tGlobal("common.errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tGlobal("milestones.errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <SquarePen className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("title")}
              </DialogDescription>
            </DialogHeader>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.name")}
                    <HelpPopover helpKey="user.name" />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={tCommon("fields.name")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.email")}
                    <HelpPopover helpKey="user.email" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={tCommon("fields.email")}
                      className="resize-none"
                      maxLength={256}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      disabled={user.id === session?.user.id}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <FormLabel className="flex items-center">
                    {tCommon("status.active")}
                    <HelpPopover helpKey="user.active" />
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="access"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormLabel className="flex whitespace-nowrap items-center">
                    {tCommon("fields.access")}
                    <HelpPopover helpKey="user.access" />
                    <FormControl>
                      <Controller
                        control={control}
                        name="access"
                        render={({ field: { onChange, value } }) => (
                          <Select
                            onValueChange={(newValue) => {
                              onChange(newValue);
                              // Auto-enable isApi for ADMIN users
                              if (newValue === "ADMIN") {
                                setValue("isApi", true);
                              }
                            }}
                            value={value}
                            disabled={user?.id === session?.user?.id}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={tCommon("fields.access")}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value="ADMIN">
                                  {tCommon("access.admin")}
                                </SelectItem>
                                <SelectItem value="PROJECTADMIN">
                                  {tCommon("access.projectAdmin")}
                                </SelectItem>
                                <SelectItem value="USER">
                                  {tCommon("access.user")}
                                </SelectItem>
                                <SelectItem value="NONE">
                                  {tCommon("access.none")}
                                </SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </FormControl>
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormLabel className="flex whitespace-nowrap items-center">
                    {tCommon("fields.role")}
                    <HelpPopover helpKey="user.role" />
                    <FormControl>
                      <Controller
                        control={control}
                        name="roleId"
                        render={({ field: { onChange, value } }) => (
                          <Select
                            onValueChange={(value) =>
                              field.onChange(parseInt(value))
                            }
                            value={value?.toString()}
                            disabled={user?.id === session?.user?.id}
                          >
                            <SelectTrigger>
                              <SelectValue
                                placeholder={tCommon("fields.role")}
                              />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {roleOptions.map((role) => (
                                  <SelectItem
                                    key={role.value}
                                    value={role.value.toString()}
                                  >
                                    {role.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </FormControl>
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="groups"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex justify-between">
                    <div className="flex items-center">
                      <div>{tCommon("fields.groups")}</div>
                      <HelpPopover helpKey="user.groups" />
                    </div>
                    <div
                      onClick={selectAllGroups}
                      style={{ cursor: "pointer" }}
                    >
                      {tCommon("actions.selectAll")}
                    </div>
                  </FormLabel>{" "}
                  <FormControl>
                    <Controller
                      control={control}
                      name="groups"
                      render={({ field }) => (
                        <MultiSelect
                          {...field}
                          isMulti
                          maxMenuHeight={300}
                          className="w-[445px] sm:w-[550px] lg:w-[950px]"
                          classNamePrefix="select"
                          styles={customStyles}
                          options={groupOptions}
                          onChange={(selected: any) => {
                            const value = selected
                              ? selected.map((option: any) => option.value)
                              : [];
                            field.onChange(value);
                          }}
                          value={groupOptions.filter((option) =>
                            field.value?.includes(option.value)
                          )}
                        />
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="projects"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex justify-between">
                    <div className="flex items-center">
                      <div>{tCommon("fields.projects")}</div>
                      <HelpPopover helpKey="user.projects" />
                    </div>

                    <div
                      onClick={selectAllProjects}
                      style={{ cursor: "pointer" }}
                    >
                      {tCommon("actions.selectAll")}
                    </div>
                  </FormLabel>{" "}
                  <FormControl>
                    <Controller
                      control={control}
                      name="projects"
                      render={({ field }) => (
                        <MultiSelect
                          {...field}
                          isMulti
                          maxMenuHeight={300}
                          className="w-[445px] sm:w-[550px] lg:w-[950px]"
                          classNamePrefix="select"
                          styles={customStyles}
                          options={projectOptions}
                          onChange={(selected: any) => {
                            const value = selected
                              ? selected.map((option: any) => option.value)
                              : [];
                            field.onChange(value);
                          }}
                          value={projectOptions.filter((option) =>
                            field.value?.includes(option.value)
                          )}
                        />
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isApi"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={accessValue === "ADMIN"}
                    />
                  </FormControl>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.apiAccess")}
                    {accessValue === "ADMIN" && (
                      <span className="text-muted-foreground text-xs ml-2">
                        {"("}{tCommon("fields.requiredForAdmin")}{")"}
                      </span>
                    )}
                    <HelpPopover helpKey="user.api" />
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              {errors.root && (
                <div
                  className=" bg-destructive text-destructive-foreground text-sm p-2"
                  role="alert"
                >
                  {errors.root.message}
                </div>
              )}
              <Button variant="outline" type="button" onClick={handleCancel}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? tCommon("status.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
