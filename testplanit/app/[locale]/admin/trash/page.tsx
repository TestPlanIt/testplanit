"use client";

import { useTranslations } from "next-intl";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import SoftDeletedDataTable from ".//SoftDeletedDataTable";
import { Trash2 } from "lucide-react";
import DynamicIcon from "~/components/DynamicIcon";
import dynamicIconImports from "lucide-react/dynamicIconImports";
import { Card, CardContent, CardHeader } from "~/components/ui/card";

// Define the type for icon names based on the keys of dynamicIconImports
type IconName = keyof typeof dynamicIconImports;

// We'll get this list from the schema analysis later
const softDeletedItemTypes: Array<{
  name: string;
  translationKey: string;
  iconName: IconName;
}> = [
  {
    name: "Projects",
    translationKey: "admin.menu.projects",
    iconName: "boxes",
  },
  {
    name: "Templates",
    translationKey: "common.fields.templates",
    iconName: "layout-template",
  },
  {
    name: "CaseFields",
    translationKey: "common.fields.caseFields",
    iconName: "layout-list",
  },
  {
    name: "ResultFields",
    translationKey: "common.fields.resultFields",
    iconName: "square-check",
  },
  {
    name: "FieldOptions",
    translationKey: "admin.trash.itemTypes.fieldOptions",
    iconName: "settings-2",
  },
  {
    name: "Workflows",
    translationKey: "admin.menu.workflows",
    iconName: "workflow",
  },
  {
    name: "Status",
    translationKey: "admin.menu.statuses",
    iconName: "circle-check-big",
  },
  {
    name: "Milestones",
    translationKey: "common.fields.milestones",
    iconName: "flag",
  },
  {
    name: "MilestoneTypes",
    translationKey: "admin.menu.milestoneTypes",
    iconName: "milestone",
  },
  {
    name: "Configurations",
    translationKey: "admin.menu.configurations",
    iconName: "combine",
  },
  {
    name: "ConfigCategories",
    translationKey: "admin.trash.itemTypes.configCategories",
    iconName: "layers-2",
  },
  {
    name: "ConfigVariants",
    translationKey: "admin.trash.itemTypes.configVariants",
    iconName: "component",
  },
  { name: "User", translationKey: "admin.menu.users", iconName: "user" },
  { name: "Groups", translationKey: "admin.menu.groups", iconName: "users" },
  { name: "Roles", translationKey: "admin.menu.roles", iconName: "drama" },
  { name: "Tags", translationKey: "admin.menu.tags", iconName: "tags" },
  { name: "Issues", translationKey: "common.fields.issues", iconName: "bug" },
  {
    name: "TestRuns",
    translationKey: "common.fields.testRuns",
    iconName: "play-circle",
  },
  {
    name: "TestRunResults",
    translationKey: "enums.ApplicationArea.TestRunResults",
    iconName: "clipboard-list",
  },
  {
    name: "TestRunStepResults",
    translationKey: "admin.trash.itemTypes.testRunStepResults",
    iconName: "list-todo",
  },
  {
    name: "Sessions",
    translationKey: "common.fields.sessions",
    iconName: "compass",
  },
  {
    name: "SessionResults",
    translationKey: "enums.ApplicationArea.SessionResults",
    iconName: "clipboard-check",
  },
  {
    name: "RepositoryFolders",
    translationKey: "admin.trash.itemTypes.repositoryFolders",
    iconName: "folder-open",
  },
  {
    name: "RepositoryCases",
    translationKey: "search.entityTypes.repositoryCase",
    iconName: "list-checks",
  },
  {
    name: "RepositoryCaseLink",
    translationKey: "admin.trash.itemTypes.repositoryCaseLinks",
    iconName: "link-2",
  },
  {
    name: "RepositoryCaseVersions",
    translationKey: "admin.trash.itemTypes.repositoryCaseVersions",
    iconName: "history",
  },
  {
    name: "Steps",
    translationKey: "common.fields.steps",
    iconName: "list-ordered",
  },
  {
    name: "Attachments",
    translationKey: "common.fields.attachments",
    iconName: "paperclip",
  },
];

export default function TrashPage() {
  const tGlobal = useTranslations();

  return (
    <Card>
      <CardHeader className="w-full">
        <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
          <div className="flex items-center">
            <Trash2 className="mr-2" size={32} />
            {tGlobal("admin.menu.trash")}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full">
          {softDeletedItemTypes.map((itemType) => (
            <AccordionItem value={itemType.name} key={itemType.name}>
              <AccordionTrigger>
                <div className="flex items-center">
                  <DynamicIcon
                    name={itemType.iconName as IconName}
                    className="mr-2 h-5 w-5"
                  />
                  {tGlobal(itemType.translationKey as any)}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <SoftDeletedDataTable
                  itemType={itemType.name}
                  translationKey={itemType.translationKey}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
