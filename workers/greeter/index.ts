import { z, toJSONSchema } from "zod";

const ToolInput = z.object({
  name: z.string().describe("The name of the person to greet"),
});

type ToolInput = z.infer<typeof ToolInput>;

export const sayHello = {
  description: "Greet the user with a personalized message",

  inputSchema: toJSONSchema(ToolInput),

  execute: async (input: ToolInput) => {
    return {
      greeting: `Hello, ${input.name}!`,
    };
  },
};
