import { z } from "zod";
import { createTool } from "@vercel-ship-2026-workers/worker-tools";

export const sayHello = createTool({
  description: "Greet the user with a personalized message",

  input: z.object({
    name: z.string().describe("The name of the person to greet"),
  }),

  execute: async ({ input: { name } }) => {
    return {
      greeting: `Hello, ${name}!`,
    };
  },
});
