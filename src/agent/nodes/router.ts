// src/agent/nodes/router.ts
import type { AgentStateType } from "../state";

export function router(state: AgentStateType): string {
  return state.phase;
}
