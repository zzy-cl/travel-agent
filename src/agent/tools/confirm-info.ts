import { z } from "zod";
import { tool } from "@langchain/core/tools";

export const confirmInfo = tool(
  async () => {
    return "信息已确认，可以开始生成旅行计划了。";
  },
  {
    name: "confirm_info",
    description:
      "当收集到足够的旅行信息后调用此工具，表示信息收集完毕，可以进入计划生成阶段。只在所有关键信息都收集齐全后才调用。",
    schema: z.object({}),
  },
);
