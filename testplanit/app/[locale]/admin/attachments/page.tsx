"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { RowSelectionState } from "@tanstack/react-table";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Copy, HardDrive, Paperclip, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DateFormatter } from "@/components/DateFormatter";
import { useDebounce } from "@/components/Debounce";
import { ProjectIcon } from "@/components/ProjectIcon";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionHeader } from "@/components/ui/typography";
import { apiFetch } from "~/lib/basePath";
import { usePathname, useRouter } from "~/lib/navigation";
import { schema } from "~/zenstack/schema";
import {
  ATTACHMENT_PARENT_TYPES,
  ATTACHMENT_STATUSES,
  MAX_ACTION_ATTACHMENTS,
  NO_MIME_TYPE,
  type AttachmentParentType,
  type AttachmentStatus,
} from "~/lib/services/adminAttachmentRules";
import type {
  AdminAttachment,
  AttachmentMimeType,
} from "~/lib/services/adminAttachments";
import {
  AttachmentActionButtons,
  AttachmentActionDialog,
  type AttachmentActionRequest,
} from "./AttachmentActions";
import { AttachedTo, useAttachmentLabels, useColumns } from "./columns";
import { StorageObjects } from "./StorageObjects";

interface UserOption {
  id: string;
  name: string;
  email: string;
}

interface ProjectOption {
  id: number;
  name: string;
  iconUrl: string | null;
}

/** One page of a fixed option list, narrowed to the labels matching `query`. */
function pageOfOptions<T extends string>(
  options: readonly T[],
  label: (option: T) => string,
  query: string,
  page: number,
  size: number
): { results: T[]; total: number } {
  const term = query.trim().toLowerCase();
  const matching = term
    ? options.filter((option) => label(option).toLowerCase().includes(term))
    : [...options];
  return {
    results: matching.slice(page * size, page * size + size),
    total: matching.length,
  };
}
const PAGE_SIZE = 100;

type AttachmentPage = { items: AdminAttachment[]; totalCount: number };

async function getJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return (await response.json()) as T;
}

/** A long value (a URL, a storage key) that wraps and can be copied. */
function CopyableValue({ value }: { value: string }) {
  const tCommon = useTranslations("common");
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 rounded bg-muted px-1.5 py-0.5 text-xs break-all">
        {value}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 shrink-0 px-1.5"
        aria-label={tCommon("actions.copy")}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => toast.success(tCommon("actions.copied")));
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function AttachmentDetail({ attachment }: { attachment: AdminAttachment }) {
  const t = useTranslations("admin.attachments");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const { storageKey } = attachment;
  const labels = useAttachmentLabels();

  return (
    <dl
      className="grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-4 gap-y-2 p-2 text-sm"
      data-testid={`attachment-detail-${attachment.id}`}
    >
      {attachment.note && (
        <>
          <dt className="text-muted-foreground">{tCommon("fields.note")}</dt>
          <dd>{attachment.note}</dd>
        </>
      )}
      <dt className="text-muted-foreground">
        {tCommon("upload.attachments.link.urlLabel")}
      </dt>
      <dd>
        <CopyableValue value={attachment.url} />
      </dd>
      {attachment.kind === "file" && (
        <>
          <dt className="text-muted-foreground">{t("detail.storageKey")}</dt>
          <dd>
            {storageKey ? (
              <CopyableValue value={storageKey} />
            ) : (
              <span className="text-muted-foreground">
                {t("detail.notInStorage")}
              </span>
            )}
          </dd>
        </>
      )}
      {attachment.parent && (
        <>
          <dt className="text-muted-foreground">
            {t("detail.attachedThrough")}
          </dt>
          <dd className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <AttachedTo parent={attachment.parent} />
            </div>
            {attachment.parent.type !== attachment.parent.entity && (
              <Badge variant="outline" className="shrink-0">
                {labels.parent(attachment.parent.type)}
              </Badge>
            )}
          </dd>
        </>
      )}
      {attachment.deletedAt && (
        <>
          <dt className="text-muted-foreground">{tCommon("status.deleted")}</dt>
          <dd>
            <DateFormatter
              date={attachment.deletedAt}
              formatString={session?.user?.preferences?.dateFormat}
              timezone={session?.user?.preferences?.timezone}
            />
          </dd>
        </>
      )}
    </dl>
  );
}

