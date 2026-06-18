import { ChatShell } from "@/components/chat-shell"

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ChatShell>{children}</ChatShell>
}
