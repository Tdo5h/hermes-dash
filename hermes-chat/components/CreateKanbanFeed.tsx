"use client";

import type { CSSProperties } from "react";
import { Orb } from "@/components/ui/orb";
import { CHAT_AGENT_ORB_COLORS } from "@/lib/architect-orb-presets";
import { cn } from "@/lib/utils";
import type { CreateKanbanTask } from "@/lib/hermes-kanban";

type CreateKanbanFeedProps = {
  boardSlug: string;
  tasks: CreateKanbanTask[];
  loading?: boolean;
  cleanedAt?: string | null;
};

type AgentState = "waiting" | "active" | "done" | "error";
type TaskKind = "plan" | "route" | "context" | "build" | "qa" | "other";

type FlowPoint = {
  x: number;
  y: number;
};

type CreateAgent = FlowPoint & {
  id: string;
  kind: TaskKind;
  task: CreateKanbanTask;
  label: string;
  subLabel: string;
  activeVerb: string;
  colors: [string, string];
  state: AgentState;
  statusLabel: string;
  line: string;
};

const STATUS_LABEL: Record<string, string> = {
  triage: "Planned",
  todo: "Queued",
  ready: "Ready",
  running: "Working",
  blocked: "Needs review",
  done: "Returned",
  archived: "Archived",
};

const PERSONAS: Record<TaskKind, Omit<CreateAgent, "id" | "task" | "state" | "statusLabel" | "line">> = {
  plan: {
    kind: "plan",
    label: "Planner",
    subLabel: "Orchestration",
    activeVerb: "shaping the run plan",
    colors: ["#38bdf8", "#93c5fd"],
    x: 15,
    y: 35,
  },
  route: {
    kind: "route",
    label: "Router",
    subLabel: "Route + DNA",
    activeVerb: "matching the route and DNA",
    colors: ["#14b8a6", "#99f6e4"],
    x: 38,
    y: 25,
  },
  context: {
    kind: "context",
    label: "Context",
    subLabel: "Vault + assets",
    activeVerb: "reading selected context",
    colors: ["#8b5cf6", "#c4b5fd"],
    x: 62,
    y: 25,
  },
  qa: {
    kind: "qa",
    label: "QA",
    subLabel: "Checks + links",
    activeVerb: "preparing the checks",
    colors: ["#ec4899", "#f9a8d4"],
    x: 85,
    y: 35,
  },
  build: {
    kind: "build",
    label: "Builder",
    subLabel: "Main lane",
    activeVerb: "building the artifact",
    colors: ["#f59e0b", "#fde68a"],
    x: 50,
    y: 82,
  },
  other: {
    kind: "other",
    label: "Agent",
    subLabel: "Specialist",
    activeVerb: "working on the card",
    colors: ["#60a5fa", "#dbeafe"],
    x: 50,
    y: 34,
  },
};

const CORE_NODE: FlowPoint = { x: 50, y: 56 };
const STABLE_ORB_INPUT = 0.58;
const STABLE_ORB_OUTPUT = 0.58;

