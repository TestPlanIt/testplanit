"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import LoadingSpinner from "~/components/LoadingSpinner";
import { TemplateNameDisplay } from "~/components/TemplateNameDisplay";
import { WorkflowStateDisplay } from "~/components/WorkflowStateDisplay";
import { apiFetch } from "~/lib/basePath";
import {
  validateQaseMapping,
  type QaseAnalysis,
  type QaseFieldAction,
  type QaseMappingConfiguration,
  type QaseSourceField,
} from "~/services/imports/qase/mapping";
import type { QaseImportJobPayload } from "~/services/imports/qase/types";
import type { IconName } from "~/types/globals";

interface MappingResponse {
  analysis: QaseAnalysis;
  configuration: QaseMappingConfiguration;
}

interface QaseMappingStepProps {
  jobId: string;
  onStarted: (job: QaseImportJobPayload) => void;
}

interface PickerProps<T> {
  options: T[];
  value: T | null;
  onChange: (value: T | null) => void;
  getId: (option: T) => string | number;
  getLabel: (option: T) => string;
  render: (option: T) => ReactNode;
  ariaLabel: string;
  placeholder: string;
  testId: string;
}

function Picker<T>({
  options,
  value,
  onChange,
  getId,
  getLabel,
  render,
  ariaLabel,
  placeholder,
  testId,
}: PickerProps<T>) {
  const fetchOptions = useCallback(
    async (query: string) => {
      const needle = query.trim().toLowerCase();
      return needle
        ? options.filter((option) =>
            getLabel(option).toLowerCase().includes(needle)
          )
        : options;
    },
    [options, getLabel]
  );
  return (
    <div data-testid={testId}>
      <AsyncCombobox<T>
        value={value}
        onValueChange={onChange}
        fetchOptions={fetchOptions}
        renderOption={render}
        getOptionValue={getId}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        showPagination={false}
        minDropdownWidth={280}
        className="w-full"
      />
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export function QaseMappingStep({ jobId, onStarted }: QaseMappingStepProps) {
  const t = useTranslations("admin.imports.qase.mapping");
  const [config, setConfig] = useState<QaseMappingConfiguration | null>(null);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ["qase-import-mapping", jobId],
    queryFn: async (): Promise<MappingResponse> => {
      const response = await apiFetch(
        `/api/imports/qase/jobs/${jobId}/mapping`
      );
      if (!response.ok) {
        throw new Error("Failed to load the mapping");
      }
      return response.json();
    },
    staleTime: Infinity,
    gcTime: 0,
  });

  useEffect(() => {
    if (data) {
      setConfig(data.configuration);
    }
  }, [data]);

  const analysis = data?.analysis;
  const problems = useMemo(
    () => (analysis && config ? validateQaseMapping(config, analysis) : []),
    [analysis, config]
  );

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t("loadFailed")}</AlertDescription>
      </Alert>
    );
  }
  if (!analysis || !config) {
    return <LoadingSpinner />;
  }

  const { source, existing } = analysis;
  const problemFor = (code: string, subject?: string) =>
    problems.some(
      (problem) =>
        problem.code === code &&
        (subject === undefined ||
          ("subject" in problem && problem.subject === subject))
    );

  const setField = (
    key: string,
    patch: Partial<QaseMappingConfiguration["fields"][string]>
  ) =>
    setConfig((current) =>
      current
        ? {
            ...current,
            fields: {
              ...current.fields,
              [key]: { ...current.fields[key], ...patch },
            },
          }
        : current
    );

  const changeFieldAction = (field: QaseSourceField, action: QaseFieldAction) =>
    setField(field.key, {
      action,
      mappedTo: null,
      name: action === "create" ? field.title : "",
    });

  const unmatchedOptions = (
    field: QaseSourceField,
    targetId: number | null
  ) => {
    const target = existing.caseFields.find(
      (candidate) => candidate.id === targetId
    );
    if (!target || field.options.length === 0) {
      return [];
    }
    return field.options
      .filter(
        (option) =>
          !target.options.some((candidate) =>
            sameName(candidate.name, option.title)
          )
      )
      .map((option) => option.title);
  };

  const start = async () => {
    setStarting(true);
    setFailed(false);
    try {
      const saved = await apiFetch(`/api/imports/qase/jobs/${jobId}/mapping`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configuration: config }),
      });
      if (!saved.ok) {
        setFailed(true);
        return;
      }
      const started = await apiFetch(`/api/imports/qase/jobs/${jobId}/import`, {
        method: "POST",
      });
      if (!started.ok) {
        setFailed(true);
        return;
      }
      onStarted((await started.json()).job);
    } catch {
      setFailed(true);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="qase-mapping">
      {!analysis.storageConfigured && (
        <Alert data-testid="qase-mapping-no-storage">
          <AlertTitle>{t("noStorageTitle")}</AlertTitle>
          <AlertDescription>{t("noStorageDescription")}</AlertDescription>
        </Alert>
      )}

      <Section
        title={t("projectsTitle")}
        description={t("projectsDescription")}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/2">{t("columnQase")}</TableHead>
              <TableHead>{t("columnTestPlanIt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {source.projects.map((project) => (
              <TableRow key={project.code}>
                <TableCell>{`${project.title} (${project.code})`}</TableCell>
                <TableCell>
                  <Picker
                    testId={`qase-map-project-${project.code}`}
                    options={existing.projects}
                    value={
                      existing.projects.find(
                        (candidate) =>
                          candidate.id ===
                          config.projects[project.code]?.mappedTo
                      ) ?? null
                    }
                    onChange={(value) =>
                      setConfig({
                        ...config,
                        projects: {
                          ...config.projects,
                          [project.code]: { mappedTo: value?.id ?? null },
                        },
                      })
                    }
                    getId={(option) => option.id}
                    getLabel={(option) => option.name}
                    render={(option) => option.name}
                    ariaLabel={t("projectPickerLabel", {
                      name: project.title,
                    })}
                    placeholder={t("projectPlaceholder")}
                  />
                  {problemFor("project_unmapped", project.title) && (
                    <p className="mt-1 text-xs text-destructive">
                      {t("problems.project_unmapped")}
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        title={t("statusesTitle")}
        description={t("statusesDescription")}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/2">{t("columnQase")}</TableHead>
              <TableHead>{t("columnTestPlanIt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {source.caseStatuses.map((status) => (
              <TableRow key={status.id}>
                <TableCell>{status.title}</TableCell>
                <TableCell>
                  <Picker
                    testId={`qase-map-status-${status.id}`}
                    options={existing.workflows}
                    value={
                      existing.workflows.find(
                        (candidate) =>
                          candidate.id ===
                          config.caseStatuses[status.id]?.mappedTo
                      ) ?? null
                    }
                    onChange={(value) =>
                      setConfig({
                        ...config,
                        caseStatuses: {
                          ...config.caseStatuses,
                          [status.id]: { mappedTo: value?.id ?? null },
                        },
                      })
                    }
                    getId={(option) => option.id}
                    getLabel={(option) => option.name}
                    render={(option) => (
                      <WorkflowStateDisplay
                        size="sm"
                        state={{
                          name: option.name,
                          icon: { name: option.icon.name as IconName },
                          color: option.color,
                        }}
                      />
                    )}
                    ariaLabel={t("statusPickerLabel", { name: status.title })}
                    placeholder={t("statusPlaceholder")}
                  />
                  {problemFor("status_unmapped", status.title) && (
                    <p className="mt-1 text-xs text-destructive">
                      {t("problems.status_unmapped")}
                    </p>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        title={t("templateTitle")}
        description={t("templateDescription")}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            value={config.template.action}
            onValueChange={(value) =>
              setConfig({
                ...config,
                template: {
                  action: value === "map" ? "map" : "create",
                  mappedTo: null,
                  name: value === "map" ? "" : "Qase",
                },
              })
            }
          >
            <SelectTrigger
              aria-label={t("templateActionLabel")}
              data-testid="qase-map-template-action"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="create">{t("templateCreate")}</SelectItem>
              <SelectItem value="map">{t("templateExisting")}</SelectItem>
            </SelectContent>
          </Select>
          {config.template.action === "create" ? (
            <Input
              data-testid="qase-map-template-name"
              aria-label={t("templateNameLabel")}
              placeholder={t("templateNameLabel")}
              maxLength={255}
              value={config.template.name}
              onChange={(event) =>
                setConfig({
                  ...config,
                  template: { ...config.template, name: event.target.value },
                })
              }
            />
          ) : (
            <Picker
              testId="qase-map-template"
              options={existing.templates}
              value={
                existing.templates.find(
                  (candidate) => candidate.id === config.template.mappedTo
                ) ?? null
              }
              onChange={(value) =>
                setConfig({
                  ...config,
                  template: {
                    ...config.template,
                    mappedTo: value?.id ?? null,
                  },
                })
              }
              getId={(option) => option.id}
              getLabel={(option) => option.name}
              render={(option) => (
                <TemplateNameDisplay name={option.name} size="sm" />
              )}
              ariaLabel={t("templatePickerLabel")}
              placeholder={t("templatePlaceholder")}
            />
          )}
        </div>
        {problemFor("template_missing") && (
          <p className="text-xs text-destructive">
            {t("problems.template_missing")}
          </p>
        )}
        {problemFor("template_name_taken") && (
          <p className="text-xs text-destructive">
            {t("problems.template_name_taken")}
          </p>
        )}
      </Section>

      <Section title={t("fieldsTitle")} description={t("fieldsDescription")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/4">{t("columnQase")}</TableHead>
              <TableHead className="w-1/4">{t("columnAction")}</TableHead>
              <TableHead>{t("columnTestPlanIt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {source.fields.map((field) => {
              const mapping = config.fields[field.key] ?? {
                action: "skip" as const,
                mappedTo: null,
                name: "",
              };
              const candidates = existing.caseFields.filter(
                (candidate) => candidate.type === field.targetType
              );
              const unmatched =
                mapping.action === "map"
                  ? unmatchedOptions(field, mapping.mappedTo)
                  : [];
              const fieldProblem = (
                [
                  "field_unmapped",
                  "field_type_mismatch",
                  "field_target_reused",
                  "field_name_missing",
                ] as const
              ).find((code) => problemFor(code, field.title));
              return (
                <TableRow
                  key={field.key}
                  data-testid={`qase-map-field-${field.key}`}
                >
                  <TableCell>
                    <div>{field.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {field.targetType}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={mapping.action}
                      onValueChange={(value) =>
                        changeFieldAction(field, value as QaseFieldAction)
                      }
                    >
                      <SelectTrigger
                        aria-label={t("fieldActionLabel", {
                          name: field.title,
                        })}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="create">
                          {t("fieldCreate")}
                        </SelectItem>
                        <SelectItem value="map">
                          {t("fieldExisting")}
                        </SelectItem>
                        <SelectItem value="skip">{t("fieldSkip")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {mapping.action === "create" && (
                      <Input
                        aria-label={t("fieldNameLabel", { name: field.title })}
                        maxLength={255}
                        value={mapping.name}
                        onChange={(event) =>
                          setField(field.key, { name: event.target.value })
                        }
                      />
                    )}
                    {mapping.action === "map" && (
                      <Picker
                        testId={`qase-map-field-target-${field.key}`}
                        options={candidates}
                        value={
                          candidates.find(
                            (candidate) => candidate.id === mapping.mappedTo
                          ) ?? null
                        }
                        onChange={(value) =>
                          setField(field.key, { mappedTo: value?.id ?? null })
                        }
                        getId={(option) => option.id}
                        getLabel={(option) => option.displayName}
                        render={(option) => option.displayName}
                        ariaLabel={t("fieldPickerLabel", { name: field.title })}
                        placeholder={t("fieldPlaceholder")}
                      />
                    )}
                    {fieldProblem && (
                      <p className="mt-1 text-xs text-destructive">
                        {t(`problems.${fieldProblem}`)}
                      </p>
                    )}
                    {mapping.action === "create" &&
                      problemFor("field_name_taken", mapping.name) && (
                        <p className="mt-1 text-xs text-destructive">
                          {t("problems.field_name_taken")}
                        </p>
                      )}
                    {unmatched.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("fieldUnmatchedOptions", {
                          count: unmatched.length,
                          options: unmatched.join(", "),
                        })}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>

      {source.users.length > 0 && (
        <Section title={t("usersTitle")} description={t("usersDescription")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/2">{t("columnQase")}</TableHead>
                <TableHead>{t("columnTestPlanIt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {source.users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div>{user.name || user.email}</div>
                    {user.name && user.email && (
                      <div className="text-xs text-muted-foreground">
                        {user.email}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Picker
                      testId={`qase-map-user-${user.id}`}
                      options={existing.users}
                      value={
                        existing.users.find(
                          (candidate) =>
                            candidate.id === config.users[user.id]?.mappedTo
                        ) ?? null
                      }
                      onChange={(value) =>
                        setConfig({
                          ...config,
                          users: {
                            ...config.users,
                            [user.id]: { mappedTo: value?.id ?? null },
                          },
                        })
                      }
                      getId={(option) => option.id}
                      getLabel={(option) => `${option.name} ${option.email}`}
                      render={(option) => (
                        <UserNameCell userId={option.id} hideLink />
                      )}
                      ariaLabel={t("userPickerLabel", {
                        name: user.name || user.email,
                      })}
                      placeholder={t("userPlaceholder")}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {failed && (
        <Alert variant="destructive" data-testid="qase-mapping-error">
          <AlertDescription>{t("startFailed")}</AlertDescription>
        </Alert>
      )}
      {problems.length > 0 && (
        <p
          className="text-sm text-destructive"
          data-testid="qase-mapping-problems"
        >
          {t("problemsSummary", { count: problems.length })}
        </p>
      )}
      <Button
        type="button"
        data-testid="qase-start-import-button"
        onClick={start}
        disabled={problems.length > 0 || starting}
      >
        {starting ? t("starting") : t("start")}
      </Button>
    </div>
  );
}
