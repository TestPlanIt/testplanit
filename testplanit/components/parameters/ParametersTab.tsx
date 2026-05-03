"use client";

import { ParameterAddForm } from "@/components/parameters/ParameterAddForm";
import { ParameterRow } from "@/components/parameters/ParameterRow";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { TestCaseParameter } from "@prisma/client";
import { useQueryClient } from "@tanstack/react-query";
import { Braces } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ParametersTabProps {
  caseId: number;
  projectId: number;
  parameters: TestCaseParameter[];
}

export function ParametersTab({
  caseId,
  projectId,
  parameters,
}: ParametersTabProps) {
  const t = useTranslations("parameters");
  const queryClient = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = parameters.findIndex((p) => p.id === event.active.id);
    const newIndex = parameters.findIndex((p) => p.id === event.over!.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(parameters, oldIndex, newIndex);

    await Promise.all(
      reordered.map((p, idx) =>
        fetch(`/api/repository/cases/${caseId}/parameters/${p.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: idx }),
        })
      )
    );
    queryClient.invalidateQueries({
      queryKey: ["zenstack", "TestCaseParameter"],
    });
    queryClient.invalidateQueries({
      queryKey: ["zenstack", "RepositoryCases"],
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-card p-6 border-b">
        <ParameterAddForm
          caseId={caseId}
          projectId={projectId}
          existingCount={parameters.length}
        />
      </div>

      <div className="flex-1 px-6 py-2">
        {parameters.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center py-12 gap-2"
            data-testid="parameters-tab-empty"
          >
            <Braces className="w-8 h-8 text-muted-foreground" />
            <h3 className="text-base font-semibold">{t("emptyHeading")}</h3>
            <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis]}
          >
            <SortableContext
              items={parameters.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-3">
                {parameters.map((p) => (
                  <ParameterRow
                    key={p.id}
                    parameter={p}
                    caseId={caseId}
                    projectId={projectId}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
