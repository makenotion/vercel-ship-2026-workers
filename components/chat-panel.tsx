"use client"

import { useChat } from "@ai-sdk/react"
import { WorkflowChatTransport } from "@workflow/ai"
import type { UIMessage } from "ai"
import { SendIcon } from "lucide-react"
import { useMemo, useState } from "react"

import type { Thread } from "@/lib/chat-types"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"

function MessageBubble({
  role,
  content,
}: {
  role: "user" | "assistant"
  content: string
}) {
  const isUser = role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {content}
      </div>
    </div>
  )
}

function messageToUIMessage(message: Thread["messages"][number]): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: [{ type: "text", text: message.content }],
  }
}

function getMessageContent(message: UIMessage) {
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => {
      return part.type === "text"
    })
    .map((part) => part.text)
    .join("")
}

function isChatMessage(
  message: UIMessage,
): message is UIMessage & { role: "user" | "assistant" } {
  return message.role === "user" || message.role === "assistant"
}

export function ChatPanel({ thread }: { thread: Thread }) {
  const [input, setInput] = useState("")
  const storageKey = `chat:${thread.id}:active-workflow-run-id`
  const [resumeRunId, setResumeRunId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") {
      return undefined
    }

    return localStorage.getItem(storageKey) ?? undefined
  })
  const initialMessages = useMemo(() => {
    return thread.messages.map(messageToUIMessage)
  }, [thread.messages])
  const transport = useMemo(() => {
    return new WorkflowChatTransport<UIMessage>({
      api: "/api/chat",
      initialStartIndex: -50,
      onChatSendMessage: (response) => {
        const workflowRunId = response.headers.get("x-workflow-run-id")

        if (workflowRunId) {
          localStorage.setItem(storageKey, workflowRunId)
        }
      },
      onChatEnd: () => {
        localStorage.removeItem(storageKey)
        setResumeRunId(undefined)
      },
      prepareSendMessagesRequest: ({ api, messages }) => ({
        api,
        body: {
          threadId: thread.id,
          messages,
        },
      }),
      prepareReconnectToStreamRequest: ({ api }) => {
        const workflowRunId = localStorage.getItem(storageKey)

        return {
          api: workflowRunId
            ? `/api/chat/${encodeURIComponent(workflowRunId)}/stream`
            : api,
        }
      },
    })
  }, [storageKey, thread.id])
  const { error, messages, sendMessage, status } = useChat({
    id: thread.id,
    messages: initialMessages,
    onError: () => {
      localStorage.removeItem(storageKey)
      setResumeRunId(undefined)
    },
    resume: Boolean(resumeRunId),
    transport,
  })
  const isBusy = status === "submitted" || status === "streaming"

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const text = input.trim()

    if (!text || isBusy) {
      return
    }

    setInput("")
    await sendMessage({ text })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          {messages.filter(isChatMessage).map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={getMessageContent(message)}
            />
          ))}
          {error ? (
            <p className="text-sm text-destructive">
              Something went wrong while streaming the response.
            </p>
          ) : null}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t bg-background p-4">
        <form className="flex items-end gap-2" onSubmit={handleSubmit}>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Send a message..."
            className="min-h-10 max-h-32 resize-none"
            disabled={isBusy}
            rows={1}
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Send message"
            disabled={isBusy || !input.trim()}
          >
            <SendIcon />
          </Button>
        </form>
      </div>
    </div>
  )
}
