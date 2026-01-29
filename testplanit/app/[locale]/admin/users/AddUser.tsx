"use client";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateUser,
  useCreateUserPreferences,
  useFindManyRoles,
  useCreateManyProjectAssignment,
  useFindManyProjects,
  useCreateManyGroupAssignment,
  useFindManyGroups,
  useUpdateUser,
  useFindFirstRegistrationSettings,
} from "~/lib/hooks";

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

import { CirclePlus } from "lucide-react";

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
import { Roles } from "@prisma/client";

export function AddUserModal() {
  const t = useTranslations("admin.users.add");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletedUser, setDeletedUser] = useState<any | null>(null);
  const [showRestoreDialog, setShowRestoreDialog] = useState(false);
  const { mutateAsync: createUser } = useCreateUser();
  const { mutateAsync: createUserPreferences } = useCreateUserPreferences();
  const { mutateAsync: createManyProjectAssignment } =
    useCreateManyProjectAssignment();
  const { mutateAsync: createManyGroupAssignment } =
    useCreateManyGroupAssignment();
  const { mutateAsync: updateUser } = useUpdateUser();

  // Theme the MultiSelect component
  const { theme } = useTheme();
  const customStyles = getCustomStyles({ theme });

  // Define a Zod schema specifically for form validation
  const AddUserFormValidationSchema = z
    .object({
      name: z.string().min(2, {
        message: tGlobal("common.fields.validation.nameRequired"),
      }),
      email: z
        .email()
        .min(1, { message: tGlobal("auth.signup.errors.emailRequired") }),
      password: z.string().min(4, t("fields.password_error")),
      confirmPassword: z.string().min(4, t("fields.confirmPassword_error")),
      isActive: z.boolean(),
      access: z.enum(["ADMIN", "USER", "PROJECTADMIN", "NONE"]),
      roleId: z
        .string()
        .min(1, { message: tCommon("validation.roleRequired") }),
      isApi: z.boolean(),
      projects: z.array(z.number()).optional(),
      groups: z.array(z.number()).optional(),
    })
    .superRefine(({ confirmPassword, password }, ctx) => {
      if (confirmPassword !== password) {
        ctx.issues.push({
          code: "custom",
          message: tGlobal("auth.signup.errors.passwordsDoNotMatch"),
          path: ["confirmPassword"],
          input: "",
        });
      }
    });

  // Fetch roles, projects, groups, and registration settings...
  const { data: roles, isLoading: isLoadingRoles } = useFindManyRoles();
  const defaultRoleId = roles?.find((role) => role.isDefault)?.id;
  const { data: registrationSettings } = useFindFirstRegistrationSettings();

  // Email server configuration status
  const [isEmailServerConfigured, setIsEmailServerConfigured] = useState(true);

  // Add roleOptions mapping here
  const roleOptions =
    roles?.map((role: Roles) => ({
      // Add type annotation for role
      value: role.id.toString(),
      label: (
        <span>
          {role.name}
          {role.isDefault && (
            <span className="text-muted-foreground italic ml-1">
              {tCommon("fields.default")}
            </span>
          )}
        </span>
      ),
    })) || [];

  const { data: projects } = useFindManyProjects({
    where: { isDeleted: false },
    orderBy: { name: "asc" },
  });

  const projectOptions =
    projects && projects.length > 0
      ? projects.map((project) => ({
          value: project.id,
          label: `${project.name}`,
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

  const groupOptions =
    groups && groups.length > 0
      ? groups.map((group) => ({
          value: group.id,
          label: `${group.name}`,
        }))
      : [];

  const selectAllGroups = () => {
    const allGroupIds = groupOptions.map((option) => option.value);
    setValue("groups", allGroupIds);
  };

  const handleCancel = () => setOpen(false);

  // Use the new form-specific validation schema
  const form = useForm<z.infer<typeof AddUserFormValidationSchema>>({
    resolver: zodResolver(AddUserFormValidationSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      isActive: true,
      access: "USER",
      roleId: defaultRoleId ? defaultRoleId.toString() : "",
      isApi: false,
      projects: [],
      groups: [],
    },
  });

  const {
    setValue,
    handleSubmit,
    control,
    formState: { errors },
  } = form;

  // Watch access field for conditional rendering (useWatch is safe for render)
  const accessValue = useWatch({ control, name: "access" });

  useEffect(() => {
    if (roles) {
      const defaultRole = roles.find((role) => role.isDefault);
      if (defaultRole && !form.getValues("roleId")) {
        // Set only if not already set
        setValue("roleId", defaultRole.id.toString());
      }
    }
  }, [roles, setValue, form]);

  // Check if email server is configured
  useEffect(() => {
    const checkEmailServerConfig = async () => {
      try {
        const response = await fetch("/api/admin/sso/magic-link-status");
        if (response.ok) {
          const data = await response.json();
          setIsEmailServerConfigured(data.configured);
        }
      } catch (error) {
        console.error("Failed to check email server configuration:", error);
      }
    };

    checkEmailServerConfig();
  }, []);

  // Function to restore deleted user
  async function handleRestoreUser(userId: string, formData: z.infer<typeof AddUserFormValidationSchema>) {
    try {
      setIsSubmitting(true);

      // Restore the user by marking isDeleted as false
      // Note: We only restore the user, not update their info. Admin can edit after restoration.
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isDeleted: false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to restore user');
      }

      // Handle project and group assignments
      if (Array.isArray(formData.projects) && formData.projects.length > 0) {
        await createManyProjectAssignment({
          data: formData.projects.map((projectId: number) => ({
            userId: userId,
            projectId: projectId,
          })),
        });
      }
      if (Array.isArray(formData.groups) && formData.groups.length > 0) {
        await createManyGroupAssignment({
          data: formData.groups.map((groupId: number) => ({
            userId: userId,
            groupId: groupId,
          })),
        });
      }

      // Refetch all queries to update the user list immediately (optimistic update)
      queryClient.refetchQueries();

      setShowRestoreDialog(false);
      setDeletedUser(null);
      setOpen(false);
      setIsSubmitting(false);
    } catch (err) {
      form.setError("root", {
        type: "custom",
        message: tCommon("errors.unknown"),
      });
      setIsSubmitting(false);
    }
  }

  // Update onSubmit to use the form validation schema type and construct API payload
  async function onSubmit(data: z.infer<typeof AddUserFormValidationSchema>) {
    setIsSubmitting(true);
    try {
      // Check if email verification is required
      // Email verification is automatically disabled if no email server is configured
      const requireEmailVerification = isEmailServerConfigured && (registrationSettings?.requireEmailVerification ?? true);

      // Construct payload matching UserCreateInput for the API
      const apiPayload = {
        name: data.name,
        email: data.email,
        password: data.password,
        access: data.access,
        roleId: parseInt(data.roleId), // Convert string roleId to number
        isActive: data.isActive,
        isApi: data.isApi,
        emailVerified: requireEmailVerification ? null : new Date(),
        // createdById is typically set by the server/hook
      };

      // Validate the apiPayload against UserCreateSchema if desired (optional extra check)
      // UserCreateSchema.parse(apiPayload);

      const newUser = await createUser({
        data: apiPayload,
      });

      // Create default user preferences
      await createUserPreferences({
        data: {
          userId: newUser!.id,
          itemsPerPage: "P10",
          dateFormat: "MM_DD_YYYY_DASH",
          timeFormat: "HH_MM_A",
          theme: "Light",
          locale: "en_US",
        },
      });

      // Handle assignments using form data
      if (Array.isArray(data.projects) && data.projects.length > 0) {
        await createManyProjectAssignment({
          data: data.projects.map((projectId: number) => ({
            userId: newUser!.id,
            projectId: projectId,
          })),
        });
      }
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        await createManyGroupAssignment({
          data: data.groups.map((groupId: number) => ({
            userId: newUser!.id,
            groupId: groupId,
          })),
        });
      }

      // Refetch all queries to update the user list immediately (optimistic update)
      queryClient.refetchQueries();

      setOpen(false);
      setIsSubmitting(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        // Check if there's a soft-deleted user with this email using the API endpoint
        try {
          const response = await fetch(`/api/model/user/findFirst?q=${encodeURIComponent(JSON.stringify({
            where: { email: data.email, isDeleted: true },
            select: { id: true, email: true, name: true }
          }))}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });

          if (response.ok) {
            const result = await response.json();

            if (result.data && result.data.id) {
              // Found a deleted user, show restore dialog
              setDeletedUser(result.data);
              setShowRestoreDialog(true);
              setIsSubmitting(false);
              return;
            }
          }
        } catch (checkErr) {
          console.error("Error checking for deleted user:", checkErr);
        }

        // No deleted user found or error checking, show regular error
        form.setError("root", {
          type: "custom",
          message: tGlobal("common.errors.emailExists"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
      }
      setIsSubmitting(false);
      return;
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>
            <CirclePlus className="w-4" />
            <span className="hidden md:inline">{t("button")}</span>
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
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.password")}
                    <HelpPopover helpKey="user.password" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={tCommon("fields.password")}
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
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.confirmPassword")}
                    <HelpPopover helpKey="user.confirmPassword" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={tCommon("fields.confirmPassword")}
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
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.role")}
                    <HelpPopover helpKey="user.role" />
                  </FormLabel>
                  <FormControl>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={tCommon("fields.role_placeholder")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {roleOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="groups"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center justify-between">
                    <div className="flex items-center">
                      {tCommon("fields.groups")}
                      <HelpPopover helpKey="user.groups" />
                    </div>
                    <div
                      onClick={selectAllGroups}
                      style={{ cursor: "pointer" }}
                    >
                      {tCommon("actions.selectAll")}
                    </div>
                  </FormLabel>
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
                            // Convert selected options to the format expected by react-hook-form (an array of values)
                            const value = selected
                              ? selected.map((option: any) => option.value)
                              : [];
                            field.onChange(value);
                          }}
                          // Dynamically set the value based on the form's current state
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
                  <FormLabel className="flex items-center justify-between">
                    <div className="flex items-center">
                      {tCommon("fields.projects")}
                      <HelpPopover helpKey="user.projects" />
                    </div>
                    <div
                      onClick={selectAllProjects}
                      style={{ cursor: "pointer" }}
                    >
                      {tCommon("actions.selectAll")}
                    </div>
                  </FormLabel>
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
                            // Convert selected options to the format expected by react-hook-form (an array of values)
                            const value = selected
                              ? selected.map((option: any) => option.value)
                              : [];
                            field.onChange(value);
                          }}
                          // Dynamically set the value based on the form's current state
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
                  className="bg-destructive text-destructive-foreground text-sm p-2"
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
                  ? tCommon("actions.submitting")
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>

    {/* Restore Deleted User Dialog */}
    <Dialog open={showRestoreDialog} onOpenChange={(isOpen) => {
      setShowRestoreDialog(isOpen);
      if (!isOpen) {
        setDeletedUser(null);
      }
    }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{tGlobal("admin.users.restore.title")}</DialogTitle>
          <DialogDescription>
            {tGlobal("admin.users.restore.description", { email: deletedUser?.email })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              setShowRestoreDialog(false);
              setDeletedUser(null);
              setIsSubmitting(false);
            }}
            disabled={isSubmitting}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => {
              const formData = form.getValues();
              handleRestoreUser(deletedUser.id, formData);
            }}
            disabled={isSubmitting}
          >
            {isSubmitting ? tCommon("actions.submitting") : tGlobal("admin.users.restore.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
