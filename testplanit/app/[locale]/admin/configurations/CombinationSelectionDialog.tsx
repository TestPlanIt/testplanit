"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Form, FormControl } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { useFindManyConfigurations } from "~/lib/hooks";

interface CombinationSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onPrevious: () => void;
  selectedVariants: number[];
  onNext: (selectedCombinations: number[][]) => void;
  categories: {
    id: number;
    name: string;
    variants: { id: number; name: string }[];
  }[];
}

const CombinationSelectionDialog: React.FC<CombinationSelectionDialogProps> = ({
  open,
  onClose,
  onPrevious,
  selectedVariants,
  onNext,
  categories,
}) => {
  const [selectedCombinations, setSelectedCombinations] = useState<number[][]>(
    []
  );
  const [allCombinations, setAllCombinations] = useState<
    { combination: number[]; selected: boolean }[]
  >([]);
  const [showError, setShowError] = useState(false);
  const t = useTranslations("admin.configurations.combinations");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const { data: existingConfigurations } = useFindManyConfigurations({
    where: { isDeleted: false },
    include: { variants: true },
  });

  const form = useForm({
    defaultValues: {
      combinations: selectedCombinations,
    },
  });

  const generateCombinations = useCallback((arrays: number[][]): number[][] => {
    if (arrays.length === 0) return [[]];

    const combinations = generateCombinations(arrays.slice(1));
    return arrays[0].flatMap((value) =>
      combinations.map((combination) => [value, ...combination])
    );
  }, []);

  const arraysEqual = (a: number[], b: number[]): boolean => {
    if (a.length !== b.length) return false;
    return a.every((val, index) => val === b[index]);
  };

  const getVariantNames = useCallback(
    (combination: number[]): string => {
      return combination
        .map(
          (variantId) =>
            categories
              .flatMap((cat) => cat.variants)
              .find((v) => v.id === variantId)?.name
        )
        .filter(Boolean)
        .join(", ");
    },
    [categories]
  );

  const filteredCombinations = useMemo(() => {
    const categoryMap = new Map<number, number[]>();

    selectedVariants.forEach((variantId) => {
      const category = categories.find((cat) =>
        cat.variants.some((variant) => variant.id === variantId)
      );
      if (category) {
        if (!categoryMap.has(category.id)) {
          categoryMap.set(category.id, []);
        }
        categoryMap.get(category.id)!.push(variantId);
      }
    });

    const combinations = generateCombinations([...categoryMap.values()]);

    return combinations.filter(
      (combination) =>
        !existingConfigurations?.some((config) =>
          arraysEqual(
            config.variants.map((v) => v.variantId).sort(),
            combination.sort()
          )
        )
    );
  }, [
    selectedVariants,
    existingConfigurations,
    categories,
    generateCombinations,
  ]);

  useEffect(() => {
    const allCombinationsWithState = filteredCombinations.map(
      (combination) => ({
        combination,
        selected: true,
      })
    );
    allCombinationsWithState.sort((a, b) =>
      getVariantNames(a.combination).localeCompare(
        getVariantNames(b.combination)
      )
    );
    setAllCombinations(allCombinationsWithState);
  }, [filteredCombinations, getVariantNames]);

  const handleCombinationChange = (combination: number[]) => {
    setAllCombinations((prev) =>
      prev.map((item) =>
        arraysEqual(item.combination, combination)
          ? { ...item, selected: !item.selected }
          : item
      )
    );
  };

  useEffect(() => {
    setShowError(allCombinations.every((item) => !item.selected));
  }, [allCombinations]);

  const handleNext = () => {
    const selected = allCombinations
      .filter((item) => item.selected)
      .map((item) => item.combination);
    if (selected.length > 0) {
      onNext(selected);
    }
  };

  const noCombinationsAvailable = allCombinations.length === 0;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleNext)} className="space-y-2">
            <DialogHeader>
              <DialogTitle>{t("selectCombination")}</DialogTitle>
              <div className="text-muted-foreground text-sm">{tGlobal("common.fields.step")}</div>
            </DialogHeader>
            <DialogDescription>
              {t("selectCombinationDescription")}
            </DialogDescription>
            {noCombinationsAvailable ? (
              <div>{t("allExist")}</div>
            ) : (
              allCombinations.map(({ combination, selected }, index) => (
                <FormControl key={index}>
                  <Label className="flex items-center space-x-2 space-y-0">
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() =>
                        handleCombinationChange(combination)
                      }
                    />
                    <span>{getVariantNames(combination)}</span>
                  </Label>
                </FormControl>
              ))
            )}
            {showError && (
              <p className="text-destructive">{t("selectAtLeast")}</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} type="button">
                {tCommon("actions.cancel")}
              </Button>
              <Button variant="outline" onClick={onPrevious} type="button">
                {tCommon("actions.previous")}
              </Button>
              <Button
                type="submit"
                disabled={noCombinationsAvailable || showError}
              >
                {tCommon("actions.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default CombinationSelectionDialog;
