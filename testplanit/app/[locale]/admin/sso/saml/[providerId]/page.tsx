"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useFindUniqueSsoProvider,
  useFindUniqueSamlConfiguration,
  useCreateSamlConfiguration,
  useUpdateSamlConfiguration,
} from "~/lib/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { ArrowLeft, Save, AlertCircle } from "lucide-react";
import { Access } from "@prisma/client";

// Get all Access enum values dynamically with their translation keys
const AccessLevels = [
  { value: Access.NONE, key: "common.access.none" as const },
  { value: Access.USER, key: "common.access.user" as const },
  { value: Access.PROJECTADMIN, key: "common.access.projectAdmin" as const },
  { value: Access.ADMIN, key: "common.access.admin" as const },
];

interface SamlFormData {
  entryPoint: string;
  issuer: string;
  cert: string;
  callbackUrl: string;
  logoutUrl: string;
  autoProvisionUsers: boolean;
  defaultAccess: Access;
  attributeMapping: {
    email: string;
    name: string;
    id: string;
    firstName?: string;
    lastName?: string;
    groups?: string;
  };
}

export default function SAMLConfigurationPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const providerId = params.providerId as string;
  const t = useTranslations();
  const [isSaving, setIsSaving] = useState(false);

  const { data: provider } = useFindUniqueSsoProvider({
    where: { id: providerId },
  });

  const { data: samlConfig } = useFindUniqueSamlConfiguration({
    where: { providerId: providerId },
  });

  const { mutateAsync: createSamlConfig } = useCreateSamlConfiguration();
  const { mutateAsync: updateSamlConfig } = useUpdateSamlConfiguration();

  const [formData, setFormData] = useState<SamlFormData>({
    entryPoint: "",
    issuer: "",
    cert: "",
    callbackUrl: "",
    logoutUrl: "",
    autoProvisionUsers: true,
    defaultAccess: Access.USER,
    attributeMapping: {
      email: "email",
      name: "name",
      id: "nameID",
      firstName: "givenName",
      lastName: "surname",
      groups: "groups",
    },
  });

  useEffect(() => {
    if (samlConfig) {
      const mapping = samlConfig.attributeMapping as any;
      setFormData({
        entryPoint: samlConfig.entryPoint,
        issuer: samlConfig.issuer,
        cert: samlConfig.cert,
        callbackUrl: samlConfig.callbackUrl,
        logoutUrl: samlConfig.logoutUrl || "",
        autoProvisionUsers: samlConfig.autoProvisionUsers,
        defaultAccess: samlConfig.defaultAccess || Access.USER,
        attributeMapping: {
          email: mapping.email || "email",
          name: mapping.name || "name",
          id: mapping.id || "nameID",
          firstName: mapping.firstName || "givenName",
          lastName: mapping.lastName || "surname",
          groups: mapping.groups || "groups",
        },
      });
    } else if (typeof window !== "undefined") {
      // Set default callback URL
      setFormData((prev) => ({
        ...prev,
        callbackUrl: `${window.location.origin}/api/auth/callback/saml`,
      }));
    }
  }, [samlConfig]);

  if (session?.user?.access !== "ADMIN") {
    return (
      <div className="container mx-auto py-10">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t("admin.sso.providers.saml.permissionDenied")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!provider || provider.type !== "SAML") {
    return (
      <div className="container mx-auto py-10">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t("admin.sso.providers.saml.invalidProvider")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleSave = async () => {
    try {
      setIsSaving(true);

      const data = {
        entryPoint: formData.entryPoint,
        issuer: formData.issuer,
        cert: formData.cert,
        callbackUrl: formData.callbackUrl,
        logoutUrl: formData.logoutUrl || null,
        autoProvisionUsers: formData.autoProvisionUsers,
        defaultAccess: formData.defaultAccess,
        attributeMapping: formData.attributeMapping,
      };

      if (samlConfig) {
        await updateSamlConfig({
          where: { id: samlConfig.id },
          data,
        });
        toast.success(t("admin.sso.providers.saml.configurationUpdated"));
      } else {
        await createSamlConfig({
          data: {
            ...data,
            providerId: providerId,
          },
        });
        toast.success(t("admin.sso.providers.saml.configurationCreated"));
      }

      router.push("/admin/sso");
    } catch (error) {
      toast.error(t("admin.sso.providers.saml.saveFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="container mx-auto py-10">
      <div className="mb-8">
        <Button
          variant="ghost"
          onClick={() => router.push("/admin/sso")}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("admin.sso.providers.saml.backToProviders")}
        </Button>
        <h1 className="text-3xl font-bold">{t("admin.sso.providers.saml.pageTitle")}</h1>
        <p className="text-muted-foreground mt-2">
          {`Configure SAML settings for ${provider.name}`}
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.sso.providers.saml.settings.title")}</CardTitle>
            <CardDescription>
              {t("admin.sso.providers.saml.settings.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="entryPoint">{t("admin.sso.providers.saml.settings.ssoUrl")}</Label>
              <Input
                id="entryPoint"
                value={formData.entryPoint}
                onChange={(e) =>
                  setFormData({ ...formData, entryPoint: e.target.value })
                }
                placeholder="https://idp.example.com/sso/saml"
              />
            </div>

            <div>
              <Label htmlFor="issuer">{t("admin.sso.providers.saml.settings.entityId")}</Label>
              <Input
                id="issuer"
                value={formData.issuer}
                onChange={(e) =>
                  setFormData({ ...formData, issuer: e.target.value })
                }
                placeholder="https://yourapp.com"
              />
            </div>

            <div>
              <Label htmlFor="cert">{t("admin.sso.providers.saml.settings.certificate")}</Label>
              <Textarea
                id="cert"
                value={formData.cert}
                onChange={(e) =>
                  setFormData({ ...formData, cert: e.target.value })
                }
                placeholder={`-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----`}
                rows={10}
              />
            </div>

            <div>
              <Label htmlFor="callbackUrl">{t("admin.sso.providers.saml.settings.callbackUrl")}</Label>
              <Input
                id="callbackUrl"
                value={formData.callbackUrl}
                onChange={(e) =>
                  setFormData({ ...formData, callbackUrl: e.target.value })
                }
                placeholder="https://yourapp.com/api/auth/callback/saml"
                readOnly
              />
            </div>

            <div>
              <Label htmlFor="logoutUrl">{t("admin.sso.providers.saml.settings.logoutUrl")}</Label>
              <Input
                id="logoutUrl"
                value={formData.logoutUrl}
                onChange={(e) =>
                  setFormData({ ...formData, logoutUrl: e.target.value })
                }
                placeholder="https://idp.example.com/logout"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("admin.sso.providers.saml.userProvisioning.title")}</CardTitle>
            <CardDescription>
              {t("admin.sso.providers.saml.userProvisioning.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="autoProvision"
                checked={formData.autoProvisionUsers}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, autoProvisionUsers: checked })
                }
              />
              <Label htmlFor="autoProvision">
                {t("admin.sso.providers.saml.userProvisioning.autoProvision")}
              </Label>
            </div>

            <div className="w-full">
              <Label htmlFor="defaultAccess">
                {t("admin.sso.providers.saml.userProvisioning.defaultAccess")}
                <select
                  id="defaultAccess"
                  value={formData.defaultAccess}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      defaultAccess: e.target.value as Access,
                    })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 max-w-xs block"
                >
                  {AccessLevels.map(({ value, key }) => (
                    <option key={value} value={value}>
                      {t(key)}
                    </option>
                  ))}
                </select>
              </Label>
              <p className="text-sm text-muted-foreground mt-1">
                {t("admin.sso.providers.saml.userProvisioning.defaultAccessHint")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("admin.sso.providers.saml.attributeMapping.title")}</CardTitle>
            <CardDescription>
              {t("admin.sso.providers.saml.attributeMapping.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="attrEmail">{t("admin.sso.providers.saml.attributeMapping.emailAttribute")}</Label>
              <Input
                id="attrEmail"
                value={formData.attributeMapping.email}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    attributeMapping: {
                      ...formData.attributeMapping,
                      email: e.target.value,
                    },
                  })
                }
                placeholder="email"
              />
            </div>

            <div>
              <Label htmlFor="attrName">{t("admin.sso.providers.saml.attributeMapping.displayNameAttribute")}</Label>
              <Input
                id="attrName"
                value={formData.attributeMapping.name}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    attributeMapping: {
                      ...formData.attributeMapping,
                      name: e.target.value,
                    },
                  })
                }
                placeholder="name"
              />
            </div>

            <div>
              <Label htmlFor="attrId">{t("admin.sso.providers.saml.attributeMapping.userIdAttribute")}</Label>
              <Input
                id="attrId"
                value={formData.attributeMapping.id}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    attributeMapping: {
                      ...formData.attributeMapping,
                      id: e.target.value,
                    },
                  })
                }
                placeholder="nameID"
              />
            </div>

            <div>
              <Label htmlFor="attrFirstName">
                {t("admin.sso.providers.saml.attributeMapping.firstNameAttribute")}
              </Label>
              <Input
                id="attrFirstName"
                value={formData.attributeMapping.firstName || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    attributeMapping: {
                      ...formData.attributeMapping,
                      firstName: e.target.value,
                    },
                  })
                }
                placeholder="givenName"
              />
            </div>

            <div>
              <Label htmlFor="attrLastName">
                {t("admin.sso.providers.saml.attributeMapping.lastNameAttribute")}
              </Label>
              <Input
                id="attrLastName"
                value={formData.attributeMapping.lastName || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    attributeMapping: {
                      ...formData.attributeMapping,
                      lastName: e.target.value,
                    },
                  })
                }
                placeholder="surname"
              />
            </div>

            <div>
              <Label htmlFor="attrGroups">
                {t("admin.sso.providers.saml.attributeMapping.groupsAttribute")}
              </Label>
              <Input
                id="attrGroups"
                value={formData.attributeMapping.groups || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    attributeMapping: {
                      ...formData.attributeMapping,
                      groups: e.target.value,
                    },
                  })
                }
                placeholder="groups"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4" />
            {isSaving ? t("admin.sso.providers.saml.saving") : t("admin.sso.providers.saml.saveConfiguration")}
          </Button>
        </div>
      </div>
    </div>
  );
}