function hashString(raw: string): number {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function taskKind(task: CreateKanbanTask): TaskKind {
  const title = task.title.toLowerCase();
  if (title.includes("orchestration") || title.includes("plan")) return "plan";
  if (title.includes("route") || title.includes("dna")) return "route";
  if (title.includes("vault") || title.includes("asset") || title.includes("context")) return "context";
  if (title.includes("build") || title.includes("artifact")) return "build";
  if (title.includes("qa") || title.includes("polish") || title.includes("publish")) return "qa";
  return "other";
}

function taskState(task: CreateKanbanTask, loading?: boolean): AgentState {
  if (task.status === "blocked") return "error";
  if (task.status === "done" || task.status === "archived") return "done";
  if (task.status === "running") return "active";
  if (loading && taskKind(task) === "build") return "active";
  return "waiting";
}

function progressFor(task: CreateKanbanTask, loading?: boolean): number {
  if (task.status === "done" || task.status === "archived") return 100;
  if (task.status === "blocked") return 58;
  if (task.status === "running") return 68;
  if (loading && taskKind(task) === "build") return 52;
  if (task.status === "ready") return 28;
  if (task.status === "todo") return 18;
  return 8;
}

function cleanLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function agentLine(task: CreateKanbanTask, persona: typeof PERSONAS[TaskKind], loading?: boolean): string {
  const summary = cleanLine(task.latest_summary || task.result || task.last_failure_error);
  if (summary) return summary;
  if (task.status === "blocked") return "Needs a look before this lane can continue.";
  if (task.status === "done" || task.status === "archived") return `${persona.label} has returned useful notes.`;
  if (task.status === "running") return `${persona.label} is ${persona.activeVerb}.`;
  if (loading && persona.kind === "build") return "Main Hermes is turning the plan into the user-facing artifact.";
  if (task.status === "ready" || task.status === "todo") return `${persona.label} is queued.`;
  if (persona.kind === "build") return "Main Hermes owns the final artifact lane.";
  return cleanLine(task.body) || `${persona.label} is waiting for the run to reach this lane.`;
}

function makeAgent(task: CreateKanbanTask, index: number, loading?: boolean): CreateAgent {
  const kind = taskKind(task);
  const persona = PERSONAS[kind] ?? PERSONAS.other;
  const fallbackOffset = kind === "other" ? (index - 2) * 12 : 0;
  return {
    ...persona,
    id: task.id,
    task,
    state: taskState(task, loading),
    statusLabel: loading && kind === "build" && task.status !== "done"
      ? "Building"
      : STATUS_LABEL[task.status] || task.status,
    line: agentLine(task, persona, loading),
    x: Math.min(88, Math.max(12, persona.x + fallbackOffset)),
  };
}

function flowPath(from: FlowPoint, to: FlowPoint): string {
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

function stateClass(state: AgentState): string {
  if (state === "active") return "is-active";
  if (state === "done") return "is-done";
  if (state === "error") return "is-error";
  return "is-waiting";
}

export function CreateKanbanFeed({
  boardSlug,
  tasks,
  loading,
  cleanedAt,
}: CreateKanbanFeedProps) {
  if (!boardSlug || (!loading && tasks.length === 0)) return null;

  const cleanedUp = Boolean(cleanedAt);
  const agents = tasks.slice(0, 8).map((task, index) => makeAgent(task, index, loading));
  const workerAgents = agents.filter((agent) => agent.kind !== "build");
  const visibleAgents = workerAgents;
  const buildAgent = agents.find((agent) => agent.kind === "build");
  const activeWorkers = workerAgents.filter((agent) => agent.state === "active").length;
  const returned = workerAgents.filter((agent) => agent.state === "done").length;
  const review = workerAgents.filter((agent) => agent.state === "error").length;
  const workerTerminal =
    workerAgents.length > 0 &&
    workerAgents.every((agent) => agent.state === "done" || agent.state === "error");
  const finished =
    cleanedUp ||
    (!loading && workerAgents.length > 0 && workerAgents.every((agent) => agent.state === "done"));
  const progressAgents = loading ? [...workerAgents, ...(buildAgent ? [buildAgent] : [])] : workerAgents;
  const progress = finished
    ? 100
    : progressAgents.length
    ? Math.round(
        progressAgents.reduce((sum, agent) => sum + progressFor(agent.task, loading), 0) /
          progressAgents.length
      )
    : loading
      ? 12
      : 0;
  const headline =
    cleanedUp
      ? `${returned} returned · board cleaned`
      : finished
      ? `${returned} returned · complete`
      : review > 0 && workerTerminal
        ? `${review} needs review`
        : activeWorkers > 0
      ? `${activeWorkers} specialist${activeWorkers === 1 ? "" : "s"} working`
      : returned > 0
        ? `${returned} returned`
        : "Board warming up";
  const body =
    cleanedUp
      ? "Temporary Kanban was snapshotted and removed. These are the final specialist handoffs kept with the chat."
      : finished
      ? "Specialists returned their notes. The live flow is complete."
      : review > 0 && workerTerminal
        ? "One or more specialist lanes need review before this board is clean."
        : activeWorkers > 0
      ? "Specialists are feeding route, context, and QA notes back into the build lane."
      : returned > 0
        ? "Returned notes are waiting for Hermes to fold them into the artifact."
        : "Hermes is preparing the Create board.";
  const boardLabel = boardSlug.length > 28 ? `${boardSlug.slice(0, 25)}...` : boardSlug;
  const buildNode = buildAgent
    ? buildAgent
    : ({
        ...PERSONAS.build,
        id: "build-placeholder",
        task: {
          id: "build-placeholder",
          title: "Build primary artifact",
          status: loading ? "running" : "triage",
        },
        state: loading ? "active" : "waiting",
        statusLabel: loading ? "Building" : "Planned",
        line: loading
          ? "Main Hermes is turning the plan into the user-facing artifact."
          : "Main Hermes owns the final artifact lane.",
      } satisfies CreateAgent);
  const showLiveFlow = !finished;
  const readoutAgents = (finished ? workerAgents : [...visibleAgents, buildNode])
    .filter((agent) => finished ? agent.kind !== "build" : true)
    .slice(0, 6);

  return (
    <section className="mx-auto mb-5 w-full max-w-5xl px-3 sm:px-0">
      <div className="create-flow-panel">
        <div className="create-flow-head">
          <div className="min-w-0">
            <p className="create-flow-eyebrow">Create agents</p>
            <div className="create-flow-title-row">
              <p className="create-flow-title">{headline}</p>
              <p className="create-flow-progress">{progress}%</p>
            </div>
            <div className="create-flow-progressbar" aria-label={`Create progress ${progress}%`}>
              <span style={{ width: `${progress}%` }} />
            </div>
            <p className="create-flow-body">{body}</p>
          </div>
          <p className="create-flow-board">{boardLabel}</p>
        </div>

        {showLiveFlow ? (
          <div className="create-flow-stage" data-testid="create-kanban-flow">
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
            >
              {visibleAgents.map((agent) => (
                <path
                  key={`to-core-${agent.id}`}
                  d={flowPath(agent, CORE_NODE)}
                  className={cn(
                    "create-flow-edge",
                    agent.state === "active" || agent.state === "done" || agent.state === "error" ? "is-active" : "",
                    agent.state === "error" ? "is-error" : ""
                  )}
                />
              ))}
              <path
                d={flowPath(CORE_NODE, buildNode)}
                className={cn(
                  "create-flow-edge tone-build",
                  buildNode.state === "active" || buildNode.state === "done" || activeWorkers > 0 ? "is-active" : ""
                )}
              />
            </svg>

            <div
              className={cn(
                "create-flow-node create-flow-core",
                activeWorkers > 0 || returned > 0 ? "is-active" : "is-waiting"
              )}
              style={{ "--flow-x": `${CORE_NODE.x}%`, "--flow-y": `${CORE_NODE.y}%` } as CSSProperties}
            >
              <span className="create-flow-core-orb" aria-hidden>
                <Orb
                  agentState={activeWorkers > 0 || loading ? "thinking" : "listening"}
                  colors={CHAT_AGENT_ORB_COLORS}
                  seed={hashString(`create-core:${boardSlug}`)}
                  volumeMode="manual"
                  manualInput={STABLE_ORB_INPUT}
                  manualOutput={STABLE_ORB_OUTPUT}
                  className="size-full"
                />
              </span>
              <span className="create-flow-label">Brief core</span>
              <span className="create-flow-sub">Plan buffer</span>
            </div>

            {[...visibleAgents, buildNode].map((agent) => (
              <div
                key={agent.id}
                className={cn(
                  "create-flow-node create-flow-agent",
                  agent.kind === "build" ? "is-build" : "",
                  stateClass(agent.state)
                )}
                style={
                  {
                    "--flow-x": `${agent.x}%`,
                    "--flow-y": `${agent.y}%`,
                    "--agent-a": agent.colors[0],
                    "--agent-b": agent.colors[1],
                  } as CSSProperties
                }
                title={agent.line}
              >
                <span className="create-flow-orb" aria-hidden>
                  <Orb
                    agentState={agent.state === "active" ? "thinking" : "listening"}
                    colors={agent.colors}
                    seed={hashString(`create-agent:${agent.kind}:${agent.id}`)}
                    volumeMode="manual"
                    manualInput={STABLE_ORB_INPUT}
                    manualOutput={STABLE_ORB_OUTPUT}
                    className="size-full"
                  />
                </span>
                <span className="create-flow-label">{agent.label}</span>
                <span className="create-flow-sub">{agent.subLabel}</span>
                <span className="create-flow-state">{agent.statusLabel}</span>
              </div>
            ))}

            <div className="create-flow-kpis">
              <span>{returned} returned</span>
              <span>{activeWorkers} working</span>
              <span>{review} needs review</span>
            </div>
          </div>
        ) : null}

        <div className={cn("create-flow-readouts", !showLiveFlow ? "is-complete" : "")}>
          {readoutAgents.map((agent) => (
            <div key={`readout-${agent.id}`} className={cn("create-flow-readout", stateClass(agent.state))}>
              <span style={{ background: agent.colors[0] }} />
              <p>
                <strong>{agent.label}</strong>
                {agent.line}
              </p>
            </div>
          ))}
          {agents.length === 0 ? (
            <div className="create-flow-readout is-waiting">
              <span />
              <p>
                <strong>Hermes</strong>
                Waiting for the Create board.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <style jsx>{`
        .create-flow-panel {
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 52%, transparent);
          border-radius: var(--radius);
          background:
            radial-gradient(circle at 50% 26%, color-mix(in oklch, var(--sidebar-primary) 8%, transparent), transparent 42%),
            color-mix(in oklch, var(--background) 82%, black);
          padding: 0.85rem;
          box-shadow: 0 18px 55px rgb(0 0 0 / 0.18);
        }

        .create-flow-head {
          display: flex;
          min-width: 0;
          align-items: flex-start;
          justify-content: space-between;
          gap: 0.85rem;
        }

        .create-flow-eyebrow {
          margin: 0;
          color: var(--muted-foreground);
          font-size: 0.67rem;
          font-weight: 750;
          line-height: 1;
          text-transform: uppercase;
        }

        .create-flow-title-row {
          display: flex;
          align-items: baseline;
          gap: 0.45rem;
          margin-top: 0.18rem;
        }

        .create-flow-title {
          margin: 0;
          color: var(--foreground);
          font-size: 0.95rem;
          font-weight: 750;
          line-height: 1.15;
        }

        .create-flow-progress {
          margin: 0;
          color: var(--sidebar-primary);
          font-size: 0.78rem;
          font-weight: 800;
          line-height: 1;
          font-variant-numeric: tabular-nums;
        }

        .create-flow-progressbar {
          width: min(22rem, 100%);
          height: 0.22rem;
          margin-top: 0.48rem;
          overflow: hidden;
          border-radius: 999px;
          background: color-mix(in oklch, var(--sidebar-border) 32%, transparent);
        }

        .create-flow-progressbar span {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: var(--sidebar-primary);
          box-shadow: 0 0 16px color-mix(in oklch, var(--sidebar-primary) 58%, transparent);
          transition: width 650ms ease;
        }

        .create-flow-body {
          max-width: 34rem;
          margin: 0.45rem 0 0;
          color: var(--muted-foreground);
          font-size: 0.72rem;
          line-height: 1.35;
        }

        .create-flow-board {
          max-width: 16rem;
          margin: 0;
          overflow: hidden;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 56%, transparent);
          border-radius: var(--radius);
          padding: 0.34rem 0.48rem;
          color: var(--muted-foreground);
          font-size: 0.66rem;
          font-weight: 650;
          line-height: 1;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-flow-stage {
          position: relative;
          min-height: clamp(17rem, 32vw, 21rem);
          margin-top: 0.7rem;
          overflow: visible;
          isolation: isolate;
        }

        .create-flow-stage::before {
          position: absolute;
          inset: 0;
          z-index: -2;
          pointer-events: none;
          background-image: linear-gradient(115deg, hsl(0 0% 100% / 0.018) 0 1px, transparent 1px 10px);
          mask-image: radial-gradient(ellipse at 50% 55%, black 0%, transparent 72%);
          opacity: 0.18;
          content: "";
        }

        .create-flow-edge {
          fill: none;
          stroke: color-mix(in oklch, var(--sidebar-primary) 26%, var(--muted-foreground));
          stroke-width: 0.18;
          stroke-linecap: round;
          stroke-dasharray: 0.9 6.2;
          opacity: 0.16;
        }

        .create-flow-edge.is-active {
          stroke-width: 0.28;
          opacity: 0.46;
          animation: create-flow-dash 8s linear infinite;
        }

        .create-flow-edge.is-error {
          stroke: #fb7185;
        }

        .create-flow-edge.tone-build {
          stroke: #fbbf24;
        }

        @keyframes create-flow-dash {
          to {
            stroke-dashoffset: -36;
          }
        }

        .create-flow-node {
          position: absolute;
          left: var(--flow-x);
          top: var(--flow-y);
          transform: translate(-50%, -50%);
          text-align: center;
        }

        .create-flow-agent {
          width: clamp(4.4rem, 8.5vw, 5.6rem);
          color: var(--foreground);
        }

        .create-flow-orb,
        .create-flow-core-orb {
          position: relative;
          display: block;
          width: clamp(2.25rem, 4.2vw, 3rem);
          height: clamp(2.25rem, 4.2vw, 3rem);
          margin-inline: auto;
        }

        .create-flow-core-orb {
          width: clamp(2.55rem, 4.8vw, 3.35rem);
          height: clamp(2.55rem, 4.8vw, 3.35rem);
        }

        .create-flow-orb::after,
        .create-flow-core-orb::after {
          position: absolute;
          inset: 10%;
          z-index: -1;
          border-radius: 999px;
          background: color-mix(in oklch, var(--agent-a, var(--sidebar-primary)) 26%, transparent);
          filter: blur(1.05rem);
          opacity: 0;
          content: "";
        }

        .create-flow-node.is-active .create-flow-orb::after,
        .create-flow-node.is-active .create-flow-core-orb::after {
          opacity: 0.95;
          animation: create-flow-pulse 1.55s ease-in-out infinite;
        }

        .create-flow-node.is-done {
          opacity: 0.86;
        }

        .create-flow-node.is-waiting {
          opacity: 0.56;
        }

        .create-flow-node.is-error .create-flow-orb {
          filter: drop-shadow(0 0 0.75rem rgb(244 63 94 / 0.65));
        }

        .create-flow-label,
        .create-flow-sub,
        .create-flow-state {
          display: block;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .create-flow-label {
          margin-top: 0.2rem;
          color: var(--foreground);
          font-size: 0.74rem;
          font-weight: 780;
          line-height: 1.1;
        }

        .create-flow-sub {
          margin-top: 0.08rem;
          color: var(--sidebar-primary);
          font-size: 0.62rem;
          font-weight: 680;
          line-height: 1.1;
        }

        .create-flow-state {
          margin-top: 0.12rem;
          color: var(--muted-foreground);
          font-size: 0.6rem;
          font-weight: 700;
          line-height: 1.1;
        }

        .create-flow-kpis {
          position: absolute;
          right: 0.25rem;
          bottom: 0.2rem;
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 0.38rem;
          color: var(--muted-foreground);
          font-size: 0.64rem;
          font-weight: 700;
          line-height: 1;
        }

        .create-flow-kpis span {
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 42%, transparent);
          border-radius: 999px;
          background: color-mix(in oklch, var(--sidebar-depth-input) 32%, transparent);
          padding: 0.28rem 0.44rem;
        }

        .create-flow-readouts {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.42rem;
          margin-top: 0.35rem;
        }

        .create-flow-readouts.is-complete {
          margin-top: 0.75rem;
        }

        .create-flow-readout {
          display: flex;
          min-width: 0;
          align-items: flex-start;
          gap: 0.44rem;
          border: 1px solid color-mix(in oklch, var(--sidebar-border) 36%, transparent);
          border-radius: var(--radius);
          background: color-mix(in oklch, var(--sidebar-depth-input) 26%, transparent);
          padding: 0.48rem 0.55rem;
        }

        .create-flow-readout > span {
          width: 0.45rem;
          height: 0.45rem;
          flex: 0 0 auto;
          margin-top: 0.18rem;
          border-radius: 999px;
          background: var(--sidebar-primary);
          box-shadow: 0 0 12px currentColor;
        }

        .create-flow-readout p {
          min-width: 0;
          margin: 0;
          color: var(--muted-foreground);
          font-size: 0.7rem;
          line-height: 1.3;
        }

        .create-flow-readout strong {
          display: inline;
          margin-right: 0.35rem;
          color: var(--foreground);
          font-weight: 760;
        }

        @keyframes create-flow-pulse {
          0%,
          100% {
            transform: scale(0.92);
            opacity: 0.55;
          }
          50% {
            transform: scale(1.2);
            opacity: 1;
          }
        }

        @media (max-width: 640px) {
          .create-flow-panel {
            padding: 0.68rem;
          }

          .create-flow-head {
            gap: 0.55rem;
          }

          .create-flow-board {
            display: none;
          }

          .create-flow-title {
            font-size: 0.86rem;
          }

          .create-flow-body {
            font-size: 0.68rem;
          }

          .create-flow-stage {
            min-height: 18.5rem;
            margin-top: 0.45rem;
          }

          .create-flow-agent {
            width: 4.25rem;
          }

          .create-flow-orb {
            width: 2.05rem;
            height: 2.05rem;
          }

          .create-flow-core-orb {
            width: 2.35rem;
            height: 2.35rem;
          }

          .create-flow-label {
            font-size: 0.66rem;
          }

          .create-flow-sub,
          .create-flow-state {
            font-size: 0.56rem;
          }

          .create-flow-kpis {
            left: 0;
            right: 0;
            justify-content: center;
            font-size: 0.58rem;
          }

          .create-flow-readouts {
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .create-flow-edge.is-active,
          .create-flow-node.is-active .create-flow-orb::after,
          .create-flow-node.is-active .create-flow-core-orb::after {
            animation: none;
          }
        }
      `}</style>
    </section>
  );
}
