import { EventEmitter } from "node:events";

/**
 * Live events for the UI (chat messages, task status, agent activity for the office view).
 * Sent to the browser over Server-Sent Events; nothing here may contain a secret.
 */
export type LiveEvent =
  | { type: "message"; chatId: number; message: unknown }
  | { type: "task"; chatId: number; task: unknown }
  | { type: "agent"; agentId: number; state: AgentState; detail?: string; taskId?: number; chatId?: number }
  | { type: "log"; taskId: number; line: string }
  | { type: "step"; taskId?: number; runId: number; entry: unknown }
  | { type: "approval"; approval: unknown }
  | { type: "scrum"; projectId: number };

export type AgentState = "idle" | "thinking" | "reading" | "typing" | "running" | "reviewing" | "waiting" | "error";

class Bus extends EventEmitter {
  private agentStates = new Map<number, { state: AgentState; detail?: string; taskId?: number; chatId?: number; at: number }>();

  publish(event: LiveEvent) {
    if (event.type === "agent") {
      this.agentStates.set(event.agentId, {
        state: event.state, detail: event.detail, taskId: event.taskId, chatId: event.chatId, at: Date.now(),
      });
    }
    this.emit("event", event);
  }

  /** Current activity of every agent, so a freshly opened office view is right away. */
  snapshot() {
    return [...this.agentStates.entries()].map(([agentId, s]) => ({ agentId, ...s }));
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
