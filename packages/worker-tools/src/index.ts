import { toJSONSchema, z } from "zod";

export function createTool<TInput>(options: {
  description: string;
  input: z.ZodType<TInput>;
  execute: (args: { input: TInput }) => Promise<unknown>;
}) {
  return {
    description: options.description,
    inputSchema: toJSONSchema(options.input),
    execute: options.execute,
  };
}
