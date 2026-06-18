import { ChatShell } from "@/components/chat-shell"
import { listThreads } from "@/lib/chat-data"

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const threads = await listThreads()

  return <ChatShell threads={threads}>{children}</ChatShell>
}
