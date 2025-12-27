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
  { name: "Projects", translationKey: "projects", iconName: "boxes" },
  {
    name: "Templates",
    translationKey: "templates",
    iconName: "layout-template",
  },
  { name: "CaseFields", translationKey: "caseFields", iconName: "layout-list" },
  {
    name: "ResultFields",
    translationKey: "resultFields",
    iconName: "square-check",
  },
  {
    name: "FieldOptions",
    translationKey: "fieldOptions",
    iconName: "settings-2",
  },
  { name: "Workflows", translationKey: "workflows", iconName: "workflow" },
  { name: "Status", translationKey: "statuses", iconName: "circle-check-big" },
  { name: "Milestones", translationKey: "milestones", iconName: "flag" },
  {
    name: "MilestoneTypes",
    translationKey: "milestoneTypes",
    iconName: "milestone",
  },
  {
    name: "Configurations",
    translationKey: "configurations",
    iconName: "combine",
  },
  {
    name: "ConfigCategories",
    translationKey: "configCategories",
    iconName: "layers-2",
  },
  {
    name: "ConfigVariants",
    translationKey: "configVariants",
    iconName: "component",
  },
  { name: "User", translationKey: "users", iconName: "user" },
  { name: "Groups", translationKey: "groups", iconName: "users" },
  { name: "Roles", translationKey: "roles", iconName: "drama" },
  { name: "Tags", translationKey: "tags", iconName: "tags" },
  { name: "Issues", translationKey: "issues", iconName: "bug" },
  { name: "TestRuns", translationKey: "testRuns", iconName: "play-circle" },
  {
    name: "TestRunResults",
    translationKey: "testRunResults",
    iconName: "clipboard-list",
  },
  {
    name: "TestRunStepResults",
    translationKey: "testRunStepResults",
    iconName: "list-todo",
  },
  { name: "Sessions", translationKey: "sessions", iconName: "compass" },
  {
    name: "SessionResults",
    translationKey: "sessionResults",
    iconName: "clipboard-check",
  },
  {
    name: "RepositoryFolders",
    translationKey: "repositoryFolders",
    iconName: "folder-open",
  },
  {
    name: "RepositoryCases",
    translationKey: "repositoryCases",
    iconName: "list-checks",
  },
  {
    name: "RepositoryCaseLink",
    translationKey: "repositoryCaseLinks",
    iconName: "link-2",
  },
  {
    name: "RepositoryCaseVersions",
    translationKey: "repositoryCaseVersions",
    iconName: "history",
  },
  { name: "Steps", translationKey: "steps", iconName: "list-ordered" },
  { name: "Attachments", translationKey: "attachments", iconName: "paperclip" },
];

export default function TrashPage() {
  const t = useTranslations("admin.trash");
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
                  {t(`itemTypes.${itemType.translationKey}` as any)}
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
