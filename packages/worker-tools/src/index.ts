import { toJSONSchema, z } from "zod";

export function createTool<TInput>(options: {
  description: string;
  input: z.ZodType<TInput>;
  execute: (args: { input: TInput }) => Promise<unknown>;
}) {
  return {
    type: "tool" as const,
    description: options.description,
    inputSchema: toJSONSchema(options.input),
    execute: options.execute,
  };
}
