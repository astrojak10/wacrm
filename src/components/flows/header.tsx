"use client";

/**
 * Editor toolbar — flow name / description, status chip, dirty
 * indicator, and the action buttons (Save, Activate/Pause, Delete,
 * View runs, Back).
 *
 * Restyled to the Flow Builder design handoff: a single compact
 * toolbar row (back · icon · inline-editable name · status chip ·
 * edited dot on the left; Runs · Delete · Activate · Save on the
 * right) followed by a subtle, full-width description "note" line.
 * Replaces the old three-row stack so the editor reads as one app
 * chrome bar above the canvas/list stage.
 *
 * Lifted out of flow-builder.tsx so the same toolbar renders above
 * both views in FlowEditorShell. Without this, canvas users had no
 * way to save without toggling to list view.
 *
 * Reads everything from the editor context (`useFlowEditor`) so it
 * stays in sync with whichever view is mutating state, and routes
 * router navigation locally (back to /flows, View runs to
 * /flows/[id]/runs) — those don't belong in the hook.
 */

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CircleDot,
  Download,
  History,
  Loader2,
  PauseCircle,
  PlayCircle,
  Save,
  Trash2,
  Upload,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  MAX_FLOW_FILE_BYTES,
  parseFlowFile,
  serializeFlowFile,
  type FlowFileData,
} from "@/lib/flows/file";
import { cn } from "@/lib/utils";
import {
  useFlowEditor,
  type BuilderState,
} from "./flow-editor-state";

export function EditorHeader() {
  const router = useRouter();
  const t = useTranslations("Flows.header");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const {
    flow,
    lastUpdatedAt,
    state,
    setState,
    dirty,
    saving,
    activating,
    canActivate,
    save,
    setStatus,
    deleteFlow,
  } = useFlowEditor();

  const exportToFile = () => {
    const portableFlow: FlowFileData = {
      name: state.name,
      description: state.description,
      trigger_type: state.trigger_type,
      trigger_config: state.trigger_config,
      entry_node_id: state.entry_node_id,
      fallback_policy: state.fallback_policy,
      nodes: state.nodes.map((node) => ({
        ...node,
        position_x: node.position_x ?? 0,
        position_y: node.position_y ?? 0,
      })),
    };
    const blob = new Blob([serializeFlowFile(portableFlow)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName =
      state.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "flow";
    link.href = url;
    link.download = `${safeName}.wacrm-flow.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importFromFile = async (file: File) => {
    setImporting(true);
    try {
      if (file.size > MAX_FLOW_FILE_BYTES) {
        throw new Error(t("importTooLarge"));
      }
      const imported = parseFlowFile(await file.text());
      if (!window.confirm(t("importConfirm"))) return;
      setState((current) => ({
        ...current,
        name: imported.name,
        description: imported.description,
        trigger_type: imported.trigger_type,
        trigger_config: imported.trigger_config,
        entry_node_id: imported.entry_node_id,
        fallback_policy: imported.fallback_policy,
        nodes: imported.nodes,
      }));
      toast.success(t("importStaged"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("importFailed"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 px-6 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* ---- left: back · icon · name · status · edited ---- */}
        <button
          type="button"
          onClick={() => router.push("/flows")}
          title={t("backToFlows")}
          aria-label={t("backToFlows")}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Workflow className="h-[18px] w-[18px]" />
        </span>
        <input
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          placeholder={t("namePlaceholder")}
          spellCheck={false}
          aria-label={t("namePlaceholder")}
          className="min-w-[120px] max-w-[340px] rounded-lg border border-transparent bg-transparent px-2 py-1 text-lg font-bold leading-tight tracking-tight text-foreground outline-none transition-colors hover:bg-muted focus:border-primary focus:bg-transparent focus:shadow-[0_0_0_3px_var(--primary-soft)]"
        />
        <StatusChip status={state.status} />
        {dirty && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
            title={t("unsavedHint")}
            aria-live="polite"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {t("edited")}
          </span>
        )}

        {/* ---- right: runs · file actions · delete · activate · save ---- */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/flows/${flow.id}/runs`)}
          >
            <History className="h-3.5 w-3.5" />
            {t("runs")}
            <span className="ml-0.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {flow.execution_count}
            </span>
          </Button>
          <Button variant="ghost" size="sm" onClick={exportToFile}>
            <Download className="h-3.5 w-3.5" />
            {t("exportPC")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={saving || importing}
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {t("importPC")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.wacrm-flow.json,application/json"
            aria-label={t("importPC")}
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importFromFile(file);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void deleteFlow()}
            className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("delete")}
          </Button>
          {state.status === "active" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus("draft")}
              disabled={activating}
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" />
              )}
              {t("pause")}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setStatus("active")}
              disabled={activating || !canActivate}
              title={
                !canActivate ? t("fixIssues") : undefined
              }
            >
              {activating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              {t("activate")}
            </Button>
          )}
          <Button onClick={() => void save()} disabled={saving} size="sm">
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {t("save")}
          </Button>
        </div>
      </div>

      <div className="flex items-center px-2 text-xs text-muted-foreground">
        <time dateTime={lastUpdatedAt ?? undefined}>
          {t("lastUpdated", { date: formatUtcTimestamp(lastUpdatedAt) })}
        </time>
      </div>

      {/* ---- description note (subtle, inline-editable) ---- */}
      <input
        value={state.description}
        onChange={(e) =>
          setState((s) => ({ ...s, description: e.target.value }))
        }
        placeholder={t("descriptionPlaceholder")}
        aria-label={t("descriptionLabel")}
        className="w-full max-w-[78ch] rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/50 focus:border-primary focus:bg-transparent focus:text-foreground"
      />
    </div>
  );
}

function formatUtcTimestamp(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const raw = String(value).trim();
    if (!raw) return "—";
    return raw;
  }
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function StatusChip({ status }: { status: BuilderState["status"] }) {
  // Status labels live with the flows list so the chip and the list
  // badge can never drift apart.
  const t = useTranslations("Flows.list");
  const cfg = {
    draft: {
      // Neutral, not amber — amber is reserved for the adjacent
      // "Edited" dirty signal, so the two don't read as the same alert.
      cls: "border-border bg-muted text-muted-foreground",
      label: t("statusDraft"),
    },
    active: {
      cls: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
      label: t("statusActive"),
    },
    archived: {
      cls: "border-border bg-muted/50 text-muted-foreground",
      label: t("statusArchived"),
    },
  }[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium",
        cfg.cls,
      )}
    >
      <CircleDot className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
