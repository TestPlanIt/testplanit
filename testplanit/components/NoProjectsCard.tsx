import { useTranslations } from "next-intl";
import React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Boxes, Mail, UserX } from "lucide-react";
import { Link } from "~/lib/navigation";

interface NoProjectsCardProps {
  isAdmin?: boolean;
}

export const NoProjectsCard: React.FC<NoProjectsCardProps> = ({
  isAdmin = false,
}) => {
  const t = useTranslations();

  return (
    <Card
      className="border-muted-foreground/50 bg-muted/20"
      data-testid="no-projects-card"
    >
      <CardHeader>
        <CardTitle className="text-xl font-semibold text-primary">
          <div className="flex items-center gap-2">
            <UserX className="h-6 w-6" />
            <div>{t("home.noAccess.title")}</div>
          </div>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t("home.noAccess.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        {isAdmin ? (
          <Link
            href="/admin/projects"
            className="flex items-start gap-2 hover:text-primary"
          >
            <Boxes className="h-6 w-6 shrink-0" />
            <span>{t("home.noAccess.adminAddProject")}</span>
          </Link>
        ) : (
          <div className="flex items-start gap-2">
            <Mail className="h-6 w-6 shrink-0" />
            <span>{t("home.noAccess.contact")}</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        <div>{t("home.noAccess.footer")}</div>
      </CardFooter>
    </Card>
  );
};
