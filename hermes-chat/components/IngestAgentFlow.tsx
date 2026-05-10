"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, PointerEvent } from "react";
import { Orb } from "@/components/ui/orb";
import { CHAT_AGENT_ORB_COLORS } from "@/lib/architect-orb-presets";
import {
  ingestFocusedReaders,
  ingestProgressPercent,
  phaseDisplayLabel,
  type SharedIngestPhaseKey,
  type IngestFocusedReader,
} from "@/lib/shared-ingest-hero-copy";
import type { VaultAssetRole } from "@/lib/ingest-message";
import type {
  SharedIngestReaderTask,
  SharedIngestReviewTask,
  SharedIngestSwarmTaskStatus,
} from "@/lib/shared-ingest-job-store";
import { cn } from "@/lib/utils";

type Props = {
  status: "queued" | "running" | "done" | "error";
  phaseKey?: SharedIngestPhaseKey;
  role?: VaultAssetRole;
  isQueuedWaiting?: boolean;
  compact?: boolean;
  readerTasks?: SharedIngestReaderTask[];
  challengeTask?: SharedIngestReviewTask;
  mergeTask?: SharedIngestReviewTask;
  jobId?: string;
};

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function taskState(status: SharedIngestSwarmTaskStatus): IngestFocusedReader["state"] {
  if (status === "done" || status === "skipped") return "done";
  if (status === "running") return "active";
  if (status === "error") return "error";
  return "waiting";
}

function taskReader(task: {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  status: SharedIngestSwarmTaskStatus;
  progress: number;
}): IngestFocusedReader {
  return {
    id: task.id,
    label: task.label,
    progress: clampPercent(task.status === "skipped" ? 100 : task.progress),
    state: taskState(task.status),
  };
}

type DisplayAgent = IngestFocusedReader & {
  name: string;
  task: string;
  longTask: string;
  statusLabel: string;
  colors: [string, string];
};

type TaskPersona = {
  task: string;
  longTask: string;
  colors: [string, string];
  names: string[];
};

type IngestTipState = {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
};

const STABLE_INGEST_ORB_INPUT = 0.58;
const STABLE_INGEST_ORB_OUTPUT = 0.58;

const TASK_PERSONAS: Record<string, TaskPersona> = {
  "text-reader": {
    task: "Maps the document",
    longTask:
      "Maps the clean text, headings, sections, and source shape Hermes should trust first.",
    colors: ["#3b82f6", "#93c5fd"],
    names: [
      "Lovelace",
      "Borges",
      "Pascal",
      "Sagan",
      "Wells",
      "Ada",
      "Faraday",
      "Vera",
      "Minsky",
      "Hopper",
    ],
  },
  "detail-reader": {
    task: "Pulls out key facts",
    longTask:
      "Finds the people, dates, decisions, requirements, numbers, and reusable facts.",
    colors: ["#22c55e", "#86efac"],
    names: [
      "Curie",
      "Franklin",
      "Raman",
      "Darwin",
      "Tesla",
      "Euclid",
      "Hedy",
      "Ibn Sina",
      "Bell",
      "Meitner",
    ],
  },
  "table-media-reader": {
    task: "Protects tables and images",
    longTask:
      "Checks tables, image references, OCR, media sidecars, and structured evidence so they are not lost.",
    colors: ["#f59e0b", "#fde68a"],
    names: [
      "Noether",
      "Kovalevskaya",
      "Lumiere",
      "Daguerre",
      "Hilbert",
      "Banneker",
      "Maxwell",
      "Fibonacci",
      "Galois",
      "Mirzakhani",
    ],
  },
  "relationship-reader": {
    task: "Connects people and projects",
    longTask:
      "Links names, companies, projects, topics, and source paths so Hermes can join the dots later.",
    colors: ["#14b8a6", "#99f6e4"],
    names: [
      "Darwin",
      "Humboldt",
      "Latour",
      "Leibniz",
      "Anning",
      "Wallace",
      "Mendel",
      "Carson",
      "Fanon",
      "Bateson",
    ],
  },
  "retrieval-reader": {
    task: "Builds search routes",
    longTask:
      "Builds the retrieval map so future answers read all relevant evidence instead of stopping at the first match.",
    colors: ["#8b5cf6", "#c4b5fd"],
    names: [
      "Turing",
      "Shannon",
      "Engelbart",
      "Knuth",
      "Dijkstra",
      "Lamport",
      "Hamilton",
      "Kay",
      "Licklider",
      "McCarthy",
    ],
  },
  "structure-reader": {
    task: "Reads layout flow",
    longTask:
      "Captures reusable section order, layout rhythm, table placement, and document flow.",
    colors: ["#06b6d4", "#67e8f9"],
    names: [
      "Eames",
      "Kahn",
      "Aalto",
      "Hadid",
      "Wright",
      "Saarinen",
      "Gray",
      "Loos",
      "Niemeyer",
      "Gropius",
    ],
  },
  "style-reader": {
    task: "Captures tone and style",
    longTask:
      "Reads voice, typography clues, emphasis, visual rhythm, and the feel to reuse without copying old facts.",
    colors: ["#ec4899", "#f9a8d4"],
    names: [
      "Kahlo",
      "Morrison",
      "Le Guin",
      "Baldwin",
      "Austen",
      "Woolf",
      "Angelou",
      "Dante",
      "Neruda",
      "Calvino",
    ],
  },
  "rules-reader": {
    task: "Turns rules into checks",
    longTask:
      "Turns requirements, standards, rubrics, and review rules into clear checks Hermes can use later.",
    colors: ["#fb923c", "#fed7aa"],
    names: [
      "Socrates",
      "Aristotle",
      "Kant",
      "Hume",
      "Aquinas",
      "Spinoza",
      "Mill",
      "Plato",
      "Locke",
      "Seneca",
    ],
  },
  "gap-reader": {
    task: "Finds gaps and ambiguity",
    longTask:
      "Looks for missing evidence, weak claims, ambiguity, and places Hermes should be careful.",
    colors: ["#a855f7", "#d8b4fe"],
    names: [
      "Hypatia",
      "Arendt",
      "Weil",
      "Beauvoir",
      "Iris",
      "Aurelius",
      "Popper",
      "Russell",
      "Rumi",
      "Cicero",
    ],
  },
  "company-reader": {
    task: "Builds the organization profile",
    longTask:
      "Pulls together official names, services, positioning, contacts, and public context.",
    colors: ["#0ea5e9", "#7dd3fc"],
    names: [
      "Lovelace",
      "Sagan",
      "Carnegie",
      "Hopper",
      "Franklin",
      "Wells",
      "Humboldt",
      "Bell",
      "Vera",
      "Pascal",
    ],
  },
  "people-reader": {
    task: "Finds people and roles",
    longTask:
      "Finds people, roles, contact details, organization links, and how they relate to the material.",
    colors: ["#10b981", "#6ee7b7"],
    names: [
      "Curie",
      "Darwin",
      "Meitner",
      "Hedy",
      "Ibn Sina",
      "Franklin",
      "Mendel",
      "Raman",
      "Anning",
      "Euclid",
    ],
  },
  "brand-reader": {
    task: "Captures brand feel",
    longTask:
      "Captures real organization voice, visual cues, colors, approved terms, and brand guardrails.",
    colors: ["#eab308", "#fde047"],
    names: [
      "Kahlo",
      "Eames",
      "Matisse",
      "Olivetti",
      "Bauhaus",
      "Basquiat",
      "Rothko",
      "Miyake",
      "Gropius",
      "Hadid",
    ],
  },
  challenge: {
    task: "Challenges weak reads",
    longTask:
      "Challenges the first pass, asks what is missing, and sends weak readers back for a better run.",
    colors: ["#ef4444", "#fca5a5"],
    names: [
      "Nietzsche",
      "Diogenes",
      "Socrates",
      "Hume",
      "Arendt",
      "Seneca",
      "Foucault",
      "Weil",
      "Fanon",
      "Simone",
    ],
  },
  merge: {
    task: "Synthesizes the vault pack",
    longTask:
      "Merges the readers into one clean vault pack with evidence paths and retrieval notes.",
    colors: ["#facc15", "#fef08a"],
    names: [
      "Hypatia",
      "Shannon",
      "Newton",
      "Kepler",
      "Athena",
      "Voltaire",
      "Ramanujan",
      "Le Guin",
      "Mira",
      "Hopper",
    ],
  },
};

