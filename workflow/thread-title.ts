import { DurableAgent } from "@workflow/ai/agent";
import type { ModelMessage, UIMessageChunk } from "ai";
import { getWritable, sleep } from "workflow";

export async function sweepUntitledThreadTitlesWorkflow() {
  "use workflow";

  while (true) {
    const candidates = await getUntitledThreadTitleCandidates();

    for (const candidate of candidates) {
      const title = await generateThreadTitle({
        threadId: candidate.threadId,
        message: candidate.message,
      });

      await persistThreadTitle({
        threadId: candidate.threadId,
        title,
      });
    }

    await sleep(THREAD_TITLE_SWEEP_INTERVAL);
  }
}

export async function generateThreadTitle({
  threadId,
  message,
}: {
  threadId: string;
  message: string;
}) {
  const agent = new DurableAgent({
    model: CHAT_MODEL,
    instructions: [
      "Generate a concise chat thread title from the user's first message.",
      "Return only the title.",
      "Use fewer than 10 words.",
      "Do not use punctuation.",
    ].join(" "),
  });

  const result = await agent.stream({
    messages: [{ role: "user", content: message }],
    writable: getWritable<UIMessageChunk>({
      namespace: `thread-title-${threadId}`,
    }),
    maxSteps: 1,
  });

  return normalizeThreadTitle(getAssistantText(result.messages));
}

export async function persistThreadTitle({ threadId, title }: { threadId: string; title: string }) {
  "use step";

  const normalizedTitle = normalizeThreadTitle(title) || "New chat";
  const { updateThreadTitle } = await import("@/lib/chat-data");

  await updateThreadTitle({ id: threadId, title: normalizedTitle });
}

export async function getUntitledThreadTitleCandidates() {
  "use step";

  const { listUntitledThreadTitleCandidates } = await import("@/lib/chat-data");

  return listUntitledThreadTitleCandidates();
}

const CHAT_MODEL = "openai/gpt-5-mini";
const THREAD_TITLE_WORD_LIMIT = 9;
const THREAD_TITLE_SWEEP_INTERVAL = "60s";

function normalizeThreadTitle(title: string) {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, THREAD_TITLE_WORD_LIMIT);

  return words.join(" ");
}

function getAssistantText(messages: ModelMessage[]) {
  const assistantMessage = messages.findLast((message) => {
    return message.role === "assistant";
  });

  if (!assistantMessage) {
    return "";
  }

  if (typeof assistantMessage.content === "string") {
    return assistantMessage.content;
  }

  return assistantMessage.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