export default function AdminAttachmentsPage() {
  const t = useTranslations("admin.attachments");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status: sessionStatus } = useSession();
  const router = useRouter();
  const isAdmin = session?.user?.access === "ADMIN";

  const [parentTypes, setParentTypes] = useState<AttachmentParentType[]>([]);
  const [statuses, setStatuses] = useState<AttachmentStatus[]>([]);
  // The tab lives in the URL so the Storage view can be linked to.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const tab: "attachments" | "storage" =
    searchParams?.get("tab") === "storage" ? "storage" : "attachments";
  const setTab = (value: "attachments" | "storage") => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "storage") params.set("tab", value);
    else params.delete("tab");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const { data: allProjects } = useClientQueries(schema).projects.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, iconUrl: true },
    },
    { enabled: isAdmin }
  );
  const [creators, setCreators] = useState<UserOption[]>([]);
  const { data: allUsers } = useClientQueries(schema).user.useFindMany(
    { orderBy: { name: "asc" }, select: { id: true, name: true, email: true } },
    { enabled: isAdmin }
  );
  const fetchCreators = useCallback(
    async (query: string, page: number, size: number) => {
      const term = query.trim().toLowerCase();
      const matching = (allUsers ?? []).filter(
        (user) =>
          user.name.toLowerCase().includes(term) ||
          user.email.toLowerCase().includes(term)
      );
      return {
        results: matching.slice(page * size, page * size + size),
        total: matching.length,
      };
    },
    [allUsers]
  );
  const fetchProjects = useCallback(
    async (query: string, page: number, size: number) => {
      const term = query.trim().toLowerCase();
      const matching = (allProjects ?? []).filter((project) =>
        project.name.toLowerCase().includes(term)
      );
      return {
        results: matching.slice(page * size, page * size + size),
        total: matching.length,
      };
    },
    [allProjects]
  );
  const [searchString, setSearchString] = useState("");
  const debouncedSearch = useDebounce(searchString, 400);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "createdAt", direction: "desc" });
  const [sameFileAs, setSameFileAs] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const labels = useAttachmentLabels();
  const [mimeTypes, setMimeTypes] = useState<AttachmentMimeType[]>([]);
  // The types in use, read once when the picker first opens and then
  // searched and paged here.
  const mimeTypesRef = useRef<Promise<AttachmentMimeType[]> | null>(null);
  const fetchMimeTypes = useCallback(
    async (query: string, page: number, size: number) => {
      mimeTypesRef.current ??= getJson<AttachmentMimeType[]>(
        "/api/admin/attachments/types"
      ).catch((error) => {
        mimeTypesRef.current = null;
        throw error;
      });
      const all = await mimeTypesRef.current;
      const term = query.trim().toLowerCase();
      const matching = term
        ? all.filter(
            (type) =>
              labels.mimeType(type.mimeType).toLowerCase().includes(term) ||
              type.mimeType.toLowerCase().includes(term)
          )
        : all;
      return {
        results: matching.slice(page * size, page * size + size),
        total: matching.length,
      };
    },
    [labels]
  );
  const fetchParentTypes = useCallback(
    async (query: string, page: number, size: number) =>
      pageOfOptions(ATTACHMENT_PARENT_TYPES, labels.parent, query, page, size),
    [labels]
  );
  const fetchStatuses = useCallback(
    async (query: string, page: number, size: number) =>
      pageOfOptions(ATTACHMENT_STATUSES, labels.status, query, page, size),
    [labels]
  );
  const [detail, setDetail] = useState<AdminAttachment | null>(null);

  useEffect(() => {
    if (sessionStatus !== "loading" && !session) router.push("/");
  }, [sessionStatus, session, router]);

  const params = useMemo(() => {
    const search = new URLSearchParams({
      sortBy: sortConfig.column,
      sortDir: sortConfig.direction,
      take: String(PAGE_SIZE),
    });
    if (parentTypes.length > 0)
      search.set("parentTypes", parentTypes.join(","));
    if (statuses.length > 0) search.set("statuses", statuses.join(","));
    if (creators.length > 0) {
      search.set("createdByIds", creators.map((user) => user.id).join(","));
    }
    if (projects.length > 0) {
      search.set("projectIds", projects.map((project) => project.id).join(","));
    }
    if (debouncedSearch.trim()) search.set("q", debouncedSearch.trim());
    if (mimeTypes.length > 0) {
      search.set(
        "mimeTypes",
        mimeTypes.map((type) => type.mimeType || NO_MIME_TYPE).join(",")
      );
    }
    if (sameFileAs) search.set("sameFileAs", String(sameFileAs.id));
    return search.toString();
  }, [
    parentTypes,
    statuses,
    projects,
    creators,
    debouncedSearch,
    mimeTypes,
    sameFileAs,
    sortConfig,
  ]);

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["admin-attachments", params],
    queryFn: ({ pageParam }) =>
      getJson<AttachmentPage>(
        `/api/admin/attachments?${params}&skip=${pageParam}`
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + page.items.length, 0);
      return lastPage.items.length < PAGE_SIZE || loaded >= lastPage.totalCount
        ? undefined
        : loaded;
    },
    enabled: isAdmin,
  });
  const items = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data]
  );
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );
  const showSameFile = useCallback((attachment: AdminAttachment) => {
    setSameFileAs({ id: attachment.id, name: attachment.name });
  }, []);
  const [actionRequest, setActionRequest] =
    useState<AttachmentActionRequest | null>(null);
  const columns = useColumns(
    userPreferences,
    t,
    tCommon,
    showSameFile,
    setDetail,
    setActionRequest
  );
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const hideColumnRef = useRef<((columnId: string) => void) | null>(null);

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // A selection belongs to the list it was made in.
  useEffect(() => setRowSelection({}), [params]);
  const selectedIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, picked]) => picked)
        .map(([id]) => Number(id)),
    [rowSelection]
  );
  const selected = useMemo(
    () => items.filter((item) => rowSelection[String(item.id)]),
    [items, rowSelection]
  );

  const locale = useLocale();
  const totalItems = data?.pages[0]?.totalCount ?? 0;

  // Selecting every match means ids the list has not paged in yet, so they
  // are fetched on demand, and only when asked for.
  const [selectingAll, setSelectingAll] = useState(false);
  const selectAllMatches = async () => {
    setSelectingAll(true);
    try {
      const { ids } = await getJson<{ ids: number[] }>(
        `/api/admin/attachments/ids?${params}`
      );
      setRowSelection(Object.fromEntries(ids.map((id) => [String(id), true])));
    } catch {
      toast.error(tCommon("errors.somethingWentWrong"));
    } finally {
      setSelectingAll(false);
    }
  };
  const allLoadedSelected =
    items.length > 0 && selected.length === items.length;
  const allMatchesSelected =
    allLoadedSelected && totalItems > 0 && selectedIds.length >= totalItems;

  if (sessionStatus === "loading" || !isAdmin) return null;

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle data-testid="admin-attachments-title">
              {tGlobal("admin.menu.attachments")}
            </CardTitle>
            <HelpPopover helpKey="attachments" />
          </SectionHeader>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={tab}
            onValueChange={(value) =>
              setTab(value as "attachments" | "storage")
            }
          >
            <TabsList className="w-full">
              <TabsTrigger
                value="attachments"
                data-testid="attachments-tab"
                className="w-1/2 gap-2"
              >
                <Paperclip className="h-4 w-4" />
                {tCommon("fields.attachments")}
              </TabsTrigger>
              <TabsTrigger
                value="storage"
                data-testid="storage-tab"
                className="w-1/2 gap-2"
              >
                <HardDrive className="h-4 w-4" />
                {t("storage.tab")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="storage" className="mt-4">
              <StorageObjects
                onShowMissingFiles={() => {
                  setStatuses(["fileMissing"]);
                  setTab("attachments");
                }}
              />
            </TabsContent>
            <TabsContent value="attachments" className="mt-4 space-y-4">
              <Filter
                key="admin-attachments-filter"
                placeholder={t("filterPlaceholder")}
                initialSearchString={searchString}
                onSearchChange={setSearchString}
              />
              <div
                className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2 lg:grid-cols-5"
                data-testid="attachments-filters"
              >
                <div
                  className="min-w-0"
                  data-testid="attachments-status-filter"
                >
                  <MultiAsyncCombobox<AttachmentStatus>
                    value={statuses}
                    onValueChange={setStatuses}
                    fetchOptions={fetchStatuses}
                    getOptionValue={(status) => status}
                    getOptionLabel={labels.status}
                    renderOption={(status) => (
                      <span className="truncate">{labels.status(status)}</span>
                    )}
                    placeholder={tCommon("filters.allStatuses")}
                    ariaLabel={tCommon("actions.status")}
                  />
                </div>
                <div
                  className="min-w-0"
                  data-testid="attachments-parent-filter"
                >
                  <MultiAsyncCombobox<AttachmentParentType>
                    value={parentTypes}
                    onValueChange={setParentTypes}
                    fetchOptions={fetchParentTypes}
                    getOptionValue={(type) => type}
                    getOptionLabel={labels.parent}
                    renderOption={(type) => (
                      <span className="truncate">{labels.parent(type)}</span>
                    )}
                    placeholder={`${t("attachedTo.label")}: ${tCommon("filters.all")}`}
                    ariaLabel={t("attachedTo.label")}
                  />
                </div>
                <div
                  className="min-w-0"
                  data-testid="attachments-project-filter"
                >
                  <MultiAsyncCombobox<ProjectOption>
                    value={projects}
                    onValueChange={setProjects}
                    fetchOptions={fetchProjects}
                    getOptionValue={(project) => project.id}
                    getOptionLabel={(project) => project.name}
                    renderOption={(project) => (
                      <span className="flex min-w-0 items-center gap-2">
                        <ProjectIcon
                          iconUrl={project.iconUrl}
                          width={16}
                          height={16}
                        />
                        <span className="truncate">{project.name}</span>
                      </span>
                    )}
                    renderSelectedOption={(project) => (
                      <span>{project.name}</span>
                    )}
                    placeholder={tGlobal("admin.auditLogs.allProjects")}
                    ariaLabel={tCommon("fields.projects")}
                  />
                </div>
                <div className="min-w-0" data-testid="attachments-type-filter">
                  <MultiAsyncCombobox<AttachmentMimeType>
                    value={mimeTypes}
                    onValueChange={setMimeTypes}
                    fetchOptions={fetchMimeTypes}
                    getOptionValue={(type) => type.mimeType || NO_MIME_TYPE}
                    getOptionLabel={(type) => labels.mimeType(type.mimeType)}
                    renderOption={(type) => (
                      <span className="flex w-full min-w-0 items-center justify-between gap-2">
                        <span className="truncate" title={type.mimeType}>
                          {labels.mimeType(type.mimeType)}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {type.count.toLocaleString(locale)}
                        </span>
                      </span>
                    )}
                    placeholder={tGlobal("search.allTypes")}
                    ariaLabel={tCommon("fields.type")}
                  />
                </div>
                <div
                  className="min-w-0"
                  data-testid="attachments-creator-filter"
                >
                  <MultiAsyncCombobox<UserOption>
                    value={creators}
                    onValueChange={setCreators}
                    fetchOptions={fetchCreators}
                    getOptionValue={(user) => user.id}
                    getOptionLabel={(user) => user.name}
                    renderOption={(user) => (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {user.name}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </span>
                      </span>
                    )}
                    placeholder={tGlobal("repository.views.allCreators")}
                    ariaLabel={tCommon("fields.createdBy")}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ColumnSelection
                    key="admin-attachments-column-selection"
                    storageKey="admin-attachments"
                    columns={columns}
                    onVisibilityChange={setColumnVisibility}
                    hideColumnRef={hideColumnRef}
                  />
                  {selectedIds.length > 0 && (
                    <div
                      className="flex flex-wrap items-center gap-2"
                      data-testid="attachments-bulk-actions"
                    >
                      <span className="text-sm text-muted-foreground">
                        {tCommon("labels.selected", {
                          count: selectedIds.length.toLocaleString(locale),
                        })}
                      </span>
                      <AttachmentActionButtons
                        ids={selectedIds}
                        attachments={selected}
                        onAction={setActionRequest}
                        testIdPrefix="attachments-bulk"
                      />
                    </div>
                  )}
                </div>
                {items.length > 0 && (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="attachments-showing"
                  >
                    {tGlobal("admin.auditLogs.showing", {
                      loaded: items.length.toLocaleString(locale),
                      total: totalItems.toLocaleString(locale),
                    })}
                  </p>
                )}
              </div>

              {allLoadedSelected &&
                totalItems > items.length &&
                !allMatchesSelected && (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm"
                    data-testid="attachments-select-all-matches-prompt"
                  >
                    <span>
                      {t("selection.loadedSelected", { shown: items.length })}
                    </span>
                    {totalItems <= MAX_ACTION_ATTACHMENTS ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => void selectAllMatches()}
                        disabled={selectingAll}
                        data-testid="attachments-select-all-matches"
                      >
                        {t("selection.selectAllMatches", { total: totalItems })}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">
                        {t("selection.tooMany", {
                          max: MAX_ACTION_ATTACHMENTS.toLocaleString(locale),
                        })}
                      </span>
                    )}
                  </div>
                )}
              {allMatchesSelected && totalItems > items.length && (
                <p
                  className="rounded-md bg-muted px-3 py-2 text-sm"
                  data-testid="attachments-all-matches-selected"
                >
                  {t("selection.allMatchesSelected", { total: totalItems })}
                </p>
              )}

              {sameFileAs && (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm"
                  data-testid="attachments-same-file-filter"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {t("sharedFile.showing", { name: sameFileAs.name })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSameFileAs(null)}
                  >
                    <X className="h-4 w-4" />
                    {tCommon("aria.clearFilter")}
                  </Button>
                </div>
              )}

              {isError ? (
                <p className="text-sm text-destructive">
                  {tCommon("errors.fetchFailed")}
                </p>
              ) : (
                <DataTable
                  virtualized
                  fillViewport
                  columns={columns as any}
                  data={items}
                  getRowId={(row: AdminAttachment) => String(row.id)}
                  rowSelection={rowSelection}
                  onRowSelectionChange={setRowSelection}
                  testIdPrefix="admin-attachments-table"
                  rowTestIdPrefix="attachment-row"
                  hasMore={!!hasNextPage}
                  onLoadMore={fetchNextPage}
                  resetKey={params}
                  onSortChange={(column) =>
                    setSortConfig({
                      column,
                      direction:
                        sortConfig.column === column &&
                        sortConfig.direction === "asc"
                          ? "desc"
                          : "asc",
                    })
                  }
                  onSortColumn={(column, direction) =>
                    setSortConfig(
                      direction === null
                        ? { column: "createdAt", direction: "desc" }
                        : { column, direction }
                    )
                  }
                  onHideColumn={(columnId) => hideColumnRef.current?.(columnId)}
                  sortConfig={sortConfig}
                  columnVisibility={columnVisibility}
                  onColumnVisibilityChange={setColumnVisibility}
                  isLoading={isLoading || isFetchingNextPage}
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="break-all">{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && <AttachmentDetail attachment={detail} />}
        </DialogContent>
      </Dialog>
      <AttachmentActionDialog
        request={actionRequest}
        onClose={() => setActionRequest(null)}
        onDone={() => {
          setActionRequest(null);
          setDetail(null);
          setRowSelection({});
        }}
      />
    </main>
  );
}
