import { convertToModelMessages, createUIMessageStreamResponse, type UIMessage } from "ai";
import { getRun, start } from "workflow/api";
import { z } from "zod";

import {
  createUserMessageEvent,
  getAppStateValue,
  listUIMessagesByThreadId,
  setAppStateValue,
} from "@/lib/chat-data";
import { chatWorkflow } from "@/workflow/chat";
import { sweepUntitledThreadTitlesWorkflow } from "@/workflow/thread-title";

export const maxDuration = 60;

const chatRequestSchema = z.object({
  threadId: z.string(),
  messages: z.array(z.custom<UIMessage>()),
});

export async function POST(request: Request) {
  const { threadId, messages } = chatRequestSchema.parse(await request.json());

  const latestMessage = messages.at(-1);

  if (!latestMessage || latestMessage.role !== "user") {
    return Response.json({ error: "Expected a user message" }, { status: 400 });
  }

  const text = getTextFromMessage(latestMessage).trim();

  if (!text) {
    return Response.json({ error: "Message text is required" }, { status: 400 });
  }

  await createUserMessageEvent({
    id: latestMessage.id,
    threadId,
    text,
  });

  await ensureThreadTitleSweeperStarted();

  const persistedMessages = await listUIMessagesByThreadId(threadId);
  const modelMessages = await convertToModelMessages(persistedMessages);
  const run = await start(chatWorkflow, [{ threadId, messages: modelMessages }]);

  return createUIMessageStreamResponse({
    stream: run.readable,
    headers: {
      "x-workflow-run-id": run.runId,
    },
  });
}

const THREAD_TITLE_SWEEPER_RUN_ID_KEY = "thread_title_sweeper_run_id";

async function ensureThreadTitleSweeperStarted() {
  const existingRunId = await getAppStateValue(THREAD_TITLE_SWEEPER_RUN_ID_KEY);

  if (existingRunId) {
    try {
      const status = await getRun(existingRunId).status;

      if (status === "pending" || status === "running") {
        return;
      }
    } catch {
      // Start a fresh sweeper if the stored run is no longer readable.
    }
  }

  const run = await start(sweepUntitledThreadTitlesWorkflow);

  await setAppStateValue({
    key: THREAD_TITLE_SWEEPER_RUN_ID_KEY,
    value: run.runId,
  });
}

function getTextFromMessage(message: UIMessage) {
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("");
}
