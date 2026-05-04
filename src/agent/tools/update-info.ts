import { tool } from "@langchain/core/tools";
import { collectedInfoSchema } from "../../schemas/collected-info";

export const updateCollectedInfo = tool(
  async (info) => {
    return JSON.stringify(info);
  },
  {
    name: "update_collected_info",
    description:
      "从用户的回复中提取旅行相关信息并更新。每次用户回答了问题都应该调用此工具来记录提取到的信息。只传有新信息的字段。",
    schema: collectedInfoSchema.partial(),
  },
);
