"use client";

import { useSession } from "next-auth/react";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns } from "./columns";
import { ResultEditingPolicyCard } from "./ResultEditingPolicyCard";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  const { mutateAsync: updateStatus } = useClientQueries(schema).status.useUpdate();

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
      <ResultEditingPolicyCard />
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle>{tCommon("labels.statuses")}</CardTitle>
            </div>
            <div>
              <Button onClick={() => setAddStatusOpen(true)}>
                <CirclePlus className="w-4" />
                <span className="hidden md:inline">{t("add.button")}</span>
              </Button>
              {addStatusOpen && (
                <AddStatus
                  open={addStatusOpen}
                  onClose={() => setAddStatusOpen(false)}
                />
              )}
            </div>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row justify-between">
            <div className="flex flex-col w-full sm:w-1/3 min-w-[150px]">
              <ColumnSelection
                key="status-column-selection"
                storageKey="admin-statuses"
                columns={columns}
                onVisibilityChange={setColumnVisibility}
              />
            </div>
          </div>
          <div className="mt-4 w-fit">
            <DataTable
              columns={columns}
              data={statuses as any}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
            />
          </div>
        </CardContent>
      </Card>
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
