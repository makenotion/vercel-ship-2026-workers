import { z } from "zod";

export const ToolRow = z.object({
  workerName: z.string(),
  name: z.string(),
  description: z.string(),
  inputSchema: z.transform<string, Record<string, unknown>>((f) =>
    z.record(z.string(), z.unknown()).parse(JSON.parse(f)),
  ),
});

export type ToolRow = z.infer<typeof ToolRow>;

export const ModuleDefinition = z.record(
  z.string(),
  z.object({
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
  }),
);

export type ModuleDefinition = z.infer<typeof ModuleDefinition>;
