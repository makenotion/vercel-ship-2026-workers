"use client"

import { SendIcon } from "lucide-react"

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

export function ChatPanel({ thread }: { thread: Thread }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          {thread.messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={message.content}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="shrink-0 border-t bg-background p-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => event.preventDefault()}
        >
          <Textarea
            placeholder="Send a message..."
            className="min-h-10 max-h-32 resize-none"
            rows={1}
          />
          <Button type="submit" size="icon" aria-label="Send message">
            <SendIcon />
          </Button>
        </form>
      </div>
    </div>
  )
}
