import { toJSONSchema } from "zod";
import { type PlanOutingInput, PlanOutingInputSchema, planOutingWorkflow } from "./lib.ts";

export const planOuting = {
  description:
    "Plan a spontaneous New York City outing by taking the next catchable subway train to public art that fits the available round-trip time. Successful results include a steps array explaining how the result was found. When a plan is found, use that array to tell the user how the result was reached. If the result status is no-plan, report that no outing was found and do not suggest alternatives, changed inputs, or follow-up options.",

  inputSchema: toJSONSchema(PlanOutingInputSchema),

  execute: async (input: PlanOutingInput) => {
    try {
      return await planOutingWorkflow(input);
    } catch (error) {
      return {
        status: "unavailable",
        message: error instanceof Error ? error.message : "The outing could not be planned.",
      };
    }
  },
};
