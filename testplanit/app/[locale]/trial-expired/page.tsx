import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, PauseCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "~/lib/navigation";
import {
  isContactWebLink,
  resolveTrialContact,
  trialContactHref,
} from "~/lib/trialContact";

/**
 * The instance-locked notice. proxy.ts sends every page request here when
 * the trial has expired, or (with `?reason=suspended`) when the control plane
 * has suspended a hosted instance for non-payment or an ended subscription.
 * Same page, same route, different copy and calls to action.
 */
export default async function TrialExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const suspended = reason === "suspended";
  const t = await getTranslations(
    suspended ? "InstanceSuspended" : "TrialExpired"
  );
  const tGlobal = await getTranslations();

  const contact = resolveTrialContact();
  const websiteUrl =
    process.env.NEXT_PUBLIC_WEBSITE_URL || "https://testplanit.com";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-2xl">
        <CardHeader className="space-y-4 text-center">
          {suspended ? (
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <PauseCircle className="h-8 w-8 text-muted-foreground" />
            </div>
          ) : (
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <AlertCircle className="h-8 w-8 animate-ping text-destructive" />
            </div>
          )}
          <CardTitle className="text-3xl">{t("title")}</CardTitle>
          <CardDescription className="text-lg">
            {t("description")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <p className="text-center text-muted-foreground">{t("nextSteps")}</p>

          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            {suspended ? (
              <>
                <Button asChild size="lg">
                  <Link href={`${websiteUrl}/billing`}>
                    {t("billingPortal")}
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href={`${websiteUrl}/contact?subject=billing`}>
                    {t("contactUs")}
                  </Link>
                </Button>
              </>
            ) : (
              <>
                <Button asChild size="lg" variant="outline">
                  <Link href={websiteUrl}>{t("pricingPlans")}</Link>
                </Button>
                <Button asChild size="lg">
                  <Link
                    href={trialContactHref(contact)}
                    target={isContactWebLink(contact) ? "_blank" : undefined}
                    rel={
                      isContactWebLink(contact)
                        ? "noopener noreferrer"
                        : undefined
                    }
                  >
                    {tGlobal("Trial.contactSales")}
                  </Link>
                </Button>
              </>
            )}
          </div>
        </CardContent>

        <CardFooter>
          <Alert className="w-full">
            <AlertDescription className="text-center">
              {t("dataRetention")}
            </AlertDescription>
          </Alert>
        </CardFooter>
      </Card>
    </div>
  );
}
