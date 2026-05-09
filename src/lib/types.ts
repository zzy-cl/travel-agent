// src/lib/types.ts
// 共享类型定义

/**
 * 工具执行函数的输入类型。
 *
 * ToolInput: 所有工具的 execute 函数接收的统一参数类型。
 * LLM 输出的 tool_calls 中的 args 就是这个类型 —— 一个任意键值对对象。
 * 例如 LLM 调用 get_weather 时，args = { location: "北京", days: 3 }
 */
export type ToolInput = Record<string, unknown>;
