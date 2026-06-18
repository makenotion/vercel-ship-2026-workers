import { notFound } from "next/navigation"

import { ChatPanel } from "@/components/chat-panel"
import { getThreadById } from "@/lib/chat-data"

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const thread = getThreadById(id)

  if (!thread) {
    notFound()
  }

  return <ChatPanel thread={thread} />
}
