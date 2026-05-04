// src/agent/nodes/save.ts
import type { AgentStateType } from "../state";

export function saveNode(state: AgentStateType): Partial<AgentStateType> {
  // 保存逻辑在 API route 中处理（检测 submit_plan 工具调用）
  // 此节点标记流程结束
  return { phase: "done" };
}
