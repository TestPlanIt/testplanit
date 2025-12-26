"use client";
/* eslint-disable react-hooks/incompatible-library */
import React, { useState, useEffect, useMemo } from "react";
import {
  useCreateCaseFields,
  useFindManyCaseFieldTypes,
  useFindManyCaseFields,
  useFindManyResultFields,
} from "~/lib/hooks";
import { useTranslations } from "next-intl";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
import { FieldOptions } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DraggableList } from "@/components/DraggableFieldOptions";

import { CirclePlus, Ellipsis } from "lucide-react";

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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { HelpPopover } from "@/components/ui/help-popover";

const FormSchema = z
  .object({
    displayName: z.string().min(1, {
      message: "Enter a display name for the Case Field.",
    }),
    systemName: z
      .string()
      .min(1, {
        message: "System Name cannot be empty.",
      })
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/, {
        message:
          "System Name must start with a letter and can only contain letters, numbers, and underscores.",
      }),
    typeId: z.string().min(1, {
      message: "Field Type is required.",
    }),
    hint: z.string().optional(),
    isEnabled: z.boolean().default(true).optional(),
    isRequired: z.boolean().default(false).optional(),
    isRestricted: z.boolean().default(false).optional(),
    defaultValue: z.string().optional(),
    isChecked: z.boolean().default(false).optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
    minIntegerValue: z.int().nullable().optional(),
    maxIntegerValue: z.int().nullable().optional(),
    initialHeight: z.int().nullable().optional(),
    dropdownOptions: z.array(z.string()).optional(),
  })
  .refine(
    (data) =>
      (data.minValue == null && data.maxValue == null) ||
      (data.minValue != null &&
        data.maxValue != null &&
        data.minValue < data.maxValue),
    {
      path: ["minValue"],
      message:
        "Minimum value must be less than maximum value, and both must be set if one is set.",
    }
  )
  .refine(
    (data) =>
      (data.minIntegerValue == null && data.maxIntegerValue == null) ||
      (data.minIntegerValue != null &&
        data.maxIntegerValue != null &&
        data.minIntegerValue < data.maxIntegerValue),
    {
      path: ["minIntegerValue"],
      message:
        "Minimum integer value must be less than maximum integer value, and both must be set if one is set.",
    }
  );

export interface FieldDraftOption {
  name: string;
  isDefault?: boolean;
  iconId?: number | null;
  iconColorId?: number | null;
  isEnabled?: boolean;
  order?: number | null;
}

export interface AddCaseFieldModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSubmitField?: (payload: {
    values: z.infer<typeof FormSchema>;
    dropdownOptions: FieldOptions[];
    defaultOptionId: number | null;
    typeName: string | undefined;
  }) => Promise<boolean | void> | boolean | void;
  draft?: {
    values?: Partial<z.infer<typeof FormSchema>>;
    options?: FieldDraftOption[];
  };
  trigger?: React.ReactNode;
  submitLabel?: string;
}

