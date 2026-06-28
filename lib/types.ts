import { z } from "zod";

const definition = z.transform<string, z.TypeOf<typeof ToolDefinition>>((f) =>
  ToolDefinition.parse(JSON.parse(f)),
);

export const CapabilityRecord = z.object({
  worker: z.string(),
  key: z.string(),
  type: z.literal("tool"),
  definition: z.string().pipe(definition),
});

export type CapabilityRecord = z.infer<typeof CapabilityRecord>;

export const ToolDefinition = z.object({
  type: z.literal("tool"),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
});

export type ToolDefinition = z.infer<typeof ToolDefinition>;

export const ModuleDefinition = z.record(z.string(), ToolDefinition);

export type ModuleDefinition = z.infer<typeof ModuleDefinition>;
