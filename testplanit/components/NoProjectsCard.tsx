import React from "react";
import { useTranslations } from "next-intl";

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { UserX, Mail, Boxes } from "lucide-react";
import { Link } from "~/lib/navigation";

interface NoProjectsCardProps {
  isAdmin?: boolean;
}

export const NoProjectsCard: React.FC<NoProjectsCardProps> = ({ isAdmin = false }) => {
  const t = useTranslations();

  return (
    <Card className="border-muted-foreground/50 bg-muted/20" data-testid="no-projects-card">
      <CardHeader>
        <CardTitle className="text-primary font-semibold text-xl">
          <div className="flex items-center gap-2">
            <UserX className="w-6 h-6" />
            <div>{t("home.noAccess.title")}</div>
          </div>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t("home.noAccess.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        {isAdmin ? (
          <Link href="/admin/projects" className="flex items-start gap-2 hover:text-primary">
            <Boxes className="w-6 h-6 shrink-0" />
            <span>{t("home.noAccess.adminAddProject")}</span>
          </Link>
        ) : (
          <div className="flex items-start gap-2">
            <Mail className="w-6 h-6 shrink-0" />
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
