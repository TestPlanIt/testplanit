"use client";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import type { Roles, User } from "~/zenstack/models";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod/v4";

import { Avatar } from "@/components/Avatar";
import UploadAvatar from "@/components/UploadAvatar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectIcon } from "@/components/ProjectIcon";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Badge } from "@/components/ui/badge";
import { CircleSlash2, Cloud, ShieldAlert, Trash2 } from "lucide-react";

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
import { isUniqueConstraintError } from "~/lib/utils/errors";

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
  const tAdmin = useTranslations("admin.users");
  const tUserAvatar = useTranslations("users.avatar");
  const tUserEdit = useTranslations("users.profile.edit");
  // SCIM-managed users have IdP-owned identity fields. Lock those fields in
  // the UI; the schema enforces the same via @deny rules so non-UI paths
  // (API tokens, direct REST) can't bypass.
  const isScimManaged = user.scimGivenName !== null;
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

  // Type for the data expected by the updateUser API. For SCIM-managed
  // users, name/email/isActive are omitted from the payload at submit time.
  type UserUpdateApiPayload = Partial<
    Pick<
      z.infer<typeof EditUserFormValidationSchema>,
      "name" | "email" | "isActive"
    >
  > &
    Omit<
      z.infer<typeof EditUserFormValidationSchema>,
      "name" | "email" | "isActive" | "projects" | "groups"
    >;

  // Hooks for API calls
  const { mutateAsync: createManyProjectAssignment } =
    useClientQueries(schema).projectAssignment.useCreateMany();
  const { mutateAsync: deleteManyProjectAssignment } =
    useClientQueries(schema).projectAssignment.useDeleteMany();
  const { mutateAsync: createManyGroupAssignment } =
    useClientQueries(schema).groupAssignment.useCreateMany();
  const { mutateAsync: deleteManyGroupAssignment } =
    useClientQueries(schema).groupAssignment.useDeleteMany();
  const { data: session } = useSession();

  // Fetch data for dropdowns/multiselects
  const { data: allRoles } = useClientQueries(schema).roles.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });
  const roleOptions = allRoles
    ? allRoles.map((role: Roles) => ({
        value: role.id,
        label: role.name,
      }))
    : [];

  const { data: projects } = useClientQueries(schema).projects.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });
  type ProjectOption = NonNullable<typeof projects>[number];

  const fetchProjectOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.toLowerCase();
      const filtered = (projects ?? []).filter((project) =>
        project.name.toLowerCase().includes(q)
      );
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    [projects]
  );

  const { data: groups } = useClientQueries(schema).groups.useFindMany({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });
  type GroupOption = NonNullable<typeof groups>[number];

  // SCIM-managed groups (scimDisplayName != null) cannot accept locally-added
  // members; the schema rule on GroupAssignment blocks the create. Filter them
  // out of the picker (both options and displayed selection) so admins don't
  // see options that would 403.
  const assignableGroups = (groups ?? []).filter(
    (group) => group.scimDisplayName === null
  );

  const fetchGroupOptions = useCallback(
    (query: string, page: number, pageSize: number) => {
      const q = query.toLowerCase();
      const filtered = (groups ?? [])
        .filter((group) => group.scimDisplayName === null)
        .filter((group) => group.name.toLowerCase().includes(q));
      return Promise.resolve({
        results: filtered.slice(page * pageSize, page * pageSize + pageSize),
        total: filtered.length,
      });
    },
    [groups]
  );

  // Use the new form-specific validation schema
  const form = useForm<z.infer<typeof EditUserFormValidationSchema>>({
    resolver: standardSchemaResolver(EditUserFormValidationSchema),
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
      // Construct payload matching UserUpdateInput for the API. For SCIM-
      // managed users, omit the IdP-owned fields (name/email/isActive); only
      // the TestPlanIt-local fields (access/roleId/isApi) flow through.
      const apiPayload: UserUpdateApiPayload & { image?: string | null } = {
        isApi: data.isApi,
        access: data.access,
        roleId: data.roleId,
      };
      if (!isScimManaged) {
        apiPayload.name = data.name;
        apiPayload.email = data.email;
        apiPayload.isActive = data.isActive;
      }

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
      if (isUniqueConstraintError(err)) {
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

            {isScimManaged && (
              <Alert data-testid="scim-user-locked-alert">
                <Cloud className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>{tAdmin("scimUserLockedTitle")}</AlertTitle>
                <AlertDescription>
                  {tAdmin("scimUserLockedDescription")}
                </AlertDescription>
              </Alert>
            )}

            {user.accessSource === "GROUP_MAPPING" && (
              <Alert data-testid="group-mapping-governed-alert">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>{tAdmin("groupMappingOverrideTitle")}</AlertTitle>
                <AlertDescription>
                  {tAdmin("groupMappingOverrideDescription")}
                </AlertDescription>
              </Alert>
            )}

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
                          {tUserEdit("deleteAvatarConfirm", {
                            name: tCommon("fields.avatar"),
                          })}
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
                    <Input
                      placeholder={tCommon("name")}
                      disabled={isScimManaged}
                      {...field}
                    />
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
                      disabled={isScimManaged}
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
                      disabled={user.id === session?.user.id || isScimManaged}
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
                    {user.accessSource === "GROUP_MAPPING" && (
                      <Badge
                        variant="secondary"
                        className="ms-2"
                        data-testid="group-mapping-badge"
                      >
                        {tAdmin("groupMappingBadge")}
                      </Badge>
                    )}
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
                            <SelectTrigger
                              aria-label={tCommon("fields.access")}
                            >
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
                            <SelectTrigger aria-label={tCommon("fields.role")}>
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
              render={() => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.groups")}
                    <HelpPopover helpKey="user.groups" />
                  </FormLabel>
                  <FormControl>
                    <Controller
                      control={control}
                      name="groups"
                      render={({ field }) => {
                        const selectedGroups = assignableGroups.filter(
                          (group) => field.value?.includes(group.id)
                        );
                        return (
                          <MultiAsyncCombobox<GroupOption>
                            value={selectedGroups}
                            ariaLabel={tCommon("fields.groups")}
                            onValueChange={(selected) =>
                              field.onChange(selected.map((group) => group.id))
                            }
                            fetchOptions={fetchGroupOptions}
                            renderOption={(group) => (
                              <span className="truncate">{group.name}</span>
                            )}
                            renderSelectedOption={(group) => (
                              <span>{group.name}</span>
                            )}
                            getOptionValue={(group) => group.id}
                            getOptionLabel={(group) => group.name}
                            placeholder={tCommon("fields.groups")}
                            className="w-full"
                            pageSize={20}
                            showTotal
                          />
                        );
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="projects"
              render={() => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.projects")}
                    <HelpPopover helpKey="user.projects" />
                  </FormLabel>
                  <FormControl>
                    <Controller
                      control={control}
                      name="projects"
                      render={({ field }) => {
                        const selectedProjects = (projects ?? []).filter(
                          (project) => field.value?.includes(project.id)
                        );
                        return (
                          <MultiAsyncCombobox<ProjectOption>
                            value={selectedProjects}
                            ariaLabel={tCommon("fields.projects")}
                            onValueChange={(selected) =>
                              field.onChange(
                                selected.map((project) => project.id)
                              )
                            }
                            fetchOptions={fetchProjectOptions}
                            renderOption={(project) => (
                              <div className="flex min-w-0 items-center gap-2">
                                <ProjectIcon
                                  iconUrl={project.iconUrl}
                                  width={16}
                                  height={16}
                                />
                                <span className="truncate">{project.name}</span>
                              </div>
                            )}
                            renderSelectedOption={(project) => (
                              <span>{project.name}</span>
                            )}
                            getOptionValue={(project) => project.id}
                            getOptionLabel={(project) => project.name}
                            placeholder={tCommon("fields.projects")}
                            className="w-full"
                            pageSize={20}
                            showTotal
                          />
                        );
                      }}
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
                      <span className="text-muted-foreground text-xs ms-2">
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
