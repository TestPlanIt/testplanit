"use client";
import { Roles, User } from "@prisma/client";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  useCreateManyGroupAssignment,
  useCreateManyProjectAssignment,
  useDeleteManyGroupAssignment,
  useDeleteManyProjectAssignment,
  useFindManyGroups,
  useFindManyProjects,
  useFindManyRoles,
} from "~/lib/hooks";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod/v4";

import { Avatar } from "@/components/Avatar";
import UploadAvatar from "@/components/UploadAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "next-themes";
import MultiSelect from "react-select";
import { getCustomStyles } from "~/styles/multiSelectStyles";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { CircleSlash2, Trash2 } from "lucide-react";

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
import { HelpPopover } from "@/components/ui/help-popover";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

interface ExtendedUser extends User {
  projects: { projectId: number }[];
  groups: { groupId: number }[];
}

interface EditUserProps {
  user: ExtendedUser;
  open: boolean;
  onClose: () => void;
}

export function EditUser({ user, open, onClose }: EditUserProps) {
  const t = useTranslations("admin.users.edit");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const tUserAvatar = useTranslations("users.avatar");
  const tUserEdit = useTranslations("users.profile.edit");
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showDeleteAvatarConfirm, setShowDeleteAvatarConfirm] = useState(false);

  // Define a Zod schema specifically for form validation
  const EditUserFormValidationSchema = z.object({
    name: z.string().min(1, {
      message: tGlobal("common.fields.validation.nameRequired"),
    }),
    email: z.email().min(1, {
      message: tGlobal("auth.signup.errors.emailRequired"),
    }),
    isActive: z.boolean(),
    access: z.enum(["ADMIN", "USER", "PROJECTADMIN", "NONE"]),
    roleId: z.number({
      error: (issue) =>
        issue.input === undefined ? "Role is required" : undefined,
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

  // Use the new form-specific validation schema
  const form = useForm<z.infer<typeof EditUserFormValidationSchema>>({
    resolver: zodResolver(EditUserFormValidationSchema),
    defaultValues: {
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      access: user.access,
      roleId: user.roleId,
      isApi: user.isApi,
      projects: user.projects.map((project) => project.projectId),
      groups: user.groups.map((group) => group.groupId),
    },
  });

  const {
    setValue,
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
      const apiPayload: UserUpdateApiPayload & { image?: string | null } = {
        name: data.name,
        email: data.email,
        isActive: data.isActive,
        isApi: data.isApi,
        access: data.access,
        roleId: data.roleId,
      };

      // Include avatar changes
      if (removeAvatar) {
        apiPayload.image = null;
      } else if (avatarUrl) {
        apiPayload.image = avatarUrl;
      }

      // Update user core data
      // Use dedicated update API endpoint instead of ZenStack
      // (ZenStack 2.21+ has issues with nested update operations)
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to update user");
      }

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

      onClose();
      setIsSubmitting(false);

      // Refetch all queries to refresh the table data immediately
      void queryClient.refetchQueries();
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("name", {
          type: "custom",
          message: tGlobal("common.errors.nameExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tGlobal("common.errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("title")}
              </DialogDescription>
            </DialogHeader>

            {/* Avatar management */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {tUserAvatar("changeProfilePicture")}
              </label>
              {showUpload ? (
                <div className="space-y-2">
                  <UploadAvatar
                    onUpload={(url) => {
                      setAvatarUrl(url);
                      setRemoveAvatar(false);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowUpload(false);
                      setAvatarUrl(null);
                    }}
                  >
                    {tCommon("cancel")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Avatar
                    image={removeAvatar ? null : (avatarUrl ?? user.image)}
                    alt={user.name}
                    width={48}
                    height={48}
                    showTooltip={false}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowUpload(true)}
                    >
                      {tUserAvatar("changeProfilePicture")}
                    </Button>
                    {(user.image || avatarUrl) && !removeAvatar && (
                      <Popover
                        open={showDeleteAvatarConfirm}
                        onOpenChange={setShowDeleteAvatarConfirm}
                      >
                        <PopoverTrigger asChild>
                          <Button type="button" variant="destructive" size="sm">
                            <Trash2 className="h-4 w-4" />
                            {tUserEdit("deleteAvatar")}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="max-w-md" side="bottom">
                          {tUserEdit("deleteAvatarConfirm")}
                          <div className="flex items-start justify-between gap-4 mt-2">
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => setShowDeleteAvatarConfirm(false)}
                            >
                              <CircleSlash2 className="h-4 w-4" />
                              {tCommon("cancel")}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              onClick={() => {
                                setRemoveAvatar(true);
                                setAvatarUrl(null);
                                setShowDeleteAvatarConfirm(false);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              {tUserEdit("deleteAvatar")}
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              )}
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("name")}
                    <HelpPopover helpKey="user.name" />
                  </FormLabel>
                  <FormControl>
                    <Input placeholder={tCommon("name")} {...field} />
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
                    {tCommon("fields.isActive")}
                    <HelpPopover helpKey="user.active" />
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="access"
              render={({ field: _field }) => (
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
                        render={({ field: { onChange: _onChange, value } }) => (
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
              render={({ field: _field }) => (
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
              render={({ field: _field }) => (
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
                        {"("}
                        {tCommon("fields.requiredForAdmin")}
                        {")"}
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
              <Button variant="outline" type="button" onClick={onClose}>
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="edit-user-submit-button"
              >
                {isSubmitting
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