const FALLBACK_PERSONAS: TaskPersona[] = [
  TASK_PERSONAS["text-reader"]!,
  TASK_PERSONAS["detail-reader"]!,
  TASK_PERSONAS["relationship-reader"]!,
  TASK_PERSONAS["retrieval-reader"]!,
  TASK_PERSONAS.challenge!,
  TASK_PERSONAS.merge!,
];

const PROGRESS_MEMORY = new Map<string, number>();

function hashString(raw: string): number {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function personaFor(reader: IngestFocusedReader, index: number): TaskPersona {
  const baseId = reader.id.replace(/-\d+$/, "");
  const alias =
    baseId === "text"
      ? "text-reader"
      : baseId === "details"
        ? "detail-reader"
        : baseId === "tables"
          ? "table-media-reader"
          : baseId === "links"
            ? "relationship-reader"
            : baseId === "search" || baseId === "finder"
              ? "retrieval-reader"
              : baseId === "tone" || baseId === "template"
                ? "style-reader"
                : baseId === "rules" || baseId === "checks"
                  ? "rules-reader"
                  : baseId === "brand" || baseId === "visuals" || baseId === "kit"
                    ? "brand-reader"
                    : baseId === "company"
                      ? "company-reader"
                      : null;
  return (
    TASK_PERSONAS[reader.id] ??
    TASK_PERSONAS[baseId] ??
    (alias ? TASK_PERSONAS[alias] : undefined) ??
    FALLBACK_PERSONAS[index % FALLBACK_PERSONAS.length]!
  );
}

function statusLabel(reader: IngestFocusedReader): string {
  if (reader.state === "error") return "Needs review";
  if (reader.state === "done") return "Returned";
  if (reader.state === "active") {
    if (reader.id === "merge") return "Merging";
    if (reader.id === "challenge") return "Checking";
    return reader.progress >= 70 ? "Checking" : "Working";
  }
  return "Waiting";
}

function agentTip(reader: DisplayAgent): string {
  return `${reader.label} ${reader.statusLabel.toLowerCase()}: ${reader.longTask}`;
}

function displayAgent(
  reader: IngestFocusedReader,
  index: number,
  seed: string
): DisplayAgent {
  const persona = personaFor(reader, index);
  const name =
    persona.names[hashString(`${seed}:${reader.id}:${index}`) % persona.names.length] ??
    persona.names[0]!;
  return {
    ...reader,
    name,
    task: persona.task,
    longTask: persona.longTask,
    statusLabel: statusLabel(reader),
    colors: persona.colors,
  };
}

function progressFromTasks(params: {
  status: "queued" | "running" | "done" | "error";
  readers: SharedIngestReaderTask[];
  challengeTask?: SharedIngestReviewTask;
  mergeTask?: SharedIngestReviewTask;
}): number {
  if (params.status === "done") return 100;
  if (params.status === "queued") return 8;
  const weightedTaskProgress = (task: {
    status: SharedIngestSwarmTaskStatus;
    progress: number;
  }) => {
    if (task.status === "done" || task.status === "skipped") return 100;
    if (task.status === "running") return Math.max(18, clampPercent(task.progress));
    if (task.status === "error") return clampPercent(task.progress);
    return 0;
  };
  const readerAvg =
    params.readers.length > 0
      ? params.readers.reduce((sum, task) => sum + weightedTaskProgress(task), 0) /
        params.readers.length
      : 0;
  const challenge = params.challengeTask
    ? weightedTaskProgress(params.challengeTask)
    : 0;
  const merge = params.mergeTask ? weightedTaskProgress(params.mergeTask) : 0;
  const taskProgress = readerAvg * 0.68 + challenge * 0.16 + merge * 0.16;
  return clampPercent(Math.max(18, taskProgress));
}

function swarmStatusCopy(params: {
  status: "queued" | "running" | "done" | "error";
  phaseKey?: SharedIngestPhaseKey;
  agents: DisplayAgent[];
  hasChallenge: boolean;
  hasMerge: boolean;
}): { eyebrow: string; title: string; body: string } {
  if (params.status === "queued") {
    return {
      eyebrow: "Queued",
      title: "Waiting for the next ingest slot",
      body: "Hermes will start the focused readers as soon as this vault is ready.",
    };
  }
  if (params.status === "done") {
    return {
      eyebrow: "Saved",
      title: "Vault pack saved",
      body: "The readers have returned, Hermes has merged the findings, and chat can use this evidence.",
    };
  }
  if (params.status === "error") {
    return {
      eyebrow: "Needs review",
      title: "Ingest needs attention",
      body: "One of the passes could not finish cleanly. Hermes keeps the source, but this run should be checked.",
    };
  }

  const active = params.agents.filter((agent) => agent.state === "active");
  const done = params.agents.filter((agent) => agent.state === "done");
  const waiting = params.agents.filter((agent) => agent.state === "waiting");
  const errored = params.agents.filter((agent) => agent.state === "error");
  const activeMerge = active.find((agent) => agent.id === "merge");
  const activeChallenge = active.find((agent) => agent.id === "challenge");
  const phase = phaseDisplayLabel(params.phaseKey ?? "unknown", "running");

  if (errored.length > 0) {
    return {
      eyebrow: phase,
      title: "A reader needs review",
      body: `${errored[0]!.label} found something uncertain. Hermes can continue, but this pass should be checked.`,
    };
  }

  if (activeMerge) {
    return {
      eyebrow: phase,
      title: "Merging the vault pack",
      body: "The merge pass is writing the final vault update from the readers that returned.",
    };
  }

  if (activeChallenge) {
    return {
      eyebrow: phase,
      title: "Checking coverage",
      body: "The challenge pass is checking weak spots before Hermes saves the final vault pack.",
    };
  }

  if (active.length > 0) {
    return {
      eyebrow: phase,
      title:
        done.length > 0
          ? "Findings are coming back"
          : "Focused readers are working",
      body: `${active.map((agent) => agent.label).join(", ")} ${
        active.length === 1 ? "is" : "are"
      } working now. ${done.length} of ${params.agents.length} passes have returned.`,
    };
  }

  if (done.length === params.agents.length && params.hasMerge) {
    return {
      eyebrow: phase,
      title: "Merging the vault pack",
      body: "All readers have returned. Hermes is turning their findings into one clean vault update.",
    };
  }

  if (done.length === params.agents.length && params.hasChallenge) {
    return {
      eyebrow: phase,
      title: "Checking coverage",
      body: "All readers have returned. Hermes is checking weak spots before the final merge.",
    };
  }

  if (done.length === params.agents.length) {
    return {
      eyebrow: phase,
      title: phase,
      body: "All focused readers have returned. Hermes is doing the current vault step before saving the final vault pack.",
    };
  }

  return {
    eyebrow: phase,
    title: "Preparing focused readers",
    body: `${waiting.length} reader${waiting.length === 1 ? "" : "s"} waiting for their turn.`,
  };
}

type FlowNode = {
  id: string;
  x: number;
  y: number;
  label: string;
  subLabel: string;
  kind: "hermes" | "reader" | "prestage" | "challenge" | "merge" | "vault";
  agent?: DisplayAgent;
  state?: IngestFocusedReader["state"];
  tip: string;
};

type FlowEdge = {
  id: string;
  from: FlowNode;
  to: FlowNode;
  tone: "send" | "return" | "challenge" | "merge" | "vault" | "idle";
  active: boolean;
  reverse?: boolean;
};

function flowPath(from: FlowNode, to: FlowNode): string {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dy >= dx) {
    const midY = (from.y + to.y) / 2;
    const bend = (to.x - from.x) * 0.12;
    return `M ${from.x} ${from.y} C ${from.x + bend} ${midY}, ${to.x - bend} ${midY}, ${to.x} ${to.y}`;
  }
  const midX = (from.x + to.x) / 2;
  const bend = (to.y - from.y) * 0.18;
  return `M ${from.x} ${from.y} C ${midX} ${from.y + bend}, ${midX} ${to.y - bend}, ${to.x} ${to.y}`;
}

