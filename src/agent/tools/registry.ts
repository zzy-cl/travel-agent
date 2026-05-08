import { tool, type StructuredTool } from "@langchain/core/tools";
import { type ZodSchema } from "zod";
import type { ToolInput } from "../../lib/types";

/** Definition of a tool registered in the tool registry. */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: ZodSchema;
  execute: (input: ToolInput) => Promise<string>;
}

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  toLangChainTools(): StructuredTool[] {
    return this.getAll().map((t) =>
      tool(async (input: ToolInput) => t.execute(input), {
        name: t.name,
        description: t.description,
        schema: t.schema,
      }),
    );
  }
}

export const toolRegistry = new ToolRegistry();
