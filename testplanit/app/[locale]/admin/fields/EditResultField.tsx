"use client";
import { useState, useEffect, useMemo } from "react";
import {
  useFindManyCaseFieldTypes,
  useFindManyCaseFields,
  useFindManyResultFields,
  useUpdateResultFields,
  useUpdateFieldOptions,
  useCreateFieldOptions,
  useUpdateManyFieldOptions,
} from "~/lib/hooks";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod/v4";
import { FieldOptions } from "@prisma/client";
import { ExtendedResultFields } from "./resultFieldColumns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DraggableList } from "@/components/DraggableFieldOptions";

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

import { Select, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { HelpPopover } from "@/components/ui/help-popover";

import { useTranslations } from "next-intl";

interface EditResultFieldModalProps {
  resultfield: ExtendedResultFields;
}

export function EditResultFieldModal({
  resultfield,
}: EditResultFieldModalProps) {
  const t = useTranslations("admin.templates.resultFields.edit");
  const tCommon = useTranslations("common");

  const FormSchema = z
    .object({
      displayName: z.string().min(1, {
        message: tCommon("fields.options.validation.displayNameRequiredResult"),
      }),
      systemName: z.string().optional(),
      typeId: z.string().optional(),
      hint: z.string().optional(),
      isEnabled: z.boolean(),
      isRequired: z.boolean(),
      isRestricted: z.boolean(),
      defaultValue: z.string().optional(),
      isChecked: z.boolean().optional(),
      minValue: z.number().nullable().optional(),
      maxValue: z.number().nullable().optional(),
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
        message: tCommon("fields.options.validation.minValueMaxValue"),
        path: ["minValue"],
      }
    )
    .refine((data) => data.initialHeight == null || data.initialHeight <= 600, {
      message: tCommon("fields.options.validation.initialHeightMax"),
      path: ["initialHeight"],
    });

  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTypeOptions, setSelectedTypeOptions] = useState<any>(null);
  const [dropdownOptions, setDropdownOptions] = useState<FieldOptions[]>([]);
  const [dropdownOptionsInitialized, setDropdownOptionsInitialized] =
    useState(false);
  const [initialOptions, setInitialOptions] = useState<FieldOptions[]>([]);

  const [selectedTypeName, setSelectedTypeName] = useState<
    string | undefined | null
  >(undefined);
  const [lastId, setLastId] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [defaultItem, setDefaultItem] = useState<number | null>(null);

  const { mutateAsync: updateResultField } = useUpdateResultFields();
  const { mutateAsync: createFieldOptions } = useCreateFieldOptions();
  const { mutateAsync: updateManyFieldOptions } = useUpdateManyFieldOptions();
  const { mutateAsync: updateFieldOptions } = useUpdateFieldOptions();

  const { data: types } = useFindManyCaseFieldTypes({
    orderBy: { type: "asc" },
  });

  const { data: existingCaseFields } = useFindManyCaseFields({
    select: { id: true, systemName: true },
  });

  const { data: existingResultFields } = useFindManyResultFields({
    select: { id: true, systemName: true },
  });

  const existingSystemNames = useMemo(() => {
    const names: string[] = [];
    const exclude = resultfield.systemName
      ? resultfield.systemName.trim().toLowerCase()
      : null;
    existingCaseFields?.forEach((field) => {
      if (typeof field.systemName === "string") {
        const normalized = field.systemName.trim().toLowerCase();
        if (normalized && normalized !== exclude) {
          names.push(normalized);
        }
      }
    });
    existingResultFields?.forEach((field) => {
      if (field.id === resultfield.id) {
        return;
      }
      if (typeof field.systemName === "string") {
        const normalized = field.systemName.trim().toLowerCase();
        if (normalized && normalized !== exclude) {
          names.push(normalized);
        }
      }
    });
    return Array.from(new Set(names));
  }, [
    existingCaseFields,
    existingResultFields,
    resultfield.id,
    resultfield.systemName,
  ]);

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
    [FormSchema, existingSystemNames, tCommon]
  );

  const defaultFormValues = useMemo(() => {
    return {
      displayName: resultfield.displayName,
      systemName: resultfield.systemName,
      isEnabled: resultfield.isEnabled,
      isRequired: resultfield.isRequired,
      isRestricted: resultfield.isRestricted,
      typeId: resultfield.type?.id.toString(),
      hint: resultfield.hint ? resultfield.hint : "",
      defaultValue: resultfield.defaultValue ?? undefined,
      isChecked: resultfield.isChecked || false,
      minValue: resultfield.minValue,
      maxValue: resultfield.maxValue,
      initialHeight: resultfield.initialHeight,
      fieldOptions: resultfield.fieldOptions,
    };
  }, [
    resultfield.displayName,
    resultfield.isEnabled,
    resultfield.isRequired,
    resultfield.isRestricted,
    resultfield.systemName,
    resultfield.type.id,
    resultfield.hint,
    resultfield.defaultValue,
    resultfield.isChecked,
    resultfield.minValue,
    resultfield.maxValue,
    resultfield.fieldOptions,
    resultfield.initialHeight,
  ]);

  const handleCancel = () => setOpen(false);

  const handleDropdownOptionsChange = (
    newOptions: FieldOptions[] | ((options: FieldOptions[]) => FieldOptions[])
  ) => {
    setDropdownOptions((prevOptions) => {
      return typeof newOptions === "function"
        ? newOptions(prevOptions)
        : newOptions;
    });
  };

  const handleDefaultChange = (selectedId: number) => {
    setDefaultItem(selectedId);
  };

  const handleEnabledChange = (itemId: number, isEnabled: boolean) => {
    // console.log(`Changing isEnabled for item ${itemId} to ${isEnabled}`);
    const newDropdownOptions = dropdownOptions.map((item) =>
      item.id === itemId ? { ...item, isEnabled } : item
    );
    setDropdownOptions(newDropdownOptions);
  };

  const handleIconChange = (itemId: number, iconId: number) => {
    // console.log(`Changing iconId for item ${itemId} to ${iconId}`);
    const newDropdownOptions = dropdownOptions.map((item) =>
      item.id === itemId ? { ...item, iconId } : item
    );
    // console.log("Updated Options:", newDropdownOptions);
    setDropdownOptions(newDropdownOptions);
  };

  const handleColorChange = (itemId: number, colorId: number) => {
    // console.log(`Changing colorId for item ${itemId} to ${colorId}`);
    const newDropdownOptions = dropdownOptions.map((item) =>
      item.id === itemId ? { ...item, colorId } : item
    );
    // console.log("Updated Options:", newDropdownOptions);
    setDropdownOptions(newDropdownOptions);
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
      const regex = /^[A-Za-z0-9_\s]+$/; // Only allow letters, numbers, and underscores
      return regex.test(input);
    };

    // Function to check if the input value is unique
    const isUniqueInput = (input: string) => {
      return !dropdownOptions.some((option) => option.name === input);
    };

    // Check for valid characters
    if (inputValue && !isValidInput(inputValue)) {
      setError(
        "Options can only contain letters, numbers, spaces and underscores."
      );
    } else if (!isUniqueInput(inputValue)) {
      // Check for uniqueness only if input is valid to avoid stacking messages
      setError("Option already exists. Please enter a unique option.");
    } else {
      // Clear error if input is valid and unique
      setError(null);
    }
  };

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(validationSchema),
    defaultValues: defaultFormValues,
  });

  useEffect(() => {
    if (open && !dropdownOptionsInitialized && resultfield?.fieldOptions) {
      const transformedOptions = resultfield.fieldOptions
        .map(({ fieldOption }) => ({
          id: fieldOption.id,
          name: fieldOption.name,
          iconId: fieldOption.iconId,
          iconColorId: fieldOption.iconColorId,
          isEnabled: fieldOption.isEnabled,
          isDefault: fieldOption.isDefault,
          order: fieldOption.order,
          iconName: fieldOption.icon ? fieldOption.icon.name : undefined,
          iconColorValue: fieldOption.iconColor
            ? fieldOption.iconColor.value
            : undefined,
          isDeleted: false,
        }))
        .sort((a, b) => a.order - b.order);

      setDropdownOptions(transformedOptions);
      setInitialOptions(transformedOptions);
      setDropdownOptionsInitialized(true);

      const defaultItem = transformedOptions.find((option) => option.isDefault);
      if (defaultItem) {
        setDefaultItem(defaultItem.id);
      }
    }
  }, [open, resultfield?.fieldOptions, dropdownOptionsInitialized]);

  useEffect(() => {
    if (dropdownOptions.length > 0) {
      const maxId = dropdownOptions.reduce(
        (max, item) => Math.max(max, item.id),
        0
      );
      setLastId(maxId);
    }
  }, [dropdownOptions]);

  useEffect(() => {
    if (open) {
      form.reset(defaultFormValues);
    }
  }, [open, defaultFormValues, form]);

  const {
    watch,
    control,
    formState: { errors },
  } = form;

  const addDropdownOption = (name: string) => {
    const newId = lastId + 1;
    setDropdownOptions((prevOptions) => {
      const isFirstOption = prevOptions.length === 0;
      if (isFirstOption) {
        setDefaultItem(newId);
      }
      return [
        ...prevOptions,
        {
          id: newId,
          name: name,
          isDefault: isFirstOption,
          iconColor: null,
          iconId: null,
          iconColorId: null,
          isEnabled: true,
          order: prevOptions.length + 1,
          isDeleted: false,
        },
      ];
    });
    setLastId(newId);
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
      return newOptions;
    });
  };

  useEffect(() => {
    if (open) {
      const foundType = types?.find((type) => type.id === resultfield.type.id);
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
    }
  }, [open, types, resultfield.type.id]);

  const renderOptions = (options: any) => {
    const currentType = types?.find(
      (type) => type.id.toString() === watch("typeId")
    );
    const isIntegerType = currentType && currentType.type === "Integer";

    // Define help keys for dynamic options
    const dynamicOptionHelpKeys: Record<string, string> = {
      defaultValue: "resultField.defaultValue",
      isChecked: "resultField.isChecked",
      minValue: "resultField.minValue",
      maxValue: "resultField.maxValue",
      minIntegerValue: "resultField.minValue", // Assuming min/max Integer share same help text as Number
      maxIntegerValue: "resultField.maxValue", // Assuming min/max Integer share same help text as Number
      initialHeight: "resultField.initialHeight",
      dropdownOptions: "resultField.dropdownOptions",
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
                            setItems={handleDropdownOptionsChange}
                            onRemove={removeDropdownOption}
                            defaultItem={defaultItem}
                            setDefaultItem={handleDefaultChange}
                            handleEnabledChange={handleEnabledChange}
                            handleIconChange={handleIconChange}
                            handleColorChange={handleColorChange}
                            showDefault={
                              selectedTypeName?.toLowerCase() === "dropdown"
                            }
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
                        value={
                          typeof field.value === "number" ? field.value : ""
                        }
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
        // Explicitly set to null if parsing fails
        form.setValue(key as keyof z.infer<typeof FormSchema>, null);
      }
    }
  }

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    setIsSubmitting(true);

    const updatedDropdownOptions = dropdownOptions.map((option) => ({
      ...option,
      isDefault: option.id === defaultItem,
    }));

    // Map initial options by ID for faster lookup
    const initialOptionIds = initialOptions.map((option) => option.id);
    const updatedOptionIds = updatedDropdownOptions
      .filter((option) => initialOptionIds.includes(option.id))
      .map((option) => option.id);

    // Determine the new and updated options separately
    const newOptions = updatedDropdownOptions.filter(
      (option) => !initialOptionIds.includes(option.id)
    );
    const updatedOptions = updatedDropdownOptions.filter((option) =>
      initialOptionIds.includes(option.id)
    );

    // console.log(`Initial Options: ${JSON.stringify(initialOptions)}`);
    // console.log(`Dropdown Options: ${JSON.stringify(updatedDropdownOptions)}`);
    // console.log(`Default Item: ${JSON.stringify(defaultItem)}`);

    try {
      // Update the ResultField properties
      await updateResultField({
        where: { id: resultfield.id },
        data: {
          displayName: data.displayName,
          systemName: data.systemName,
          hint: data.hint,
          isEnabled: data.isEnabled,
          isRequired: data.isRequired,
          isRestricted: data.isRestricted,
          defaultValue: data.defaultValue,
          isChecked: data.isChecked || false,
          minValue: data.minValue || null,
          maxValue: data.maxValue || null,
          initialHeight: data.initialHeight || null,
        },
      });

      // Update existing FieldOptions
      const updatePromises = updatedOptions.map((option, index) => {
        return updateFieldOptions({
          where: { id: option.id! },
          data: {
            name: option.name,
            iconId: option.iconId || undefined,
            iconColorId: option.iconColorId || undefined,
            isEnabled: option.isEnabled,
            isDefault: option.id === defaultItem,
            order: index + 1,
          },
        });
      });

      // Create new FieldOptions
      const createPromises = newOptions.map((option, index) =>
        createFieldOptions({
          data: {
            name: option.name,
            iconId: option.iconId || undefined,
            iconColorId: option.iconColorId || undefined,
            isEnabled: option.isEnabled,
            isDefault: option.id === defaultItem,
            order: updatedOptionIds.length + index + 1,
            resultFields: {
              create: {
                resultFieldId: resultfield.id,
              },
            },
          },
        })
      );

      await Promise.all([...updatePromises, ...createPromises]);

      // Clean up any orphaned Field Options
      await updateManyFieldOptions({
        data: { isDeleted: true },
        where: {
          AND: [{ resultFields: { none: {} } }, { resultFields: { none: {} } }],
        },
      });

      setIsSubmitting(false);
      setOpen(false);
    } catch (err: any) {
      if (err.info?.prisma && err.info?.code === "P2002") {
        form.setError("systemName", {
          type: "custom",
          message: tCommon("fields.options.validation.systemNameError"),
        });
      } else {
        form.setError("root", {
          type: "custom",
          message: tCommon("errors.unknown"),
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <SquarePen className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent
        key={resultfield.id}
        className="sm:max-w-[600px] lg:max-w-[1000px]"
      >
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
                    <HelpPopover helpKey="resultField.displayName" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="systemName"
              disabled
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center">
                    <span>{tCommon("fields.systemName")}</span>
                    <HelpPopover helpKey="resultField.systemName" />
                  </FormLabel>
                  <div className="text-muted-foreground text-sm">
                    {tCommon("fields.hints.systemName")}
                  </div>
                  <FormControl>
                    <Input {...field} />
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
                    <HelpPopover helpKey="resultField.hint" />
                  </FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="ml-2 flex items-center">
                      {tCommon("fields.enabled")}
                      <HelpPopover helpKey="resultField.enabled" />
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isRequired"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="ml-2 flex items-center">
                      {tCommon("fields.required")}
                      <HelpPopover helpKey="resultField.required" />
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="isRestricted"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel className="ml-2 flex items-center">
                      {tCommon("fields.restricted")}
                      <HelpPopover helpKey="resultField.restricted" />
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="typeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="whitespace-nowrap items-center flex space-x-2">
                    <div className="flex items-center">
                      <span>{tCommon("fields.fieldType")}</span>
                      <HelpPopover helpKey="resultField.fieldType" />
                    </div>
                    <div className="text-muted-foreground text-sm">
                      {tCommon("fields.hints.fieldType")}
                    </div>
                  </FormLabel>
                  <FormControl>
                    <Controller
                      control={control}
                      name="typeId"
                      disabled
                      render={() => (
                        <Select disabled>
                          <SelectTrigger>
                            <SelectValue placeholder={resultfield.type.type} />
                          </SelectTrigger>
                        </Select>
                      )}
                    />
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
                  : tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