function flowStateClass(state: IngestFocusedReader["state"] | undefined): string {
  if (state === "active") return "is-active";
  if (state === "done") return "is-done";
  if (state === "error") return "is-error";
  return "is-waiting";
}

export function IngestAgentFlow({
  status,
  phaseKey,
  role,
  isQueuedWaiting = false,
  compact = false,
  readerTasks,
  challengeTask,
  mergeTask,
  jobId,
}: Props) {
  const hasRealTasks = Array.isArray(readerTasks) && readerTasks.length > 0;
  const phaseTargetProgress = ingestProgressPercent({
    status,
    phaseKey,
    role,
    isQueuedWaiting,
  });
  const targetProgress = hasRealTasks
    ? Math.max(
        phaseTargetProgress,
        progressFromTasks({
          status,
          readers: readerTasks,
          challengeTask,
          mergeTask,
        })
      )
    : phaseTargetProgress;
  const progressMemoryKey = useMemo(
    () =>
      jobId ??
      [
        role ?? "generic",
        status,
        phaseKey ?? "unknown",
        readerTasks?.map((task) => task.id).join("|") ?? "no-real-tasks",
      ].join(":"),
    [jobId, phaseKey, readerTasks, role, status]
  );
  const targetRef = useRef(targetProgress);
  targetRef.current = targetProgress;
  const [progress, setProgress] = useState(() =>
    Math.max(PROGRESS_MEMORY.get(progressMemoryKey) ?? 0, targetProgress)
  );

  useEffect(() => {
    setProgress(Math.max(PROGRESS_MEMORY.get(progressMemoryKey) ?? 0, targetRef.current));
  }, [progressMemoryKey]);

  useEffect(() => {
    const target =
      status === "error"
        ? progress
        : Math.max(PROGRESS_MEMORY.get(progressMemoryKey) ?? 0, targetProgress);
    if (target > (PROGRESS_MEMORY.get(progressMemoryKey) ?? 0)) {
      PROGRESS_MEMORY.set(progressMemoryKey, target);
    }
    if (target <= progress) return;
    const id = window.setTimeout(() => {
      setProgress((current) => {
        const next = Math.max(current, target);
        PROGRESS_MEMORY.set(progressMemoryKey, next);
        return next;
      });
    }, 80);
    return () => window.clearTimeout(id);
  }, [progress, progressMemoryKey, status, targetProgress]);

  const readers = hasRealTasks
    ? [
        ...readerTasks.map(taskReader),
        ...(challengeTask ? [taskReader(challengeTask)] : []),
        ...(mergeTask ? [taskReader(mergeTask)] : []),
      ]
    : ingestFocusedReaders({
        status,
        phaseKey,
        role,
        isQueuedWaiting,
      });
  const working = status === "running" || status === "queued";
  const agents = readers.map((reader, index) =>
    displayAgent(reader, index, progressMemoryKey)
  );
  const swarmCopy = swarmStatusCopy({
    status,
    phaseKey,
    agents,
    hasChallenge: Boolean(challengeTask),
    hasMerge: Boolean(mergeTask),
  });
  const returnedCount = agents.filter((agent) => agent.state === "done").length;
  const workingCount = agents.filter((agent) => agent.state === "active").length;
  const reviewCount = agents.filter((agent) => agent.state === "error").length;
  const [activeTip, setActiveTip] = useState<IngestTipState | null>(null);

  function showIngestTip(el: HTMLElement) {
    const text = el.dataset.ingestTip?.trim();
    if (!text) return;
    const rect = el.getBoundingClientRect();
    const placement = rect.top < 110 ? "bottom" : "top";
    setActiveTip({
      text,
      x: rect.left + rect.width / 2,
      y: placement === "top" ? rect.top : rect.bottom,
      placement,
    });
  }

  function handleTipPointerOver(e: PointerEvent<HTMLDivElement>) {
    const target = e.target instanceof Element ? e.target : null;
    const el = target?.closest<HTMLElement>("[data-ingest-tip]");
    if (!el || !e.currentTarget.contains(el)) return;
    showIngestTip(el);
  }

  function handleTipPointerOut(e: PointerEvent<HTMLDivElement>) {
    const next = e.relatedTarget instanceof Element ? e.relatedTarget : null;
    if (next?.closest("[data-ingest-tip]")) return;
    setActiveTip(null);
  }

  function handleTipFocus(e: FocusEvent<HTMLDivElement>) {
    const target = e.target instanceof Element ? e.target : null;
    const el = target?.closest<HTMLElement>("[data-ingest-tip]");
    if (!el || !e.currentTarget.contains(el)) return;
    showIngestTip(el);
  }

  const tipLayer = activeTip ? (
    <div
      className={`ingest-agent-tip-bubble is-${activeTip.placement}`}
      style={{ left: activeTip.x, top: activeTip.y }}
      role="status"
    >
      {activeTip.text}
    </div>
  ) : null;

  const flowStyles = (
    <style>{`
      [data-ingest-tip] {
        position: relative;
      }

      .ingest-agent-tip-bubble {
        position: fixed;
        z-index: 1000;
        width: max-content;
        max-width: min(18rem, calc(100vw - 2rem));
        pointer-events: none;
        border: 1px solid color-mix(in oklch, var(--sidebar-primary) 78%, white 4%);
        border-radius: var(--radius);
        background:
          linear-gradient(180deg, color-mix(in oklch, var(--sidebar-depth-raised) 92%, black), color-mix(in oklch, var(--sidebar-depth-input) 86%, black));
        box-shadow:
          0 0 0 1px color-mix(in oklch, var(--sidebar-primary) 22%, transparent),
          0 0.75rem 1.8rem hsl(0 0% 0% / 0.38),
          var(--sidebar-neu-raised);
        color: var(--foreground);
        font-size: 0.72rem;
        font-weight: 500;
        line-height: 1.32;
        padding: 0.52rem 0.65rem;
        text-align: left;
        white-space: normal;
        animation: ingest-agent-tip-in 120ms ease-out;
      }

      .ingest-agent-tip-bubble.is-top {
        transform: translate(-50%, calc(-100% - 0.68rem));
      }

      .ingest-agent-tip-bubble.is-bottom {
        transform: translate(-50%, 0.68rem);
      }

      .ingest-agent-tip-bubble::before {
        position: absolute;
        left: 50%;
        width: 0.58rem;
        height: 0.58rem;
        border: inherit;
        background: color-mix(in oklch, var(--sidebar-depth-input) 90%, black);
        content: "";
        transform: translateX(-50%) rotate(45deg);
      }

      .ingest-agent-tip-bubble.is-top::before {
        bottom: -0.33rem;
        border-left: 0;
        border-top: 0;
      }

      .ingest-agent-tip-bubble.is-bottom::before {
        top: -0.33rem;
        border-right: 0;
        border-bottom: 0;
      }

      @keyframes ingest-agent-tip-in {
        from {
          opacity: 0;
          filter: blur(2px);
        }
        to {
          opacity: 1;
          filter: blur(0);
        }
      }

      .ingest-flow-stage {
        position: relative;
        isolation: isolate;
        min-height: clamp(25rem, 56dvh, 38rem);
        overflow: visible;
        border-radius: 0;
        background: transparent;
      }

      .ingest-flow-stage::before {
        position: absolute;
        inset: 0;
        z-index: -2;
        pointer-events: none;
        background-image: linear-gradient(115deg, hsl(0 0% 100% / 0.018) 0 1px, transparent 1px 10px);
        mask-image: radial-gradient(ellipse at 50% 54%, black 0%, transparent 68%);
        opacity: 0.14;
        content: "";
      }

      .ingest-flow-stage::after {
        display: none;
        content: none;
      }

      .ingest-flow-edge {
        fill: none;
        stroke: color-mix(in oklch, var(--sidebar-primary) 28%, var(--muted-foreground));
        stroke-width: 0.16;
        stroke-linecap: round;
        stroke-dasharray: 0.9 7.2;
        opacity: 0.12;
      }

      .ingest-flow-edge.is-active {
        stroke-width: 0.26;
        opacity: 0.38;
        animation: ingest-flow-dash 8s linear infinite;
      }

      .ingest-flow-edge.is-reverse {
        animation-direction: reverse;
      }

      .ingest-flow-edge.tone-return {
        stroke: #38d6c3;
      }

      .ingest-flow-edge.tone-challenge {
        stroke: #f87171;
      }

      .ingest-flow-edge.tone-merge,
      .ingest-flow-edge.tone-vault {
        stroke: #93c5fd;
      }

      @keyframes ingest-flow-dash {
        to {
          stroke-dashoffset: -40;
        }
      }

      .ingest-flow-node {
        position: absolute;
        left: var(--flow-x);
        top: var(--flow-y);
        transform: translate(-50%, -50%);
      }

      .ingest-flow-agent {
        width: clamp(4.35rem, 8.8vw, 5.8rem);
        border: 0;
        background: transparent;
        color: var(--foreground);
        text-align: center;
        transform: translate(-50%, calc(-50% + 0.78rem));
        outline: none;
      }

      .ingest-flow-agent .orb-wrap {
        position: relative;
        isolation: isolate;
        display: block;
        width: clamp(2.15rem, 4.2vw, 3rem);
        height: clamp(2.15rem, 4.2vw, 3rem);
        margin-inline: auto;
      }

      .ingest-flow-agent .orb-wrap > * {
        transform: scale(0.92);
        transform-origin: center;
      }

      .ingest-flow-agent .orb-wrap::after {
        position: absolute;
        inset: 12%;
        z-index: 0;
        border-radius: 999px;
        background: color-mix(in oklch, var(--agent-a, var(--sidebar-primary)) 22%, transparent);
        filter: blur(1.15rem);
        opacity: 0;
        content: "";
      }

      .ingest-flow-agent.is-active .orb-wrap::after {
        opacity: 0.95;
        animation: ingest-flow-pulse 1.5s ease-in-out infinite;
      }

      .ingest-flow-agent.is-done {
        opacity: 0.96;
      }

      .ingest-flow-agent.is-waiting {
        opacity: 0.82;
      }

      .ingest-flow-agent.is-error .orb-wrap {
        filter: drop-shadow(0 0 1.1rem hsl(0 92% 68% / 0.58));
      }

      .ingest-flow-label {
        display: block;
        margin-top: 0.15rem;
        overflow: hidden;
        color: var(--foreground);
        font-size: clamp(0.58rem, 0.95vw, 0.7rem);
        font-weight: 700;
        line-height: 1.05;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-shadow: 0 0 0.6rem hsl(0 0% 0% / 0.65);
      }

      .ingest-flow-sub {
        display: block;
        margin-top: 0.18rem;
        overflow: hidden;
        color: color-mix(in oklch, var(--agent-a, var(--sidebar-primary)) 84%, white);
        font-size: clamp(0.48rem, 0.8vw, 0.58rem);
        font-weight: 700;
        line-height: 1.05;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ingest-flow-state {
        display: block;
        margin-top: 0.18rem;
        overflow: hidden;
        color: var(--muted-foreground);
        font-size: clamp(0.45rem, 0.75vw, 0.54rem);
        font-weight: 600;
        line-height: 1.05;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .ingest-flow-prestage {
        width: clamp(5rem, 9.5vw, 6.6rem);
        color: var(--foreground);
        text-align: center;
        transform: translate(-50%, calc(-50% + 0.7rem));
      }

      .ingest-flow-prestage .prestage-orb-wrap {
        position: relative;
        isolation: isolate;
        display: block;
        width: clamp(3.05rem, 6vw, 4.4rem);
        height: clamp(3.05rem, 6vw, 4.4rem);
        margin-inline: auto;
        transform: translate(0.22rem, 0.24rem);
      }

      .ingest-flow-prestage .prestage-orb-wrap > * {
        transform: scale(0.9);
        transform-origin: center;
      }

      .ingest-flow-prestage .prestage-orb-wrap::after {
        position: absolute;
        inset: 10%;
        z-index: -1;
        border-radius: 999px;
        background: color-mix(in oklch, var(--sidebar-primary) 28%, transparent);
        filter: blur(1.3rem);
        opacity: 0.72;
        content: "";
      }

      .ingest-flow-system {
        width: clamp(4.7rem, 9vw, 6.2rem);
        color: var(--foreground);
        text-align: center;
      }

      .ingest-flow-system .system-core {
        display: grid;
        width: clamp(2.35rem, 4.6vw, 3.4rem);
        height: clamp(2.35rem, 4.6vw, 3.4rem);
        margin-inline: auto;
        place-items: center;
        border: 1px solid color-mix(in oklch, var(--system-tone, var(--sidebar-primary)) 45%, transparent);
        border-radius: 999px;
        background:
          radial-gradient(circle, color-mix(in oklch, var(--system-tone, var(--sidebar-primary)) 42%, transparent), transparent 56%),
          color-mix(in oklch, var(--sidebar-depth-input) 54%, transparent);
        box-shadow:
          0 0 0.9rem color-mix(in oklch, var(--system-tone, var(--sidebar-primary)) 25%, transparent),
          inset 0 0 1.2rem hsl(0 0% 100% / 0.05);
      }

      .ingest-flow-system .system-core::before {
        width: 42%;
        height: 42%;
        border: 1px solid color-mix(in oklch, var(--system-tone, var(--sidebar-primary)) 76%, white);
        border-radius: 0.25rem;
        box-shadow:
          0 0 0 0.32rem color-mix(in oklch, var(--system-tone, var(--sidebar-primary)) 10%, transparent),
          0 0 1.2rem color-mix(in oklch, var(--system-tone, var(--sidebar-primary)) 34%, transparent);
        content: "";
        transform: rotate(45deg);
      }

      .ingest-flow-system.is-vault .system-core::before {
        border-radius: 999px;
        transform: none;
      }

      .ingest-flow-hermes {
        width: clamp(3.4rem, 7vw, 4.8rem);
      }

      .ingest-flow-hermes .orb-wrap {
        width: clamp(3.1rem, 6vw, 4.35rem);
        height: clamp(3.1rem, 6vw, 4.35rem);
      }

      .ingest-flow-hermes .orb-wrap > * {
        transform: scale(0.7);
      }

      .ingest-flow-kpis {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0.2rem;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 0.35rem 0.65rem;
        color: var(--muted-foreground);
        font-size: 0.68rem;
        font-weight: 650;
        line-height: 1.1;
        pointer-events: none;
      }

      .ingest-flow-kpis span {
        white-space: nowrap;
      }

      .ingest-flow-headline {
        position: absolute;
        left: 50%;
        top: 0;
        width: min(42rem, calc(100% - 1.5rem));
        transform: translateX(-50%);
        text-align: center;
      }

      @keyframes ingest-flow-pulse {
        0%,
        100% {
          transform: scale(0.92);
          opacity: 0.58;
        }
        50% {
          transform: scale(1.18);
          opacity: 1;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ingest-agent-tip-bubble,
        .ingest-flow-edge,
        .ingest-flow-agent .orb-wrap::after {
          animation: none;
        }
      }

      @media (max-width: 680px) {
        .ingest-flow-stage {
          height: clamp(340px, calc(100dvh - 296px), 420px);
          min-height: 340px;
        }

        @supports (height: 100svh) {
          .ingest-flow-stage {
            height: clamp(340px, calc(100svh - 296px), 420px);
          }
        }

        .ingest-flow-headline {
          top: 0.1rem;
          width: calc(100% - 0.75rem);
        }

        .ingest-flow-eyebrow {
          font-size: 0.52rem;
          letter-spacing: 0.15em;
          line-height: 1.1;
        }

        .ingest-flow-title-row {
          margin-top: 0.22rem;
          gap: 0.42rem;
        }

        .ingest-flow-title {
          font-size: 0.82rem;
          line-height: 1.08;
        }

        .ingest-flow-progress {
          font-size: 0.8rem;
        }

        .ingest-flow-progressbar {
          margin-top: 0.36rem;
        }

        .ingest-flow-body {
          margin-top: 0.36rem;
          font-size: 0.62rem;
          line-height: 1.15;
          -webkit-line-clamp: 1;
        }

        .ingest-flow-agent {
          width: clamp(3.3rem, 16vw, 4.1rem);
          transform: translate(-50%, calc(-50% + 0.48rem));
        }

        .ingest-flow-agent .orb-wrap {
          width: clamp(1.65rem, 8.6vw, 2.15rem);
          height: clamp(1.65rem, 8.6vw, 2.15rem);
        }

        .ingest-flow-hermes {
          width: clamp(2.8rem, 14vw, 3.6rem);
        }

        .ingest-flow-hermes .orb-wrap {
          width: clamp(2.15rem, 10.5vw, 2.75rem);
          height: clamp(2.15rem, 10.5vw, 2.75rem);
        }

        .ingest-flow-system {
          width: clamp(3.7rem, 18vw, 4.6rem);
        }

        .ingest-flow-prestage {
          width: clamp(4rem, 19vw, 4.9rem);
          transform: translate(-50%, calc(-50% + 0.42rem));
        }

        .ingest-flow-prestage .prestage-orb-wrap {
          width: clamp(2.1rem, 10.5vw, 2.75rem);
          height: clamp(2.1rem, 10.5vw, 2.75rem);
          transform: translate(0.08rem, 0.12rem);
        }

        .ingest-flow-system .system-core {
          width: clamp(1.85rem, 9vw, 2.35rem);
          height: clamp(1.85rem, 9vw, 2.35rem);
        }

        .ingest-flow-label {
          margin-top: 0.08rem;
          font-size: 0.56rem;
        }

        .ingest-flow-sub,
        .ingest-flow-state {
          margin-top: 0.08rem;
          font-size: 0.46rem;
        }

        .ingest-flow-kpis {
          left: 0.35rem;
          right: 0.35rem;
          bottom: 0.08rem;
          gap: 0.08rem 0.45rem;
          justify-content: center;
          font-size: 0.52rem;
        }
      }
    `}</style>
  );

  if (compact) {
    return (
      <>
        <div
          className="w-full min-w-0 max-w-[18rem]"
          aria-label={`Hermes ingest progress ${progress}%`}
          onPointerOver={handleTipPointerOver}
          onPointerOut={handleTipPointerOut}
          onFocusCapture={handleTipFocus}
          onBlurCapture={() => setActiveTip(null)}
        >
          <div className="flex items-center gap-3">
            <div
              className="relative size-14 shrink-0"
              data-ingest-tip="Hermes is coordinating the private read, then pulling the findings back into the vault brain."
              tabIndex={0}
            >
              <Orb
                agentState={working ? "thinking" : "listening"}
                colors={CHAT_AGENT_ORB_COLORS}
                volumeMode="manual"
                manualInput={STABLE_INGEST_ORB_INPUT}
                manualOutput={STABLE_INGEST_ORB_OUTPUT}
                className="size-full"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-semibold text-foreground">
                  Hermes
                </p>
                <p className="shrink-0 text-xs font-semibold tabular-nums text-sidebar-primary">
                  {progress}%
                </p>
              </div>
              <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-sidebar-border/30"
                data-ingest-tip="Overall ingest progress. Hermes keeps moving forward as readers finish and merge their findings."
                tabIndex={0}
              >
                <div
                  className="h-full rounded-full bg-sidebar-primary transition-[width] duration-700 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-2">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {agents.map((reader) => (
                <div
                  key={reader.id}
                  data-ingest-tip={agentTip(reader)}
                  tabIndex={0}
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-0.5 outline-none transition-opacity focus-visible:ring-1 focus-visible:ring-sidebar-primary/60",
                    reader.state === "waiting" ? "opacity-55" : "opacity-100"
                  )}
                >
                  <span
                    className="relative size-6 shrink-0"
                    style={
                      {
                        "--agent-a": reader.colors[0],
                        "--agent-b": reader.colors[1],
                      } as CSSProperties
                    }
                  >
                    <Orb
                      agentState={reader.state === "active" ? "thinking" : "listening"}
                      colors={reader.colors}
                      seed={hashString(`compact:${reader.id}`)}
                      volumeMode="manual"
                      manualInput={STABLE_INGEST_ORB_INPUT}
                      manualOutput={STABLE_INGEST_ORB_OUTPUT}
                      className="size-full"
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[10px] font-semibold text-foreground">
                      {reader.label}
                    </span>
                    <span className="block truncate text-[9px] text-muted-foreground">
                      {reader.statusLabel}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {tipLayer}
        {flowStyles}
      </>
    );
  }

  const readerAgents = agents.filter(
    (agent) => agent.id !== "challenge" && agent.id !== "merge"
  );
  const challengeAgent = agents.find((agent) => agent.id === "challenge");
  const mergeAgent = agents.find((agent) => agent.id === "merge");
  const preStageNode: FlowNode = {
    id: "prestage",
    x: 50,
    y: 58,
    label: "Pre-stage",
    subLabel: "Evidence buffer",
    kind: "prestage",
    state: working ? "active" : status === "done" ? "done" : "waiting",
    tip: "Hermes gathers extracted text, tables, media notes, and returned reader findings in pre-stage before merge.",
  };
  const vaultNode: FlowNode = {
    id: "vault",
    x: 50,
    y: 83,
    label: "Vault",
    subLabel: status === "done" ? "Saved" : "Awaiting pack",
    kind: "vault",
    state: status === "done" ? "done" : mergeAgent?.state === "active" ? "active" : "waiting",
    tip: "The final output is written back into the vault as extracted text, retrieval routes, brain records, and notes.",
  };
  const challengeNode: FlowNode | null = challengeAgent
    ? {
        id: "challenge",
        x: 22,
        y: 61,
        label: "Challenge",
        subLabel: "Challenge",
        kind: "challenge",
        agent: challengeAgent,
        state: challengeAgent.state,
        tip: agentTip(challengeAgent),
      }
    : null;
  const mergeNode: FlowNode | null = mergeAgent
    ? {
        id: "merge",
        x: 78,
        y: 61,
        label: "Merge",
        subLabel: "Merge",
        kind: "merge",
        agent: mergeAgent,
        state: mergeAgent.state,
        tip: agentTip(mergeAgent),
      }
    : null;
  const readerNodes: FlowNode[] = readerAgents.map((agent, index) => {
    const n = Math.max(readerAgents.length, 1);
    const t = n === 1 ? 0.5 : index / (n - 1);
    return {
      id: agent.id,
      x: 16 + t * 68,
      y: 34 - Math.sin(t * Math.PI) * 7,
      label: agent.label,
      subLabel: agent.label,
      kind: "reader",
      agent,
      state: agent.state,
      tip: agentTip(agent),
    };
  });
  const allNodes = [
    ...readerNodes,
    preStageNode,
    ...(challengeNode ? [challengeNode] : []),
    ...(mergeNode ? [mergeNode] : []),
    vaultNode,
  ];
  const edges: FlowEdge[] = [
    ...readerNodes.map((node) => ({
      id: `send-${node.id}`,
      from: preStageNode,
      to: node,
      tone: "send" as const,
      active: node.state === "active",
    })),
    ...readerNodes.map((node) => ({
      id: `return-${node.id}`,
      from: node,
      to: preStageNode,
      tone: "return" as const,
      active: node.state === "active" || node.state === "done" || node.state === "error",
    })),
    ...(challengeNode
      ? [
          {
            id: "prestage-challenge",
            from: preStageNode,
            to: challengeNode,
            tone: "challenge" as const,
            active: challengeNode.state === "active" || reviewCount > 0,
          },
          ...readerNodes
            .filter(
              (node) =>
                node.state === "error" ||
                (challengeNode.state === "active" && node.state === "done")
            )
            .map((node) => ({
              id: `challenge-${node.id}`,
              from: challengeNode,
              to: node,
              tone: "challenge" as const,
              active: true,
              reverse: node.state !== "error",
            })),
        ]
      : []),
    ...(mergeNode
      ? [
          {
            id: "prestage-merge",
            from: preStageNode,
            to: mergeNode,
            tone: "merge" as const,
            active: mergeNode.state === "active" || mergeNode.state === "done",
          },
          {
            id: "merge-vault",
            from: mergeNode,
            to: vaultNode,
            tone: "vault" as const,
            active: mergeNode.state === "active" || status === "done",
          },
        ]
      : [
          {
            id: "prestage-vault",
            from: preStageNode,
            to: vaultNode,
            tone: "vault" as const,
            active: status === "running" || status === "done",
          },
        ]),
  ];

  const nodeStyle = (node: FlowNode, extra?: Record<string, string>): CSSProperties =>
    ({
      "--flow-x": `${node.x}%`,
      "--flow-y": `${node.y}%`,
      ...(extra ?? {}),
    }) as CSSProperties;

  return (
    <>
      <div
        className="w-full min-w-0 max-w-6xl px-0 py-0 sm:px-3 sm:py-1"
        aria-label={`Hermes ingest progress ${progress}%`}
        onPointerOver={handleTipPointerOver}
        onPointerOut={handleTipPointerOut}
        onFocusCapture={handleTipFocus}
        onBlurCapture={() => setActiveTip(null)}
      >
        <div className="ingest-flow-stage mx-auto w-full" data-testid="ingest-agent-flow">
          <div className="ingest-flow-headline">
            <p className="ingest-flow-eyebrow text-[10px] font-semibold uppercase leading-snug tracking-[0.18em] text-muted-foreground">
              {swarmCopy.eyebrow}
            </p>
            <div className="ingest-flow-title-row mt-1 flex items-center justify-center gap-3">
              <p className="ingest-flow-title min-w-0 text-sm font-semibold leading-snug text-foreground sm:text-base">
                {swarmCopy.title}
              </p>
              <p className="ingest-flow-progress shrink-0 text-sm font-bold tabular-nums text-sidebar-primary">
                {progress}%
              </p>
            </div>
            <div
              className="ingest-flow-progressbar mt-2 h-1 overflow-hidden rounded-full bg-sidebar-border/20"
              data-ingest-tip="Overall ingest progress. It combines the current vault phase with the readers that have actually returned."
              tabIndex={0}
            >
              <div
                className="h-full rounded-full bg-sidebar-primary transition-[width] duration-700 ease-out shadow-[0_0_18px_rgba(59,130,246,0.45)]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="ingest-flow-body mt-2 line-clamp-2 text-xs leading-snug text-muted-foreground">
              {swarmCopy.body}
            </p>
          </div>

          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <marker
                id="ingest-flow-arrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="2.2"
                markerHeight="2.2"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map((edge) => (
              <path
                key={edge.id}
                d={flowPath(edge.from, edge.to)}
                className={cn(
                  "ingest-flow-edge",
                  `tone-${edge.tone}`,
                  edge.active ? "is-active" : "",
                  edge.reverse ? "is-reverse" : ""
                )}
                markerEnd="url(#ingest-flow-arrow)"
              />
            ))}
          </svg>

          {allNodes.map((node) => {
            const agent = node.agent;
            const isSystem = node.kind === "vault";
            const isPreStage = node.kind === "prestage";
            const isHermes = node.kind === "hermes";
            const tone =
              node.kind === "vault"
                ? "#60a5fa"
                : node.kind === "prestage"
                  ? "#38d6c3"
                  : isHermes
                    ? CHAT_AGENT_ORB_COLORS[0]
                    : agent?.colors[0] ?? "var(--sidebar-primary)";
            if (isPreStage) {
              return (
                <div
                  key={node.id}
                  className={cn(
                    "ingest-flow-node ingest-flow-prestage",
                    flowStateClass(node.state)
                  )}
                  style={nodeStyle(node, {
                    "--agent-a": CHAT_AGENT_ORB_COLORS[0],
                    "--agent-b": CHAT_AGENT_ORB_COLORS[1],
                  })}
                  data-ingest-tip={node.tip}
                  tabIndex={0}
                >
                  <span className="prestage-orb-wrap" aria-hidden>
                    <Orb
                      agentState={node.state === "active" ? "thinking" : "listening"}
                      colors={CHAT_AGENT_ORB_COLORS}
                      seed={hashString("flow:prestage-hermes")}
                      volumeMode="manual"
                      manualInput={STABLE_INGEST_ORB_INPUT}
                      manualOutput={STABLE_INGEST_ORB_OUTPUT}
                      className="size-full"
                    />
                  </span>
                  <span className="ingest-flow-label">{node.label}</span>
                  <span className="ingest-flow-sub">{node.subLabel}</span>
                </div>
              );
            }
            if (isSystem) {
              return (
                <div
                  key={node.id}
                  className={cn(
                    "ingest-flow-node ingest-flow-system",
                    node.kind === "vault" ? "is-vault" : "",
                    flowStateClass(node.state)
                  )}
                  style={nodeStyle(node, { "--system-tone": tone })}
                  data-ingest-tip={node.tip}
                  tabIndex={0}
                >
                  <span className="system-core" aria-hidden />
                  <span className="ingest-flow-label">{node.label}</span>
                  <span className="ingest-flow-sub">{node.subLabel}</span>
                </div>
              );
            }
            return (
              <button
                key={node.id}
                type="button"
                className={cn(
                  "ingest-flow-node ingest-flow-agent",
                  node.kind === "hermes" ? "ingest-flow-hermes" : "",
                  node.kind === "challenge" ? "is-challenge" : "",
                  node.kind === "merge" ? "is-merge" : "",
                  flowStateClass(node.state)
                )}
                style={nodeStyle(node, {
                  "--agent-a": tone,
                  "--agent-b": agent?.colors[1] ?? "#dbeafe",
                })}
                data-ingest-tip={node.tip}
              >
                <span className="orb-wrap">
                  <Orb
                    agentState={node.state === "active" ? "thinking" : "listening"}
                    colors={isHermes ? CHAT_AGENT_ORB_COLORS : (agent?.colors ?? ["#60a5fa", "#dbeafe"])}
                    seed={hashString(`flow:${node.id}`)}
                    volumeMode="manual"
                    manualInput={STABLE_INGEST_ORB_INPUT}
                    manualOutput={STABLE_INGEST_ORB_OUTPUT}
                    className="size-full"
                  />
                </span>
                {!isHermes ? (
                  <>
                    <span className="ingest-flow-label">{node.label}</span>
                    <span className="ingest-flow-state">
                      {agent?.statusLabel ?? (status === "done" ? "Saved" : "Idle")}
                    </span>
                  </>
                ) : null}
              </button>
            );
          })}

          <div className="ingest-flow-kpis">
            <span>{returnedCount} returned</span>
            <span>{workingCount} working</span>
            <span>{reviewCount} needs review</span>
          </div>
        </div>
      </div>
      {tipLayer}
      {flowStyles}
    </>
  );
}
