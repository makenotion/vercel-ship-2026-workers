import type { UIMessage } from "ai";
import { getRun } from "workflow/api";
import { z } from "zod";

import { createAssistantMessageEvent, getEventById } from "@/lib/chat-data";
import { hasPersistableAssistantParts, markTextPartsDone } from "@/lib/chat-parts";

const ACTIVE_RUN_STATUSES = new Set(["pending", "running", "workflow_suspended"]);

const assistantMessageSchema = z.object({
  id: z.string(),
  role: z.literal("assistant"),
  parts: z.array(z.custom<UIMessage["parts"][number]>()),
});

const stopRequestSchema = z.object({
  threadId: z.string(),
  assistantMessage: assistantMessageSchema.optional(),
});

async function persistAssistantSnapshot({
  message,
  threadId,
}: {
  message: z.infer<typeof assistantMessageSchema>;
  threadId: string;
}) {
  if (!hasPersistableAssistantParts(message.parts)) {
    return;
  }

  const existingEvent = await getEventById(message.id);

  if (existingEvent) {
    return;
  }

  await createAssistantMessageEvent({
    id: message.id,
    threadId,
    contents: markTextPartsDone(message.parts),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const bodyResult = stopRequestSchema.safeParse(await request.json().catch(() => ({})));

  if (!bodyResult.success) {
    return Response.json({ error: "Invalid stop request" }, { status: 400 });
  }

  const run = getRun(runId);
  const status = await run.status.catch(() => undefined);

  if (status === "completed") {
    return Response.json({ success: true });
  }

  const { assistantMessage, threadId } = bodyResult.data;

  if (assistantMessage) {
    await persistAssistantSnapshot({ message: assistantMessage, threadId });
  }

  if (status && ACTIVE_RUN_STATUSES.has(status)) {
    await run.cancel();
  }

  return Response.json({ success: true });
}
