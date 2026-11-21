"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccessLevelDisplay } from "@/components/tables/AccessLevelDisplay";
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
import DynamicIcon from "~/components/DynamicIcon";
import LoadingSpinner from "~/components/LoadingSpinner";
import { RoleNameDisplay } from "~/components/RoleNameDisplay";
import StatusDisplay from "~/components/StatusDisplay";
import { TemplateNameDisplay } from "~/components/TemplateNameDisplay";
import { WorkflowStateDisplay } from "~/components/WorkflowStateDisplay";
import { apiFetch } from "~/lib/basePath";
import {
  QASE_USER_ACCESS,
  qaseUserLabel,
  unmappedQaseUser,
  validateQaseMapping,
  type QaseAnalysis,
  type QaseFieldAction,
  type QaseMappingConfiguration,
  type QaseProjectMapping,
  type QaseResultStatusMapping,
  type QaseSourceField,
  type QaseUserAccess,
  type QaseUserMapping,
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
  const tCommon = useTranslations("common");
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

  const setProject = (code: string, patch: Partial<QaseProjectMapping>) =>
    setConfig((current) =>
      current
        ? {
            ...current,
            projects: {
              ...current.projects,
              [code]: {
                ...{ action: "map" as const, mappedTo: null, name: "" },
                ...current.projects[code],
                ...patch,
              },
            },
          }
        : current
    );

  const setResultStatus = (
    slug: string,
    patch: Partial<QaseResultStatusMapping>
  ) =>
    setConfig((current) =>
      current
        ? {
            ...current,
            resultStatuses: {
              ...current.resultStatuses,
              [slug]: {
                ...{
                  action: "map" as const,
                  mappedTo: null,
                  name: "",
                  isSuccess: false,
                  isFailure: false,
                  isCompleted: false,
                },
                ...current.resultStatuses[slug],
                ...patch,
              },
            },
          }
        : current
    );

  const setUser = (id: string, patch: Partial<QaseUserMapping>) =>
    setConfig((current) =>
      current
        ? {
            ...current,
            users: {
              ...current.users,
              [id]: { ...unmappedQaseUser(), ...current.users[id], ...patch },
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
              <TableHead className="w-1/3">{t("columnQase")}</TableHead>
              <TableHead className="w-1/4">{t("columnAction")}</TableHead>
              <TableHead>{t("columnTestPlanIt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {source.projects.map((project) => {
              const mapping = config.projects[project.code] ?? {
                action: "map" as const,
                mappedTo: null,
                name: "",
              };
              const projectProblem = (
                ["project_unmapped", "project_name_missing"] as const
              ).find((code) => problemFor(code, project.title));
              const nameTaken =
                mapping.action === "create" &&
                problemFor("project_name_taken", mapping.name);
              return (
                <TableRow
                  key={project.code}
                  data-testid={`qase-map-project-row-${project.code}`}
                >
                  <TableCell>{`${project.title} (${project.code})`}</TableCell>
                  <TableCell>
                    <Select
                      value={mapping.action}
                      onValueChange={(value) =>
                        setProject(
                          project.code,
                          value === "create"
                            ? {
                                action: "create",
                                mappedTo: null,
                                name: project.title,
                              }
                            : { action: "map", mappedTo: null, name: "" }
                        )
                      }
                    >
                      <SelectTrigger
                        aria-label={t("projectActionLabel", {
                          name: project.title,
                        })}
                        data-testid={`qase-map-project-action-${project.code}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="create">
                          {t("projectCreate")}
                        </SelectItem>
                        <SelectItem value="map">
                          {t("projectExisting")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {mapping.action === "create" ? (
                      <Input
                        data-testid={`qase-map-project-name-${project.code}`}
                        aria-label={t("projectNameLabel", {
                          name: project.title,
                        })}
                        maxLength={255}
                        value={mapping.name}
                        onChange={(event) =>
                          setProject(project.code, { name: event.target.value })
                        }
                      />
                    ) : (
                      <Picker
                        testId={`qase-map-project-${project.code}`}
                        options={existing.projects}
                        value={
                          existing.projects.find(
                            (candidate) => candidate.id === mapping.mappedTo
                          ) ?? null
                        }
                        onChange={(value) =>
                          setProject(project.code, {
                            mappedTo: value?.id ?? null,
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
                    )}
                    {(projectProblem || nameTaken) && (
                      <p className="mt-1 text-xs text-destructive">
                        {t(
                          `problems.${nameTaken ? "project_name_taken" : projectProblem!}`
                        )}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
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

      {source.resultStatuses.length > 0 && (
        <Section
          title={t("resultStatusesTitle")}
          description={t("resultStatusesDescription")}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">{t("columnQase")}</TableHead>
                <TableHead className="w-1/4">{t("columnAction")}</TableHead>
                <TableHead>{t("columnTestPlanIt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {source.resultStatuses.map((status) => {
                const mapping = config.resultStatuses[status.id] ?? {
                  action: "map" as const,
                  mappedTo: null,
                  name: "",
                  isSuccess: false,
                  isFailure: false,
                  isCompleted: false,
                };
                const statusProblem = (
                  [
                    "result_status_unmapped",
                    "result_status_name_missing",
                  ] as const
                ).find((code) => problemFor(code, status.title));
                const nameTaken =
                  mapping.action === "create" &&
                  problemFor("result_status_name_taken", mapping.name);
                return (
                  <TableRow
                    key={status.id}
                    data-testid={`qase-map-result-status-row-${status.id}`}
                  >
                    <TableCell className="align-top">{status.title}</TableCell>
                    <TableCell className="align-top">
                      <Select
                        value={mapping.action}
                        onValueChange={(value) =>
                          setResultStatus(
                            status.id,
                            value === "create"
                              ? {
                                  action: "create",
                                  mappedTo: null,
                                  name: status.title,
                                }
                              : { action: "map", mappedTo: null, name: "" }
                          )
                        }
                      >
                        <SelectTrigger
                          aria-label={t("resultStatusActionLabel", {
                            name: status.title,
                          })}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="create">
                            {t("resultStatusCreate")}
                          </SelectItem>
                          <SelectItem value="map">
                            {t("resultStatusExisting")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {mapping.action === "map" ? (
                        <Picker
                          testId={`qase-map-result-status-${status.id}`}
                          options={existing.statuses}
                          value={
                            existing.statuses.find(
                              (candidate) => candidate.id === mapping.mappedTo
                            ) ?? null
                          }
                          onChange={(value) =>
                            setResultStatus(status.id, {
                              mappedTo: value?.id ?? null,
                            })
                          }
                          getId={(option) => option.id}
                          getLabel={(option) => option.name}
                          render={(option) => (
                            <StatusDisplay
                              name={option.name}
                              color={option.color.value}
                            />
                          )}
                          ariaLabel={t("resultStatusPickerLabel", {
                            name: status.title,
                          })}
                          placeholder={t("resultStatusPlaceholder")}
                        />
                      ) : (
                        <div
                          className="space-y-3"
                          data-testid={`qase-map-result-status-new-${status.id}`}
                        >
                          <Input
                            aria-label={t("resultStatusNameLabel", {
                              name: status.title,
                            })}
                            maxLength={255}
                            value={mapping.name}
                            onChange={(event) =>
                              setResultStatus(status.id, {
                                name: event.target.value,
                              })
                            }
                          />
                          <div className="flex flex-wrap gap-x-6 gap-y-2">
                            {(
                              [
                                ["isSuccess", "success"],
                                ["isFailure", "failure"],
                                ["isCompleted", "completed"],
                              ] as const
                            ).map(([flag, label]) => (
                              <div
                                key={flag}
                                className="flex items-center gap-2"
                              >
                                <Switch
                                  id={`qase-result-status-${status.id}-${flag}`}
                                  checked={mapping[flag]}
                                  onCheckedChange={(checked) =>
                                    setResultStatus(status.id, {
                                      [flag]: checked,
                                    })
                                  }
                                />
                                <Label
                                  htmlFor={`qase-result-status-${status.id}-${flag}`}
                                >
                                  {tCommon(`fields.${label}`)}
                                </Label>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {(statusProblem || nameTaken) && (
                        <p className="mt-1 text-xs text-destructive">
                          {t(
                            `problems.${nameTaken ? "result_status_name_taken" : statusProblem!}`
                          )}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      )}

      {source.hasRuns && (
        <Section
          title={t("runStatesTitle")}
          description={t("runStatesDescription")}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/2">{t("columnQase")}</TableHead>
                <TableHead>{t("columnTestPlanIt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(["active", "completed"] as const).map((kind) => (
                <TableRow key={kind}>
                  <TableCell>{t(`runStates.${kind}`)}</TableCell>
                  <TableCell>
                    <Picker
                      testId={`qase-map-run-state-${kind}`}
                      options={existing.runStates}
                      value={
                        existing.runStates.find(
                          (candidate) => candidate.id === config.runStates[kind]
                        ) ?? null
                      }
                      onChange={(value) =>
                        setConfig({
                          ...config,
                          runStates: {
                            ...config.runStates,
                            [kind]: value?.id ?? null,
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
                      ariaLabel={t(`runStates.${kind}`)}
                      placeholder={t("statusPlaceholder")}
                    />
                    {problemFor("run_state_unmapped", kind) && (
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
      )}

      {source.hasMilestones && (
        <Section
          title={t("milestonesTitle")}
          description={t("milestonesDescription")}
        >
          <div className="max-w-md">
            <Picker
              testId="qase-map-milestone-type"
              options={existing.milestoneTypes}
              value={
                existing.milestoneTypes.find(
                  (candidate) => candidate.id === config.milestoneTypeId
                ) ?? null
              }
              onChange={(value) =>
                setConfig({ ...config, milestoneTypeId: value?.id ?? null })
              }
              getId={(option) => option.id}
              getLabel={(option) => option.name}
              render={(option) => (
                <span className="flex items-center gap-1">
                  {option.icon && (
                    <DynamicIcon
                      name={option.icon.name as IconName}
                      className="h-4 w-4 shrink-0"
                    />
                  )}
                  {option.name}
                </span>
              )}
              ariaLabel={t("milestoneTypeLabel")}
              placeholder={t("milestoneTypePlaceholder")}
            />
            {problemFor("milestone_type_missing") && (
              <p className="mt-1 text-xs text-destructive">
                {t("problems.milestone_type_missing")}
              </p>
            )}
          </div>
        </Section>
      )}

      {source.users.length > 0 && (
        <Section title={t("usersTitle")} description={t("usersDescription")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">{t("columnQase")}</TableHead>
                <TableHead className="w-1/4">{t("columnAction")}</TableHead>
                <TableHead>{t("columnTestPlanIt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {source.users.map((user) => {
                const mapping = config.users[user.id] ?? unmappedQaseUser();
                const label = qaseUserLabel(user);
                const emailProblem = (
                  [
                    "user_email_missing",
                    "user_email_invalid",
                    "user_email_reused",
                  ] as const
                ).find((code) => problemFor(code, label));
                const emailInUse =
                  mapping.action === "create" &&
                  existing.users.some((candidate) =>
                    sameName(candidate.email, mapping.email)
                  );
                return (
                  <TableRow
                    key={user.id}
                    data-testid={`qase-map-user-row-${user.id}`}
                  >
                    <TableCell className="align-top">
                      <div>{user.name || user.email}</div>
                      {user.name && user.email && (
                        <div className="text-xs text-muted-foreground">
                          {user.email}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <Select
                        value={mapping.action}
                        onValueChange={(value) =>
                          setUser(
                            user.id,
                            value === "create"
                              ? {
                                  ...unmappedQaseUser(),
                                  action: "create",
                                  name: user.name || user.email,
                                  email: user.email.trim().toLowerCase(),
                                }
                              : unmappedQaseUser()
                          )
                        }
                      >
                        <SelectTrigger
                          aria-label={t("userActionLabel", { name: label })}
                          data-testid={`qase-map-user-action-${user.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="create">
                            {t("userCreate")}
                          </SelectItem>
                          <SelectItem value="map">
                            {t("userExisting")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {mapping.action === "map" ? (
                        <Picker
                          testId={`qase-map-user-${user.id}`}
                          options={existing.users}
                          value={
                            existing.users.find(
                              (candidate) => candidate.id === mapping.mappedTo
                            ) ?? null
                          }
                          onChange={(value) =>
                            setUser(user.id, { mappedTo: value?.id ?? null })
                          }
                          getId={(option) => option.id}
                          getLabel={(option) =>
                            `${option.name} ${option.email}`
                          }
                          render={(option) => (
                            <UserNameCell userId={option.id} hideLink />
                          )}
                          ariaLabel={t("userPickerLabel", { name: label })}
                          placeholder={t("userPlaceholder")}
                        />
                      ) : (
                        <div
                          className="grid gap-3 sm:grid-cols-2"
                          data-testid={`qase-map-user-new-${user.id}`}
                        >
                          <div className="space-y-1">
                            <Label htmlFor={`qase-user-name-${user.id}`}>
                              {tCommon("name")}
                            </Label>
                            <Input
                              id={`qase-user-name-${user.id}`}
                              maxLength={255}
                              value={mapping.name}
                              onChange={(event) =>
                                setUser(user.id, { name: event.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`qase-user-email-${user.id}`}>
                              {tCommon("fields.email")}
                            </Label>
                            <Input
                              id={`qase-user-email-${user.id}`}
                              type="email"
                              maxLength={255}
                              value={mapping.email}
                              onChange={(event) =>
                                setUser(user.id, {
                                  email: event.target.value
                                    .trim()
                                    .toLowerCase(),
                                })
                              }
                            />
                            {emailProblem && (
                              <p className="text-xs text-destructive">
                                {t(`problems.${emailProblem}`)}
                              </p>
                            )}
                            {!emailProblem && emailInUse && (
                              <p className="text-xs text-muted-foreground">
                                {t("userEmailInUse")}
                              </p>
                            )}
                          </div>
                          <div className="space-y-1">
                            <Label>{tCommon("fields.access")}</Label>
                            <Select
                              value={mapping.access}
                              onValueChange={(value) =>
                                setUser(user.id, {
                                  access: value as QaseUserAccess,
                                })
                              }
                            >
                              <SelectTrigger
                                aria-label={t("userAccessLabel", {
                                  name: label,
                                })}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {QASE_USER_ACCESS.map((access) => (
                                  <SelectItem key={access} value={access}>
                                    <AccessLevelDisplay accessLevel={access} />
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>{tCommon("fields.role")}</Label>
                            <Picker
                              testId={`qase-map-user-role-${user.id}`}
                              options={existing.roles}
                              value={
                                existing.roles.find((role) =>
                                  mapping.roleId === null
                                    ? role.isDefault
                                    : role.id === mapping.roleId
                                ) ?? null
                              }
                              onChange={(value) =>
                                setUser(user.id, { roleId: value?.id ?? null })
                              }
                              getId={(option) => option.id}
                              getLabel={(option) => option.name}
                              render={(option) => (
                                <RoleNameDisplay role={option} />
                              )}
                              ariaLabel={t("userRoleLabel", { name: label })}
                              placeholder={t("userRolePlaceholder")}
                            />
                            {problemFor("user_role_missing", label) && (
                              <p className="text-xs text-destructive">
                                {t("problems.user_role_missing")}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`qase-user-active-${user.id}`}
                              checked={mapping.isActive}
                              onCheckedChange={(checked) =>
                                setUser(user.id, { isActive: checked })
                              }
                            />
                            <Label htmlFor={`qase-user-active-${user.id}`}>
                              {tCommon("fields.isActive")}
                            </Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              id={`qase-user-api-${user.id}`}
                              checked={mapping.isApi}
                              onCheckedChange={(checked) =>
                                setUser(user.id, { isApi: checked })
                              }
                            />
                            <Label htmlFor={`qase-user-api-${user.id}`}>
                              {tCommon("fields.apiUser")}
                            </Label>
                          </div>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
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
