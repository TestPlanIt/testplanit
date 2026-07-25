"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns } from "./columns";
import { ResultEditingPolicyCard } from "./ResultEditingPolicyCard";

import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CirclePlus } from "lucide-react";
import { AddStatus } from "./AddStatus";
import { ExtendedStatus } from "./columns";
import { DeleteStatus } from "./DeleteStatus";
import { EditStatus } from "./EditStatus";

export default function StatusList() {
  return <Status />;
}

function Status() {
  const t = useTranslations("admin.statuses");
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const { mutateAsync: updateStatus } =
    useClientQueries(schema).status.useUpdate();

  // Stabilize mutation ref — ZenStack's mutateAsync changes identity every render
  const updateStatusRef = useRef(updateStatus);
  useEffect(() => {
    updateStatusRef.current = updateStatus;
  });

  const { data } = useClientQueries(schema).status.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: { order: "asc" },
      include: {
        color: true,
        scope: {
          include: {
            scope: true,
          },
          orderBy: { scope: { name: "desc" } },
        },
        projects: {
          where: {
            project: {
              isDeleted: false,
            },
          },
        },
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );
  const statuses = data;

  const handleToggleEnabled = useCallback(
    async (id: number, isEnabled: boolean) => {
      try {
        await updateStatusRef.current({
          where: { id },
          data: { isEnabled },
        });
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    []
  );

  const handleToggleSuccess = useCallback(
    async (id: number, isSuccess: boolean) => {
      try {
        await updateStatusRef.current({
          where: { id },
          data: { isSuccess, isFailure: isSuccess ? false : undefined },
        });
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    []
  );

  const handleToggleFailure = useCallback(
    async (id: number, isFailure: boolean) => {
      try {
        await updateStatusRef.current({
          where: { id },
          data: { isFailure, isSuccess: isFailure ? false : undefined },
        });
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    []
  );

  const handleToggleCompleted = useCallback(
    async (id: number, isCompleted: boolean) => {
      try {
        await updateStatusRef.current({
          where: { id },
          data: { isCompleted },
        });
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    []
  );

  const [editingStatus, setEditingStatus] = useState<ExtendedStatus | null>(
    null
  );
  const [deletingStatus, setDeletingStatus] = useState<ExtendedStatus | null>(
    null
  );

  /* eslint-disable react-hooks/refs */
  const columns = useMemo(
    () =>
      getColumns(
        handleToggleEnabled,
        handleToggleSuccess,
        handleToggleFailure,
        handleToggleCompleted,
        tCommon,
        setEditingStatus,
        setDeletingStatus
      ),
    [
      handleToggleEnabled,
      handleToggleSuccess,
      handleToggleFailure,
      handleToggleCompleted,
      tCommon,
    ]
  );
  /* eslint-enable react-hooks/refs */

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [addStatusOpen, setAddStatusOpen] = useState(false);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  if (status === "loading") return null;

  if (!session || session.user.access !== "ADMIN") {
    return null;
  }

  return (
    <main>
      <Card className="mb-6">
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle>{tCommon("labels.statuses")}</CardTitle>
              <HelpPopover helpKey="statuses" />
            </SectionHeader>
            <Button
              onClick={() => setAddStatusOpen(true)}
              aria-label={t("add.button")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <CirclePlus className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                {t("add.button")}
              </span>
            </Button>
          </div>
          {addStatusOpen && (
            <AddStatus
              open={addStatusOpen}
              onClose={() => setAddStatusOpen(false)}
            />
          )}
        </CardHeader>
        <CardContent>
          <ColumnSelection
            key="status-column-selection"
            storageKey="admin-statuses"
            columns={columns}
            onVisibilityChange={setColumnVisibility}
          />
          <div className="mt-4">
            <DataTable
              columns={columns}
              data={statuses as any}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              storageKey="admin-statuses"
              enableColumnMenu={false}
            />
          </div>
        </CardContent>
      </Card>
      <ResultEditingPolicyCard />
      {editingStatus && (
        <EditStatus
          status={editingStatus}
          open={true}
          onClose={() => setEditingStatus(null)}
        />
      )}
      {deletingStatus && (
        <DeleteStatus
          status={deletingStatus}
          open={true}
          onClose={() => setDeletingStatus(null)}
        />
      )}
    </main>
  );
}
