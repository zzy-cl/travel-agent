import { tool, type StructuredTool } from "@langchain/core/tools";
import { type ZodSchema } from "zod";
import { cache } from "../../lib/cache";

export interface MCPTool {
  name: string;
  description: string;
  schema: ZodSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- input type varies per tool schema
  execute: (input: any) => Promise<string>;
  cacheTTL?: number; // seconds, 0 = no cache
}

class ToolRegistry {
  private tools = new Map<string, MCPTool>();

  register(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  getAll(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  toLangChainTools(): StructuredTool[] {
    return this.getAll().map((t) =>
      tool(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LangChain tool input
        async (input: any) => {
          return this.executeWithCache(t, input);
        },
        {
          name: t.name,
          description: t.description,
          schema: t.schema,
        },
      ),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- input type varies per tool schema
  private async executeWithCache(t: MCPTool, input: any): Promise<string> {
    if (!t.cacheTTL || t.cacheTTL <= 0) {
      return t.execute(input);
    }

    const cacheKey = `${t.name}:${JSON.stringify(input)}`;
    const cached = cache.get<string>(cacheKey);
    if (cached) return cached;

    const result = await t.execute(input);
    cache.set(cacheKey, result, t.cacheTTL);
    return result;
  }
}

export const toolRegistry = new ToolRegistry();
