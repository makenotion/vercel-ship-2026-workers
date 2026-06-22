"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@workflow/ai";
import type { UIMessage } from "ai";
import {
  BanIcon,
  CheckCircle2Icon,
  CommandIcon,
  CornerDownLeftIcon,
  Loader2Icon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import type { Thread } from "@/lib/chat-types";
import { isToolPart, type UIMessagePart } from "@/lib/chat-parts";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { InputGroupTextarea } from "@/components/ui/input-group";

function messageToUIMessage(message: Thread["messages"][number]): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts.length > 0 ? message.parts : [{ type: "text", text: message.content }],
  };
}

function isChatMessage(message: UIMessage): message is UIMessage & { role: "user" | "assistant" } {
  return message.role === "user" || message.role === "assistant";
}

type ToolPart = UIMessagePart & {
  type: string;
  toolCallId?: string;
  toolName?: string;
  title?: string;
  state?: string;
  input?: unknown;
  rawInput?: unknown;
  output?: unknown;
  errorText?: string;
  toolMetadata?: Record<string, unknown>;
};

function getToolDisplayName(part: ToolPart) {
  if (typeof part.toolMetadata?.displayName === "string") {
    return part.toolMetadata.displayName;
  }

  if (part.title) {
    return part.title;
  }

  if (part.toolName) {
    return part.toolName;
  }

  return part.type.replace(/^tool-/, "");
}

function getToolStatus(part: ToolPart) {
  switch (part.state) {
    case "output-available":
      return {
        label: "Completed",
        icon: CheckCircle2Icon,
        className: "text-emerald-600 dark:text-emerald-400",
      };
    case "output-error":
      return {
        label: "Failed",
        icon: XCircleIcon,
        className: "text-destructive",
      };
    case "output-denied":
      return {
        label: "Denied",
        icon: BanIcon,
        className: "text-muted-foreground",
      };
    case "input-streaming":
      return {
        label: "Preparing",
        icon: Loader2Icon,
        className: "text-muted-foreground",
      };
    default:
      return {
        label: "Calling",
        icon: WrenchIcon,
        className: "text-muted-foreground",
      };
  }
}