export function AddCaseFieldModal({
  open: controlledOpen,
  onOpenChange,
  onSubmitField,
  draft,
  trigger,
  submitLabel,
}: AddCaseFieldModalProps = {}) {
  const t = useTranslations("admin.templates.caseFields.add");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen! : internalOpen;
  const setOpen = (value: boolean) => {
    onOpenChange?.(value);
    if (!isControlled) {
      setInternalOpen(value);
    }
  };
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [systemNameFocused, setSystemNameFocused] = useState(false);
  const [selectedTypeOptions, setSelectedTypeOptions] = useState<any>(null);
  const [selectedTypeName, setSelectedTypeName] = useState<
    string | undefined | null
  >(undefined);
  const [dropdownOptions, setDropdownOptions] = useState<FieldOptions[]>([]);

  const [lastId, setLastId] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [defaultItem, setDefaultItem] = useState<number | null>(null);

  const applyOptionOrder = (options: FieldOptions[]): FieldOptions[] =>
    options.map((option, index) => ({ ...option, order: index }));

  const { mutateAsync: createCaseField } = useCreateCaseFields();

  const { data: types, isLoading: typesLoading } = useFindManyCaseFieldTypes({
    orderBy: { type: "asc" },
  });

  const { data: existingCaseFields } = useFindManyCaseFields({
    select: { systemName: true },
  });

  const { data: existingResultFields } = useFindManyResultFields({
    select: { systemName: true },
  });

  const existingSystemNames = useMemo(() => {
    const names: string[] = [];
    existingCaseFields?.forEach((field) => {
      if (typeof field.systemName === "string") {
        names.push(field.systemName.trim().toLowerCase());
      }
    });
    existingResultFields?.forEach((field) => {
      if (typeof field.systemName === "string") {
        names.push(field.systemName.trim().toLowerCase());
      }
    });
    return Array.from(new Set(names));
  }, [existingCaseFields, existingResultFields]);

  const validationSchema = useMemo(
    () =>
      FormSchema.superRefine((data, ctx) => {
        const normalizedSystemName = data.systemName
          ? data.systemName.trim().toLowerCase()
          : null;
        if (
          normalizedSystemName &&
          existingSystemNames.includes(normalizedSystemName)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["systemName"],
            message: tCommon("fields.options.validation.systemNameError"),
          });
        }
      }),
    [existingSystemNames, tCommon]
  );

  const typeOptions =
    types?.map((type) => ({
      value: type.id.toString(),
      label: type.type,
    })) || [];

  const handleCancel = () => setOpen(false);

  const handleEnabledChange = (itemId: number, isEnabled: boolean) => {
    // console.log(`Changing isEnabled for item ${itemId} to ${isEnabled}`);
    const newDropdownOptions = dropdownOptions.map((item) =>
      item.id === itemId ? { ...item, isEnabled } : item
    );
    setDropdownOptions(applyOptionOrder(newDropdownOptions));
  };

  const handleIconChange = (itemId: number, iconId: number) => {
    // console.log(`Changing iconId for item ${itemId} to ${iconId}`);
    const newDropdownOptions = dropdownOptions.map((item) =>
      item.id === itemId ? { ...item, iconId } : item
    );
    // console.log("Updated Options:", newDropdownOptions);
    setDropdownOptions(applyOptionOrder(newDropdownOptions));
  };

  const handleColorChange = (itemId: number, colorId: number) => {
    // console.log(`Changing colorId for item ${itemId} to ${colorId}`);
    const newDropdownOptions = dropdownOptions.map((item) =>
      item.id === itemId ? { ...item, iconColorId: colorId } : item
    );
    // console.log("Updated Options:", newDropdownOptions);
    setDropdownOptions(applyOptionOrder(newDropdownOptions));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const inputValue = e.currentTarget.value.trim();

      if (inputValue && !error) {
        addDropdownOption(inputValue);
        e.currentTarget.value = "";
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value.trim();

    const isValidInput = (input: string) => {
      const regex = /^[A-Za-z0-9_\s]+$/;
      return regex.test(input);
    };

    const isUniqueInput = (input: string) => {
      return !dropdownOptions.some((option) => option.name === input);
    };

    if (inputValue && !isValidInput(inputValue)) {
      setError(tCommon("fields.options.validation.invalidChars"));
    } else if (!isUniqueInput(inputValue)) {
      setError(tCommon("fields.options.validation.duplicate"));
    } else {
      setError(null);
    }
  };

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(validationSchema),
    defaultValues: {
      displayName: "",
      systemName: "",
      isEnabled: true,
      typeId: "",
      hint: "",
      dropdownOptions: [],
    },
  });

  const {
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = form;

  const displayName = watch("displayName");

  const addDropdownOption = (name: string) => {
    const newId = lastId + 1;
    setDropdownOptions((prevOptions) => {
      const newOption: FieldOptions = {
        id: newId,
        name,
        iconId: null,
        iconColorId: null,
        isEnabled: true,
        isDefault: prevOptions.length === 0,
        order: prevOptions.length,
        isDeleted: false,
      };
      return applyOptionOrder([...prevOptions, newOption]);
    });
    setLastId(newId);

    if (dropdownOptions.length === 0) {
      setDefaultItem(newId);
    }
  };

  const removeDropdownOption = (id: number) => {
    setDropdownOptions((prevOptions) => {
      const newOptions = prevOptions.filter((option) => option.id !== id);
      // Check if the removed item was the default, and reset default if necessary
      if (defaultItem === id && newOptions.length > 0) {
        setDefaultItem(newOptions[0].id); // Set new default to the first in the list
      } else if (newOptions.length === 0) {
        setDefaultItem(null);
      }
      return applyOptionOrder(newOptions);
    });
  };

  useEffect(() => {
    if (!systemNameFocused && displayName) {
      const formattedName = displayName
        .toLowerCase() // Convert to lowercase
        .replace(/\s+/g, "_") // Replace spaces with underscores
        .replace(/[^a-z0-9_]/g, "") // Remove all characters that are not letters, numbers, or underscores
        .replace(/^[^a-z]+/, ""); // Remove any leading characters that are not letters

      setValue("systemName", formattedName, { shouldValidate: true });
    }
  }, [displayName, systemNameFocused, setValue]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const baseDefaults = {
      displayName: "",
      systemName: "",
      isEnabled: true,
      typeId: "",
      hint: "",
      dropdownOptions: [],
      isRequired: false,
      isRestricted: false,
      defaultValue: "",
      isChecked: false,
      minValue: null,
      maxValue: null,
      minIntegerValue: null,
      maxIntegerValue: null,
      initialHeight: null,
    } satisfies Partial<z.infer<typeof FormSchema>>;

    reset({
      ...baseDefaults,
      ...(draft?.values ?? {}),
    });

    const draftOptions = draft?.options ?? [];
    if (draftOptions.length > 0) {
      const sortedDraftOptions = draftOptions
        .map((option, index) => ({ option, fallbackIndex: index }))
        .sort(
          (a, b) =>
            (a.option.order ?? a.fallbackIndex) -
            (b.option.order ?? b.fallbackIndex)
        )
        .map(({ option }) => option);

      const explicitDefaultProvided = sortedDraftOptions.some(
        (entry) => entry.isDefault
      );

      const nextOptions: FieldOptions[] = sortedDraftOptions.map(
        (option, index) => ({
          id: index + 1,
          name: option.name,
          iconId: option.iconId ?? null,
          iconColorId: option.iconColorId ?? null,
          isEnabled: option.isEnabled ?? true,
          isDefault: explicitDefaultProvided
            ? Boolean(option.isDefault)
            : index === 0,
          order: index,
          isDeleted: false,
        })
      );

      setDropdownOptions(nextOptions);
      const defaultOption = nextOptions.find((option) => option.isDefault);
      setDefaultItem(
        defaultOption ? defaultOption.id : (nextOptions[0]?.id ?? null)
      );
      setLastId(nextOptions.length);
    } else {
      setDropdownOptions([]);
      setDefaultItem(null);
      setLastId(0);
    }

    setSystemNameFocused(false);
  }, [open, reset, draft]);

  const typeId = watch("typeId");

  useEffect(() => {
    if (types && typeId) {
      const currentTypeOptions = types.find(
        (type) => type.id.toString() === typeId
      )?.options;
    }
  }, [types, typeId]);

  useEffect(() => {
    const foundType = types?.find((type) => type.id.toString() === typeId);
    setSelectedTypeName(foundType?.type);
    if (foundType && foundType.options) {
      try {
        const parsedOptions =
          typeof foundType.options === "string"
            ? JSON.parse(foundType.options)
            : foundType.options;
        setSelectedTypeOptions(parsedOptions);
      } catch (error) {
        console.error("Error parsing options:", error);
        setSelectedTypeOptions(null);
      }
    } else {
      setSelectedTypeOptions(null);
    }
  }, [types, typeId]);

  const renderOptions = (options: any) => {
    const currentType = types?.find(
      (type) => type.id.toString() === watch("typeId")
    );
    const isIntegerType = currentType && currentType.type === "Integer";

    // Define help keys for dynamic options
    const dynamicOptionHelpKeys: Record<string, string> = {
      defaultValue: "caseField.defaultValue",
      isChecked: "caseField.isChecked",
      minValue: "caseField.minValue",
      maxValue: "caseField.maxValue",
      minIntegerValue: "caseField.minValue", // Assuming min/max Integer share same help text as Number
      maxIntegerValue: "caseField.maxValue", // Assuming min/max Integer share same help text as Number
      initialHeight: "caseField.initialHeight",
      dropdownOptions: "caseField.dropdownOptions",
    };

    return options.specificOptions.map(
      (option: { key: string; displayName: string }) => {
        const helpKey = dynamicOptionHelpKeys[option.key];
        return (
          <Controller
            key={option.key}
            name={option.key as keyof z.infer<typeof FormSchema>}
            control={form.control}
            render={({ field, fieldState }) => (
              <FormItem>
                <div className="items-center">
                  <FormLabel className="flex items-center">
                    {option.displayName}
                    {helpKey && <HelpPopover helpKey={helpKey} />}
                  </FormLabel>
                  <FormControl>
                    {option.key === "isChecked" ? (
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={field.onChange}
                        className="mx-2"
                      />
                    ) : option.key.toLowerCase() === "dropdownoptions" ? (
                      <div>
                        <Input
                          placeholder="Add an option"
                          onChange={handleInputChange}
                          onKeyDown={handleKeyDown}
                          className="my-2"
                        />
                        {error && (
                          <div className="text-destructive text-sm">
                            {error}
                          </div>
                        )}
                        <div className="max-h-48 overflow-auto">
                          <DraggableList
                            items={dropdownOptions}
                            setItems={(items) => {
                              if (typeof items === "function") {
                                setDropdownOptions((prev) =>
                                  applyOptionOrder(items(prev))
                                );
                              } else {
                                setDropdownOptions(applyOptionOrder(items));
                              }
                            }}
                            onRemove={removeDropdownOption}
                            defaultItem={defaultItem}
                            setDefaultItem={setDefaultItem}
                            showDefault={
                              selectedTypeName?.toLowerCase() === "dropdown"
                            }
                            handleEnabledChange={handleEnabledChange}
                            handleIconChange={handleIconChange}
                            handleColorChange={handleColorChange}
                          />
                        </div>
                      </div>
                    ) : option.key === "defaultValue" ? (
                      <Input
                        {...field}
                        type="text"
                        onChange={field.onChange}
                        value={(field.value ?? "") as string}
                      />
                    ) : option.key.includes("Value") ||
                      option.key === "initialHeight" ? (
                      <Input
                        {...field}
                        type="number"
                        step={
                          option.key === "initialHeight" || isIntegerType
                            ? "1"
                            : "0.01"
                        } // Ensure correct step for initialHeight
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          handleNumberInput(
                            e,
                            option.key,
                            (option.key === "initialHeight" || isIntegerType) ??
                              false // Ensure correct handling for initialHeight
                          )
                        }
                        value={(field.value ?? "") as string | number}
                      />
                    ) : (
                      <Input
                        {...field}
                        type="text"
                        onChange={field.onChange}
                        value={(field.value ?? "") as string | number}
                      />
                    )}
                  </FormControl>
                  <FormMessage>{fieldState.error?.message}</FormMessage>
                </div>
              </FormItem>
            )}
          />
        );
      }
    );
  };

  // Handle number input changes for number type fields
  function handleNumberInput(
    e: React.ChangeEvent<HTMLInputElement>,
    key: string,
    isInteger: boolean
  ) {
    const value = e.target.value;
    if (value === "") {
      form.setValue(key as keyof z.infer<typeof FormSchema>, null);
    } else {
      const numericValue = isInteger ? parseInt(value, 10) : parseFloat(value);
      if (!isNaN(numericValue)) {
        form.setValue(key as keyof z.infer<typeof FormSchema>, numericValue);
      } else {
        form.setValue(key as keyof z.infer<typeof FormSchema>, null);
      }
    }
  }

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);
    try {
      if (onSubmitField) {
        const result = await onSubmitField({
          values: data,
          dropdownOptions,
          defaultOptionId: defaultItem,
          typeName: selectedTypeName ?? undefined,
        });

        setIsSubmitting(false);
        if (result === false) {
          return;
        }

        setOpen(false);
        return;
      }

      await createCaseField({
        data: {
          displayName: data.displayName,
          systemName: data.systemName,
          hint: data.hint,
          typeId: data.typeId ? parseInt(data.typeId) : 1,
          isEnabled: data.isEnabled,
          isRequired: data.isRequired,
          isRestricted: data.isRestricted,
          defaultValue: data.defaultValue,
          isChecked: data.isChecked || false,
          minValue: data.minValue,
          maxValue: data.maxValue,
          initialHeight: data.initialHeight,
          fieldOptions: {
            create: dropdownOptions.map((option, index) => ({
              fieldOption: {
                create: {
                  name: option.name,
                  iconId: option.iconId,
                  iconColorId: option.iconColorId,
                  isEnabled: option.isEnabled,
                  isDefault: option.id === defaultItem,
                  order: index + 1,
                },
              },
            })),
          },
        },
      });

      setIsSubmitting(false);
      setOpen(false);
    } catch (err: any) {
      setIsSubmitting(false);
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("systemName", {
          type: "custom",
          message: tCommon("fields.options.validation.systemNameError"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tGlobal("milestones.errors.unknown"),
        });
      }
      return;
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <CirclePlus className="w-4" />
              <span className="hidden md:inline">{t("title")}</span>
            </Button>
          )}
        </DialogTrigger>
      )}
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
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.displayName")}
                    <HelpPopover helpKey="caseField.displayName" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={tCommon("fields.placeholders.displayName")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="systemName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    <span>{tCommon("fields.systemName")}</span>
                    <HelpPopover helpKey="caseField.systemName" />
                    <div className="text-muted-foreground text-sm ml-2">
                      {tCommon("fields.hints.systemName")}
                    </div>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={tCommon("fields.placeholders.systemName")}
                      {...field}
                      onFocus={() => setSystemNameFocused(true)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="hint"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    {tCommon("fields.hint")}
                    <HelpPopover helpKey="caseField.hint" />
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder={tCommon("fields.placeholders.hint")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex w-full items-center space-x-8">
              <FormField
                control={form.control}
                name="isEnabled"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.options.enabled")}
                        <HelpPopover helpKey="caseField.enabled" />
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isRequired"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.required")}
                        <HelpPopover helpKey="caseField.required" />
                      </FormLabel>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isRestricted"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="flex items-center">
                        {tCommon("fields.restricted")}
                        <HelpPopover helpKey="caseField.restricted" />
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="typeId"
              render={({ field }) => (
                <FormItem>
                  <Label className="whitespace-nowrap items-center flex space-x-2">
                    <div className="flex items-center">
                      <span>{tCommon("fields.fieldType")}</span>
                      <HelpPopover helpKey="caseField.fieldType" />
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {tCommon("fields.hints.fieldType")}
                    </div>
                  </Label>
                  <FormControl>
                    <Select
                      onValueChange={(value) => {
                        setValue("typeId", value);
                        field.onChange(value);
                      }}
                      value={field.value}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={tCommon("fields.fieldType")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {typesLoading ? (
                          <SelectItem value="" disabled>
                            <Ellipsis />
                          </SelectItem>
                        ) : (
                          typeOptions.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {selectedTypeOptions && renderOptions(selectedTypeOptions)}
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
                  ? tCommon("actions.submitting")
                  : (submitLabel ?? tCommon("actions.submit"))}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
