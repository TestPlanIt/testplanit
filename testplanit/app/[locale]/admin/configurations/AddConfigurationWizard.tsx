"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormItem, FormLabel } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Combine,
  Component,
  ListChecks,
  PlusCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  useCreateConfigurations,
  useFindManyConfigCategories,
  useFindManyConfigurations,
} from "~/lib/hooks";

enum WizardStep {
  VARIANTS = 0,
  COMBINATIONS = 1,
  CONFIRMATION = 2,
}

const stepIcons = [Component, Combine, ListChecks];

const arraysEqual = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((val, index) => val === b[index]);
};

const generateCombinations = (arrays: number[][]): number[][] => {
  if (arrays.length === 0) return [[]];
  const tail = generateCombinations(arrays.slice(1));
  return arrays[0].flatMap((value) =>
    tail.map((combination) => [value, ...combination])
  );
};

const AddConfigurationWizard = (): React.ReactElement => {
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState<WizardStep>(
    WizardStep.VARIANTS
  );

  // Step 1 state — variant selection.
  const [selectedVariants, setSelectedVariants] = useState<number[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(
    new Set()
  );

  // Step 2 state — per-combination selection. `exists` flags combinations
  // that already match a saved configuration; they're rendered disabled so
  // the user can see which combinations are already configured.
  const [allCombinations, setAllCombinations] = useState<
    { combination: number[]; selected: boolean; exists: boolean }[]
  >([]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const t = useTranslations("admin.configurations");
  const tVariants = useTranslations("admin.configurations.variants.selection");
  const tCombinations = useTranslations("admin.configurations.combinations");
  const tCommon = useTranslations("common");

  const form = useForm();

  const { mutateAsync: createConfigurations } = useCreateConfigurations();

  const { data: categories } = useFindManyConfigCategories({
    where: { isDeleted: false },
    include: {
      variants: {
        where: { isEnabled: true },
      },
    },
  });

  const { data: existingConfigurations } = useFindManyConfigurations({
    where: { isDeleted: false },
    include: { variants: true },
  });

  // Expand every category by default once the data arrives.
  useEffect(() => {
    if (categories) {
      setExpandedCategories(new Set(categories.map((category) => category.id)));
    }
  }, [categories]);

  // Resolve a variant id to its display name across all categories.
  const getVariantName = useCallback(
    (variantId: number): string | undefined => {
      return categories
        ?.flatMap((cat) => cat.variants)
        .find((v) => v.id === variantId)?.name;
    },
    [categories]
  );

  const getCombinationLabel = useCallback(
    (combination: number[]): string => {
      return combination.map(getVariantName).filter(Boolean).join(", ");
    },
    [getVariantName]
  );

  // Derive every viable combination from the variants the user picked in
  // step 1 and mark which ones already match an existing configuration.
  const derivedCombinations = useMemo(() => {
    if (!categories || selectedVariants.length === 0) return [];
    const categoryMap = new Map<number, number[]>();
    selectedVariants.forEach((variantId) => {
      const category = categories.find((cat) =>
        cat.variants.some((variant) => variant.id === variantId)
      );
      if (category) {
        if (!categoryMap.has(category.id)) categoryMap.set(category.id, []);
        categoryMap.get(category.id)!.push(variantId);
      }
    });

    const combinations = generateCombinations([...categoryMap.values()]);
    return combinations.map((combination) => ({
      combination,
      exists: !!existingConfigurations?.some((config) =>
        arraysEqual(
          config.variants.map((v) => v.variantId).sort(),
          [...combination].sort()
        )
      ),
    }));
  }, [selectedVariants, existingConfigurations, categories]);

  // Hydrate / re-hydrate the per-combination checkbox state when the user
  // re-enters step 2. New combinations default to selected; combinations that
  // already exist are kept visible but never selected (their checkbox is
  // disabled in the UI).
  useEffect(() => {
    if (currentStep !== WizardStep.COMBINATIONS) return;
    const items = derivedCombinations.map(({ combination, exists }) => ({
      combination,
      selected: !exists,
      exists,
    }));
    items.sort((a, b) =>
      getCombinationLabel(a.combination).localeCompare(
        getCombinationLabel(b.combination)
      )
    );
    setAllCombinations(items);
  }, [currentStep, derivedCombinations, getCombinationLabel]);

  const handleClose = () => {
    setOpen(false);
    setCurrentStep(WizardStep.VARIANTS);
    setSelectedVariants([]);
    setAllCombinations([]);
    setIsSubmitting(false);
  };

  const handleVariantChange = (variantId: number) => {
    setSelectedVariants((prev) =>
      prev.includes(variantId)
        ? prev.filter((id) => id !== variantId)
        : [...prev, variantId]
    );
  };

  const handleSelectAllInCategory = (categoryId: number, select: boolean) => {
    const category = categories?.find((cat) => cat.id === categoryId);
    if (!category) return;
    const variantIds = category.variants.map((v) => v.id);
    setSelectedVariants((prev) =>
      select
        ? [...prev, ...variantIds.filter((id) => !prev.includes(id))]
        : prev.filter((id) => !variantIds.includes(id))
    );
    if (!expandedCategories.has(categoryId)) {
      setExpandedCategories((prev) => new Set(prev).add(categoryId));
    }
  };

  const toggleCategory = (categoryId: number) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const handleCombinationToggle = (combination: number[]) => {
    setAllCombinations((prev) =>
      prev.map((item) =>
        arraysEqual(item.combination, combination) && !item.exists
          ? { ...item, selected: !item.selected }
          : item
      )
    );
  };

  const selectedCombinations = useMemo(
    () =>
      allCombinations
        .filter((item) => item.selected && !item.exists)
        .map((item) => item.combination),
    [allCombinations]
  );

  // No combinations are available to add when every derived combination
  // already exists (each one is rendered disabled).
  const noCombinationsAvailable =
    allCombinations.length === 0 ||
    allCombinations.every((item) => item.exists);

  const canProceed = () => {
    switch (currentStep) {
      case WizardStep.VARIANTS:
        return selectedVariants.length > 0;
      case WizardStep.COMBINATIONS:
        return (
          !noCombinationsAvailable &&
          allCombinations.some((item) => item.selected)
        );
      case WizardStep.CONFIRMATION:
        return selectedCombinations.length > 0;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (!canProceed()) return;
    setCurrentStep((prev) =>
      Math.min(prev + 1, WizardStep.CONFIRMATION)
    ) as unknown as void;
  };

  const handleBack = () => {
    setCurrentStep((prev) =>
      Math.max(prev - 1, WizardStep.VARIANTS)
    ) as unknown as void;
  };

  const handleSubmit = async () => {
    if (selectedCombinations.length === 0) return;
    setIsSubmitting(true);
    try {
      for (const combination of selectedCombinations) {
        await createConfigurations({
          data: {
            name: getCombinationLabel(combination),
            variants: {
              create: combination.map((variantId) => ({
                variant: { connect: { id: variantId } },
              })),
            },
          },
        });
      }
      handleClose();
    } catch (error) {
      console.error("Error creating configurations:", error);
      setIsSubmitting(false);
    }
  };

  const isLastStep = currentStep === WizardStep.CONFIRMATION;

  const stepTitles = [
    tVariants("title"),
    tCombinations("selectCombination"),
    tCombinations("title"),
  ];

  return (
    <>
      <Button onClick={() => setOpen(true)} type="button">
        <PlusCircle className="w-4" />
        <span className="hidden md:inline">{t("addConfiguration")}</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => (o ? setOpen(true) : handleClose())}
      >
        <DialogContent className="sm:max-w-[700px] lg:max-w-[900px] h-[80vh] flex flex-col overflow-hidden">
          <Form {...form}>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex flex-col flex-1 min-h-0 mt-4"
            >
              <DialogHeader className="mb-4">
                <DialogTitle className="flex items-center gap-2">
                  <CirclePlus className="h-5 w-5" />
                  {t("addConfiguration")}
                </DialogTitle>
                <DialogDescription>
                  {tVariants("description")}
                </DialogDescription>
              </DialogHeader>

              {/* Step indicator */}
              <div className="flex items-center gap-2 mb-4">
                {stepTitles.map((_, index) => {
                  const Icon = stepIcons[index];
                  const isClickable = index < currentStep;
                  return (
                    <div key={index} className="flex items-center">
                      <button
                        type="button"
                        onClick={() => isClickable && setCurrentStep(index)}
                        disabled={!isClickable && index !== currentStep}
                        className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                          index < currentStep
                            ? "bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90"
                            : index === currentStep
                              ? "bg-primary/10 text-primary border-2 border-primary"
                              : "bg-muted text-muted-foreground cursor-not-allowed"
                        }`}
                      >
                        {index < currentStep ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : (
                          <Icon className="w-5 h-5" />
                        )}
                      </button>
                      {index < stepTitles.length - 1 && (
                        <div
                          className={`w-12 h-0.5 mx-2 ${
                            index < currentStep ? "bg-primary" : "bg-muted"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="text-sm text-muted-foreground mb-2">
                {stepTitles[currentStep]}
              </div>

              <ScrollArea className="flex-1 min-h-0 pr-4">
                {currentStep === WizardStep.VARIANTS && (
                  <div className="space-y-4">
                    {categories
                      ?.filter((category) => category.variants.length > 0)
                      .map((category) => (
                        <FormItem key={category.id}>
                          <div className="flex items-center justify-between">
                            <FormLabel
                              className="flex items-center cursor-pointer"
                              onClick={() => toggleCategory(category.id)}
                            >
                              {expandedCategories.has(category.id) ? (
                                <ChevronDown className="mr-2" />
                              ) : (
                                <ChevronRight className="mr-2" />
                              )}
                              {category.name}
                            </FormLabel>
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              onClick={() =>
                                handleSelectAllInCategory(
                                  category.id,
                                  !category.variants.every((variant) =>
                                    selectedVariants.includes(variant.id)
                                  )
                                )
                              }
                            >
                              {category.variants.every((variant) =>
                                selectedVariants.includes(variant.id)
                              )
                                ? tCommon("actions.deselectAll")
                                : tCommon("actions.selectAll")}
                            </Button>
                          </div>
                          {expandedCategories.has(category.id) && (
                            <div className="pl-6 space-y-2">
                              {category.variants.map((variant) => (
                                <FormControl key={variant.id}>
                                  <Label className="flex items-center space-x-2">
                                    <Checkbox
                                      checked={selectedVariants.includes(
                                        variant.id
                                      )}
                                      onCheckedChange={() =>
                                        handleVariantChange(variant.id)
                                      }
                                    />
                                    <span>{variant.name}</span>
                                  </Label>
                                </FormControl>
                              ))}
                            </div>
                          )}
                          <Separator />
                        </FormItem>
                      ))}
                  </div>
                )}

                {currentStep === WizardStep.COMBINATIONS && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {tCombinations("selectCombinationDescription")}
                    </p>
                    {allCombinations.length === 0 ? (
                      <div>{tCombinations("allExist")}</div>
                    ) : (
                      allCombinations.map(
                        ({ combination, selected, exists }, index) => (
                          <FormControl key={index}>
                            <Label
                              className={`flex items-center space-x-2 space-y-0 ${
                                exists
                                  ? "cursor-not-allowed opacity-60"
                                  : "cursor-pointer"
                              }`}
                            >
                              <Checkbox
                                checked={selected}
                                disabled={exists}
                                onCheckedChange={() =>
                                  handleCombinationToggle(combination)
                                }
                              />
                              <span>{getCombinationLabel(combination)}</span>
                              {exists && (
                                <span className="text-xs text-muted-foreground italic">
                                  {tCombinations("alreadyExists")}
                                </span>
                              )}
                            </Label>
                          </FormControl>
                        )
                      )
                    )}
                    {!noCombinationsAvailable && !canProceed() && (
                      <p className="text-destructive">
                        {tCombinations("selectAtLeast")}
                      </p>
                    )}
                  </div>
                )}

                {currentStep === WizardStep.CONFIRMATION && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {tCombinations("confirmDescription", {
                        count: selectedCombinations.length,
                      })}
                    </p>
                    <div className="space-y-1">
                      {selectedCombinations.map((combination, index) => (
                        <FormItem key={index}>
                          <Label>{getCombinationLabel(combination)}</Label>
                        </FormItem>
                      ))}
                    </div>
                  </div>
                )}
              </ScrollArea>

              <DialogFooter className="flex items-center justify-between shrink-0 pt-4">
                <div className="flex items-center gap-2">
                  {currentStep > WizardStep.VARIANTS && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleBack}
                      disabled={isSubmitting}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      {tCommon("actions.previous")}
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClose}
                    disabled={isSubmitting}
                  >
                    {tCommon("cancel")}
                  </Button>
                  {isLastStep ? (
                    <Button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSubmitting || !canProceed()}
                    >
                      {isSubmitting ? (
                        tCommon("actions.submitting")
                      ) : (
                        <>
                          <Check className="h-4 w-4" />
                          {tCommon("actions.submit")}
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleNext}
                      disabled={!canProceed()}
                    >
                      {tCommon("actions.next")}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AddConfigurationWizard;