function formatJson(value: unknown) {
  if (value === undefined) {
    return "undefined";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolDataDetails({
  defaultOpen,
  label,
  value,
}: {
  defaultOpen: boolean;
  label: string;
  value: unknown;
}) {
  return (
    <details
      className="group/details overflow-hidden rounded-md border bg-background"
      open={defaultOpen}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">
        {label}
      </summary>
      <pre className="max-h-72 overflow-auto border-t bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words">
        {formatJson(value)}
      </pre>
    </details>
  );
}

function ToolCallPart({ part }: { part: ToolPart }) {
  const status = getToolStatus(part);
  const StatusIcon = status.icon;
  const defaultOpen = part.state !== "output-available";
  const input = part.input ?? part.rawInput;
  const hasInput = input !== undefined;
  const hasOutput = part.output !== undefined;
  const hasError = Boolean(part.errorText);

  return (
    <div className="my-2 overflow-hidden rounded-md border bg-muted/20 text-sm">
      <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
        <StatusIcon
          className={`size-4 shrink-0 ${status.className} ${
            part.state === "input-streaming" ? "animate-spin" : ""
          }`}
        />
        <span className="truncate font-medium">{getToolDisplayName(part)}</span>
        <span className={`ml-auto shrink-0 text-xs ${status.className}`}>{status.label}</span>
      </div>
      {hasInput || hasOutput || hasError ? (
        <div className="grid gap-2 p-2">
          {hasInput ? (
            <ToolDataDetails defaultOpen={defaultOpen} label="Input" value={input} />
          ) : null}
          {hasOutput ? (
            <ToolDataDetails defaultOpen={defaultOpen} label="Output" value={part.output} />
          ) : null}
          {hasError ? <ToolDataDetails defaultOpen label="Error" value={part.errorText} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function renderMessagePart(part: UIMessagePart, role: "user" | "assistant", index: number) {
  if (part.type === "text") {
    return role === "assistant" ? (
      <MessageResponse key={index}>{part.text}</MessageResponse>
    ) : (
      <Fragment key={index}>{part.text}</Fragment>
    );
  }

  if (isToolPart(part)) {
    return <ToolCallPart key={part.toolCallId ?? index} part={part as ToolPart} />;
  }

  return null;
}

function isExpectedStopError(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const name = "name" in error ? String(error.name) : undefined;
  const message = "message" in error ? String(error.message) : undefined;

  return name === "AbortError" || message?.includes("BodyStreamBuffer was aborted");
}

export function ChatPanel({ thread }: { thread: Thread }) {
  const [input, setInput] = useState("");
  const storageKey = `chat:${thread.id}:active-workflow-run-id`;
  const [resumeRunId, setResumeRunId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    return localStorage.getItem(storageKey) ?? undefined;
  });
  const initialMessages = useMemo(() => {
    return thread.messages.map(messageToUIMessage);
  }, [thread.messages]);
  const transport = useMemo(() => {
    return new WorkflowChatTransport<UIMessage>({
      api: "/api/chat",
      initialStartIndex: -50,
      onChatSendMessage: (response) => {
        const workflowRunId = response.headers.get("x-workflow-run-id");

        if (workflowRunId) {
          localStorage.setItem(storageKey, workflowRunId);
        }
      },
      onChatEnd: () => {
        localStorage.removeItem(storageKey);
        setResumeRunId(undefined);
      },
      prepareSendMessagesRequest: ({ api, messages }) => ({
        api,
        body: {
          threadId: thread.id,
          messages,
        },
      }),
      prepareReconnectToStreamRequest: ({ api }) => {
        const workflowRunId = localStorage.getItem(storageKey);

        return {
          api: workflowRunId ? `/api/chat/${encodeURIComponent(workflowRunId)}/stream` : api,
        };
      },
    });
  }, [storageKey, thread.id]);
  const { error, messages, sendMessage, status, stop } = useChat({
    id: thread.id,
    messages: initialMessages,
    onError: () => {
      localStorage.removeItem(storageKey);
      setResumeRunId(undefined);
    },
    resume: Boolean(resumeRunId),
    transport,
  });
  const isBusy = status === "submitted" || status === "streaming";
  const inputHasNewlines = input.includes("\n");
  const submitDisabled = !isBusy && !input.trim();
  const submitShortcutLabel = inputHasNewlines ? "Command Return" : "Return";
  const showSubmitShortcut = status !== "submitted" && status !== "streaming" && status !== "error";

  async function handleSubmit({ text }: { text: string }) {
    const messageText = text.trim();

    if (!messageText || isBusy) {
      return;
    }

    setInput("");
    await sendMessage({ text: messageText });
  }

  function handleStop() {
    const workflowRunId = localStorage.getItem(storageKey);
    const lastMessage = messages.at(-1);
    const assistantMessage = lastMessage?.role === "assistant" ? lastMessage : undefined;

    if (workflowRunId) {
      void fetch(`/api/chat/${encodeURIComponent(workflowRunId)}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: thread.id,
          assistantMessage,
        }),
      });
    }

    localStorage.removeItem(storageKey);
    setResumeRunId(undefined);
    void stop().catch((stopError: unknown) => {
      if (!isExpectedStopError(stopError)) {
        throw stopError;
      }
    });
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.altKey || event.ctrlKey || event.nativeEvent.isComposing) {
      return;
    }

    const shouldSubmit = event.metaKey || (!inputHasNewlines && !event.shiftKey);

    if (!shouldSubmit) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-x-hidden">
      <Conversation className="min-w-0 overflow-x-hidden">
        <ConversationContent
          className="min-w-0 overflow-x-hidden"
          scrollClassName="min-w-0 overflow-x-hidden"
        >
          {messages.filter(isChatMessage).map((message) => (
            <Message key={message.id} from={message.role}>
              <MessageContent
                className={
                  message.role === "user"
                    ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                    : undefined
                }
              >
                {message.parts.map((part, index) => {
                  return renderMessagePart(part, message.role, index);
                })}
              </MessageContent>
            </Message>
          ))}
          {error ? (
            <p className="text-sm text-destructive">
              Something went wrong while streaming the response.
            </p>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 border-t bg-background p-4">
        <PromptInput onSubmit={handleSubmit}>
          <InputGroupTextarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            name="message"
            placeholder="Send a message..."
            className="min-h-10 max-h-32 py-2.5"
            rows={1}
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit
              status={status}
              aria-label={isBusy ? "Stop response" : `Send message (${submitShortcutLabel})`}
              className={inputHasNewlines ? "w-11 gap-0.5 px-2" : undefined}
              disabled={submitDisabled}
              onStop={handleStop}
            >
              {showSubmitShortcut ? (
                <>
                  {inputHasNewlines ? <CommandIcon className="size-3.5" /> : null}
                  <CornerDownLeftIcon className="size-4" />
                </>
              ) : undefined}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
