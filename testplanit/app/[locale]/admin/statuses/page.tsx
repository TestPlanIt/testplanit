"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";

import { useFindManyStatus, useUpdateStatus } from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { getColumns } from "./columns";
import { ColumnSelection } from "@/components/tables/ColumnSelection";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { AddStatusModal } from "./AddStatus";

export default function StatusList() {
  return <Status />;
}

function Status() {
  const t = useTranslations("admin.statuses");
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const { mutateAsync: updateStatus } = useUpdateStatus();

  const { data } = useFindManyStatus(
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
        await updateStatus({
          where: { id },
          data: { isEnabled },
        });
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    [updateStatus]
  );

  const handleToggleSuccess = useCallback(
    async (id: number, isSuccess: boolean) => {
      try {
        await updateStatus({
          where: { id },
          data: { isSuccess, isFailure: isSuccess ? false : undefined },
        });
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    [updateStatus]
  );

  const handleToggleFailure = useCallback(
    async (id: number, isFailure: boolean) => {
      try {
        await updateStatus({
          where: { id },
          data: { isFailure, isSuccess: isFailure ? false : undefined },
        });
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    [updateStatus]
  );

  const handleToggleCompleted = useCallback(
    async (id: number, isCompleted: boolean) => {
      try {
        await updateStatus({
          where: { id },
          data: { isCompleted },
        });
      } catch (error) {
        console.error("Failed to update status:", error);
      }
    },
    [updateStatus]
  );

  const columns = useMemo(
    () =>
      getColumns(
        handleToggleEnabled,
        handleToggleSuccess,
        handleToggleFailure,
        handleToggleCompleted,
        tCommon
      ),
    [
      handleToggleEnabled,
      handleToggleSuccess,
      handleToggleFailure,
      handleToggleCompleted,
      tCommon,
    ]
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

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
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle>{tCommon("labels.statuses")}</CardTitle>
            </div>
            <div>
              <AddStatusModal />
            </div>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row justify-between">
            <div className="flex flex-col w-full sm:w-1/3 min-w-[150px]">
              <ColumnSelection
                key="status-column-selection"
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
    </main>
  );
}
