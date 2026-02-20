"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, Plug, RefreshCw, PowerOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import type { Workspace } from "@/types";

interface IntegrationData {
  id: string;
  name: string;
  description: string;
  icon: string;
  auth: string;
  integrationId: string | null;
  status: string;
  lastSyncedAt: string | null;
  autoSyncEnabled: boolean;
  autoSyncTimeLocal: string;
  autoSyncTimezone: string | null;
  lastSyncError: string | null;
}

type ProviderKey = "google" | "microsoft";
type ProviderStatus = "connected" | "disconnected" | "syncing" | "error";

const PROVIDERS: Array<{
  key: ProviderKey;
  title: string;
  description: string;
  connectPath: string;
  connectorIds: string[];
}> = [
  {
    key: "google",
    title: "Google",
    description: "Gmail, Calendar, and Contacts",
    connectPath: "/api/integrations/google/connect",
    connectorIds: ["gmail", "google-calendar", "google-contacts"],
  },
  {
    key: "microsoft",
    title: "Microsoft",
    description: "Mail, Calendar, and Contacts",
    connectPath: "/api/integrations/microsoft/connect",
    connectorIds: ["microsoft-mail", "microsoft-calendar", "microsoft-contacts"],
  },
];

function statusMeta(status: ProviderStatus): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (status === "connected") return { label: "Connected", variant: "default" };
  if (status === "syncing") return { label: "Syncing", variant: "secondary" };
  if (status === "error") return { label: "Error", variant: "destructive" };
  return { label: "Not Connected", variant: "outline" };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function SettingsPage() {
  const searchParams = useSearchParams();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [customInstructions, setCustomInstructions] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [providerPending, setProviderPending] = useState<Record<ProviderKey, boolean>>({
    google: false,
    microsoft: false,
  });

  const providerViews = useMemo(() => {
    return PROVIDERS.map((provider) => {
      const entries = integrations.filter((entry) =>
        provider.connectorIds.includes(entry.id)
      );
      const connectedEntries = entries.filter(
        (entry) => entry.integrationId && entry.status !== "disconnected"
      );

      const hasError = connectedEntries.some((entry) => entry.status === "error");
      const isSyncing = connectedEntries.some((entry) => entry.status === "syncing");
      const isConnected = connectedEntries.length > 0;

      const latestSynced = connectedEntries
        .map((entry) => entry.lastSyncedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) || null;

      const lastError = connectedEntries.find((entry) => entry.lastSyncError)?.lastSyncError || null;

      let status: ProviderStatus = "disconnected";
      if (hasError) status = "error";
      else if (isSyncing) status = "syncing";
      else if (isConnected) status = "connected";

      return {
        provider,
        entries,
        connectedEntries,
        status,
        latestSynced,
        lastError,
      };
    });
  }, [integrations]);

  const hasSyncingProvider = useMemo(
    () => providerViews.some((view) => view.status === "syncing"),
    [providerViews]
  );

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success === "google") {
      toast.success("Google connected. Initial sync started.");
      fetchIntegrations();
    }

    if (success === "microsoft") {
      toast.success("Microsoft connected. Initial sync started.");
      fetchIntegrations();
    }

    if (error) {
      toast.error(`Connection failed: ${error}`);
      fetchIntegrations();
    }
  }, [searchParams]);

  useEffect(() => {
    if (!hasSyncingProvider) return;

    const timer = window.setInterval(() => {
      fetchIntegrations().catch(() => {
        // Ignore polling errors and keep last known state.
      });
    }, 8000);

    return () => window.clearInterval(timer);
  }, [hasSyncingProvider]);

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      const [workspaceResponse, integrationsResponse] = await Promise.all([
        apiFetch("/api/workspace"),
        apiFetch("/api/integrations"),
      ]);

      if (workspaceResponse.ok) {
        const data = await workspaceResponse.json();
        const nextWorkspace = data.workspace ?? data.organization ?? null;
        setWorkspace(nextWorkspace);
        const settings = nextWorkspace?.settings;
        if (settings && typeof settings === "object" && !Array.isArray(settings)) {
          const instructions = (settings as Record<string, unknown>).custom_instructions;
          setCustomInstructions(typeof instructions === "string" ? instructions : "");
        } else {
          setCustomInstructions("");
        }
      }

      if (integrationsResponse.ok) {
        const integrationData = (await integrationsResponse.json()) as IntegrationData[];
        setIntegrations(integrationData);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
      toast.error("Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  async function fetchIntegrations() {
    const response = await apiFetch("/api/integrations");
    if (!response.ok) {
      throw new Error("Failed to load integrations");
    }
    const data = (await response.json()) as IntegrationData[];
    setIntegrations(data);
  }

  async function withProviderPending(providerKey: ProviderKey, run: () => Promise<void>) {
    try {
      setProviderPending((prev) => ({ ...prev, [providerKey]: true }));
      await run();
    } finally {
      setProviderPending((prev) => ({ ...prev, [providerKey]: false }));
    }
  }

  async function connectProvider(providerKey: ProviderKey) {
    const provider = PROVIDERS.find((p) => p.key === providerKey);
    if (!provider) return;
    window.location.href = provider.connectPath;
  }

  async function syncProvider(providerKey: ProviderKey) {
    const view = providerViews.find((v) => v.provider.key === providerKey);
    if (!view || view.connectedEntries.length === 0) return;

    await withProviderPending(providerKey, async () => {
      await Promise.all(
        view.connectedEntries
          .map((entry) => entry.integrationId)
          .filter((id): id is string => Boolean(id))
          .map((integrationId) =>
            apiFetch(`/api/integrations/${integrationId}/sync`, { method: "POST" })
          )
      );

      toast.success(`${view.provider.title} sync started`);
      await fetchIntegrations();
    });
  }

  async function disconnectProvider(providerKey: ProviderKey) {
    const view = providerViews.find((v) => v.provider.key === providerKey);
    if (!view || view.connectedEntries.length === 0) return;

    if (!confirm(`Disconnect ${view.provider.title} integrations?`)) {
      return;
    }

    await withProviderPending(providerKey, async () => {
      await Promise.all(
        view.connectedEntries
          .map((entry) => entry.integrationId)
          .filter((id): id is string => Boolean(id))
          .map((integrationId) =>
            apiFetch(`/api/integrations/${integrationId}/disconnect`, {
              method: "POST",
            })
          )
      );

      toast.success(`${view.provider.title} disconnected`);
      await fetchIntegrations();
    });
  }

  const saveCustomInstructions = async () => {
    try {
      setSaveStatus("saving");
      const response = await apiFetch("/api/workspace", {
        method: "PATCH",
        body: JSON.stringify({ custom_instructions: customInstructions }),
      });

      if (!response.ok) {
        setSaveStatus("error");
        return;
      }

      const data = await response.json();
      const nextWorkspace = data.workspace ?? data.organization ?? null;
      setWorkspace(nextWorkspace);
      setSaveStatus("saved");
    } catch (error) {
      console.error("Failed to save instructions:", error);
      setSaveStatus("error");
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-72" />
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-serif font-medium tracking-tight text-foreground">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">Manage your workspace</p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center">
              <Plug className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-lg">Integrations</CardTitle>
              <CardDescription>
                Connect providers and import contacts, calendar events, and interactions.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {providerViews.map((view) => {
            const statusInfo = statusMeta(view.status);
            const pending = providerPending[view.provider.key];

            return (
              <div
                key={view.provider.key}
                className="rounded-lg border p-4 flex flex-col gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{view.provider.title}</h3>
                      <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{view.provider.description}</p>
                  </div>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
                </div>

                {view.status === "syncing" ? (
                  <p className="text-sm text-muted-foreground">
                    Initial import in progress. This may take a few minutes.
                  </p>
                ) : null}

                {view.lastError ? (
                  <p className="text-sm text-destructive">{view.lastError}</p>
                ) : null}

                {view.latestSynced ? (
                  <p className="text-sm text-muted-foreground">
                    Last synced: {timeAgo(view.latestSynced)}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {view.status === "disconnected" ? (
                    <Button onClick={() => connectProvider(view.provider.key)} disabled={pending}>
                      Connect {view.provider.title}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => syncProvider(view.provider.key)}
                        disabled={pending || view.status === "syncing"}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Sync now
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => disconnectProvider(view.provider.key)}
                        disabled={pending}
                      >
                        <PowerOff className="mr-2 h-4 w-4" />
                        Disconnect
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center">
              <Building2 className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-lg">Workspace</CardTitle>
              <CardDescription>Your workspace information</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {workspace ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Name</Label>
                <p className="font-medium text-foreground">{workspace.name}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Slug</Label>
                <p className="font-medium text-foreground">{workspace.slug}</p>
              </div>
              {workspace.website && (
                <div className="col-span-2">
                  <Label className="text-muted-foreground text-xs uppercase tracking-wide">Website</Label>
                  <p className="font-medium text-foreground">{workspace.website}</p>
                </div>
              )}
              <div>
                <Label className="text-muted-foreground text-xs uppercase tracking-wide">Created</Label>
                <p className="text-sm text-foreground">
                  {new Date(workspace.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No workspace found</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center">
              <Building2 className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-lg">Custom instructions</CardTitle>
              <CardDescription>
                Context to append to the planning agent prompt for this workspace.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="custom-instructions" className="text-muted-foreground text-xs uppercase tracking-wide">
              Instructions
            </Label>
            <Textarea
              id="custom-instructions"
              value={customInstructions}
              onChange={(event) => {
                setCustomInstructions(event.target.value);
                if (saveStatus !== "idle") {
                  setSaveStatus("idle");
                }
              }}
              placeholder="Add background info, tone preferences, or constraints for this organization."
              rows={6}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveCustomInstructions} disabled={saveStatus === "saving"}>
              {saveStatus === "saving" ? "Saving..." : "Save instructions"}
            </Button>
            {saveStatus === "saved" && (
              <span className="text-sm text-muted-foreground">Saved</span>
            )}
            {saveStatus === "error" && (
              <span className="text-sm text-destructive">Failed to save</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center">
              <Building2 className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-lg">Members & Invites</CardTitle>
              <CardDescription>Manage workspace access</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/app/settings/members">Manage members</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
