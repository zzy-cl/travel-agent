// src/agent/nodes/router.ts
import type { AgentStateType } from "../state";

export function router(_state: AgentStateType): Partial<AgentStateType> {
  // Routing logic is handled by conditional edges in graph.ts.
  // This node acts as a routing checkpoint — it reads state.phase
  // via the conditional edge function attached to "router".
  return {};
}
