"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Send, CheckCircle, XCircle, Settings } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface TestLlmIntegrationProps {
  integration: any;
}

export function TestLlmIntegration({ integration }: TestLlmIntegrationProps) {
  const t = useTranslations("admin.llm.test");
  const [open, setOpen] = useState(false);
  const [testMessage, setTestMessage] = useState(
    t("defaultTestMessage")
  );
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"testing" | "connected" | "failed" | null>(null);

  const testConnection = async () => {
    setConnectionStatus("testing");
    setResponse("");

    try {
      const response = await fetch(`/api/admin/llm/integrations/${integration.id}/test`, {
        method: "POST",
      });

      const data = await response.json();

      if (data.success) {
        setConnectionStatus("connected");
        toast.success(t("connectionSuccessful"), {
          description: t("connectionSuccessfulDescription"),
        });
      } else {
        setConnectionStatus("failed");
        toast.error(t("connectionFailed"), {
          description: data.error || t("failedToConnect"),
        });
      }
    } catch (error) {
      setConnectionStatus("failed");
      toast.error(t("connectionFailed"), {
        description: t("errorTestingConnection"),
      });
    }
  };

  const sendTestMessage = async () => {
    setLoading(true);
    setResponse("");

    try {
      const res = await fetch(`/api/admin/llm/integrations/${integration.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: testMessage,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setResponse(data.response.content);
        
        if (data.usage) {
          toast.success(t("testSuccessful"), {
            description: t("responseReceived", { cost: data.usage.totalCost.toFixed(6) }),
          });
        }
      } else {
        throw new Error(data.error || t("failedToGetResponse"));
      }
    } catch (error: any) {
      toast.error(t("testFailed"), {
        description: error.message || t("failedToSendMessage"),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Settings className="h-4 w-4" />
      </Button>
      
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {t("description", { name: integration?.name })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">{t("connectionStatus")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("connectionStatusDescription")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {connectionStatus === "connected" && (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                )}
                {connectionStatus === "failed" && (
                  <XCircle className="h-5 w-5 text-red-600" />
                )}
                <Button
                  onClick={testConnection}
                  disabled={connectionStatus === "testing"}
                  variant={connectionStatus === "connected" ? "outline" : "default"}
                >
                  {connectionStatus === "testing" && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {connectionStatus === "connected" ? t("retest") : t("testConnection")}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="test-message">{t("testMessage")}</Label>
              <Textarea
                id="test-message"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                placeholder={t("testMessagePlaceholder")}
                rows={3}
              />
            </div>

            <Button
              onClick={sendTestMessage}
              disabled={loading || !testMessage.trim()}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("sending")}
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  {t("sendTestMessage")}
                </>
              )}
            </Button>

            {response && (
              <div className="space-y-2">
                <Label>{t("response")}</Label>
                <div className="rounded-lg border bg-muted p-4">
                  <p className="whitespace-pre-wrap">{response}</p>
                </div>
              </div>
            )}

            <Alert>
              <AlertDescription>
                <strong>{t("provider")}:</strong> {integration?.provider?.replace("_", " ")}
                <br />
                <strong>{t("defaultModel")}:</strong> {integration?.llmProviderConfig?.defaultModel || t("notConfigured")}
                <br />
                <strong>{t("status")}:</strong> {integration?.status}
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}