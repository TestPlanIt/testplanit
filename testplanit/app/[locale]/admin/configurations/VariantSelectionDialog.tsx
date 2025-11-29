"use client";

import React, { useState, useEffect } from "react";
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
import { Separator } from "@/components/ui/separator";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Form, FormItem, FormControl, FormLabel } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { useFindManyConfigCategories } from "~/lib/hooks";

interface VariantSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  onNext: (selectedVariants: number[]) => void;
}

const VariantSelectionDialog: React.FC<VariantSelectionDialogProps> = ({
  open,
  onClose,
  onNext,
}) => {
  const [selectedVariants, setSelectedVariants] = useState<number[]>([]);
  const t = useTranslations("admin.configurations.variants.selection");
  const tCommon = useTranslations("common");

  const { data: categories } = useFindManyConfigCategories({
    where: { isDeleted: false },
    include: {
      variants: {
        where: {
          isEnabled: true,
        },
      },
    },
  });
  const [expandedCategories, setExpandedCategories] = useState<Set<number>>(
    new Set()
  );

  useEffect(() => {
    if (categories) {
      setExpandedCategories(new Set(categories.map((category) => category.id)));
    }
  }, [categories]);

  const form = useForm({
    defaultValues: {
      variants: selectedVariants,
    },
  });

  const handleVariantChange = (variantId: number) => {
    setSelectedVariants((prev) =>
      prev.includes(variantId)
        ? prev.filter((id) => id !== variantId)
        : [...prev, variantId]
    );
  };

  const handleSelectAll = (categoryId: number, select: boolean) => {
    const category = categories?.find((cat) => cat.id === categoryId);
    if (!category) return;

    const variantIds = category.variants.map((variant) => variant.id);
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
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  const handleNext = () => {
    if (selectedVariants.length > 0) {
      onNext(selectedVariants);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[1000px]">
        <Form {...form}>
          <form className="space-y-4">
            <DialogHeader>
              <DialogTitle>
                <div>{t("title")}</div>
                <div className="text-muted-foreground text-sm">
                  {tCommon("fields.step")}
                </div>
              </DialogTitle>
            </DialogHeader>
            <DialogDescription>{t("description")}</DialogDescription>
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
                      onClick={() =>
                        handleSelectAll(
                          category.id,
                          !category.variants.every((variant) =>
                            selectedVariants.includes(variant.id)
                          )
                        )
                      }
                      type="button"
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
                              checked={selectedVariants.includes(variant.id)}
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
            <DialogFooter>
              <Button variant="outline" onClick={onClose} type="button">
                {tCommon("actions.cancel")}
              </Button>
              <Button onClick={handleNext} type="button">
                {tCommon("actions.next")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default VariantSelectionDialog;
