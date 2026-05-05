// src/agent/state.ts
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import type { CollectedInfo } from "../schemas/collected-info";

export type Phase =
  | "info_gathering"
  | "planning"
  | "refinement"
  | "confirming"
  | "exporting"
  | "done";

export type TripStatus = "planning" | "ongoing" | "completed";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  collectedInfo: Annotation<CollectedInfo>({
    reducer: (_, newVal) => newVal,
    default: () => ({ preferences: [], constraints: [] }),
  }),
  phase: Annotation<Phase>({
    reducer: (_, newVal) => newVal,
    default: () => "info_gathering",
  }),
  interruptMessage: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  planMarkdown: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  tripStatus: Annotation<TripStatus>({
    reducer: (_, newVal) => newVal,
    default: () => "planning",
  }),
  sessionId: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
  userId: Annotation<string>({
    reducer: (_, newVal) => newVal,
    default: () => "",
  }),
});

export type AgentStateType = typeof AgentState.State;
