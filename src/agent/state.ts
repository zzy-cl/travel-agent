// src/agent/state.ts
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { CollectedInfo } from "../schemas/collected-info";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  collectedInfo: Annotation<CollectedInfo>({
    reducer: (_, newVal) => newVal,
    default: () => ({ preferences: [], constraints: [] }),
  }),
  phase: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "info_gathering",
  }),
  interruptMessage: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
});

export type AgentStateType = typeof AgentState.State;
