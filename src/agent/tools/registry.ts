// src/agent/tools/registry.ts
// 工具注册中心
//
// ── 为什么需要 ToolRegistry？──
// 项目中有 8 个工具（天气、搜索、地图等），它们需要:
// 1. 统一管理（注册、查找、导出）
// 2. 转换为 LangChain 可调用的 StructuredTool 格式
//
// ToolRegistry 就是这个"中间层":
// - 工具作者定义 { name, description, schema, execute } → 注册到 registry
// - 节点代码通过 registry.toLangChainTools() 获取 LangChain 兼容的工具数组
//
// ── StructuredTool 简介 ──
// StructuredTool 是 LangChain 的工具抽象，包含:
// - name: 工具名称（LLM 通过这个名字调用）
// - description: 工具描述（LLM 根据描述决定何时调用）
// - schema: Zod schema（定义参数类型，LangChain 自动校验）
// - execute: 执行函数
//
// ── Zod schema 的作用 ──
// 1. 告诉 LLM 工具接受什么参数（会被注入到 system prompt）
// 2. LLM 返回 tool_calls 时，自动校验参数是否合法
// 3. 推导 TypeScript 类型（类型安全）

import { tool, type StructuredTool } from "@langchain/core/tools";
import { type ZodSchema } from "zod";
import type { ToolInput } from "../../lib/types";

/** 工具定义接口: 工具作者需要实现这 4 个字段 */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: ZodSchema;
  execute: (input: ToolInput) => Promise<string>;
}

/**
 * 工具注册中心。
 *
 * 内部用 Map 存储所有注册的工具。
 * 提供 toLangChainTools() 方法将所有工具转为 LangChain StructuredTool 数组。
 */
class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  /** 注册一个工具 */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  /** 按名称查找工具 */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** 获取所有已注册的工具 */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 将所有工具转为 LangChain StructuredTool 数组。
   *
   * 这是 registry 的核心方法。节点代码通过这个方法获取
   * 可以直接传给 model.bindTools() 的工具数组。
   *
   * 内部使用 LangChain 的 tool() 工厂函数:
   * tool(executeFn, { name, description, schema }) → StructuredTool
   */
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

/** 全局工具注册中心单例 */
export const toolRegistry = new ToolRegistry();
