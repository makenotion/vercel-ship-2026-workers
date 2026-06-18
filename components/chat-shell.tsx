"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { MessageSquarePlusIcon } from "lucide-react"

import { getThreadById, threads } from "@/lib/chat-data"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

function getActiveThreadId(pathname: string) {
  const match = pathname.match(/^\/threads\/([^/]+)$/)
  return match?.[1]
}

export function ChatShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const activeThreadId = getActiveThreadId(pathname)
  const activeThread = activeThreadId ? getThreadById(activeThreadId) : undefined

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-2 px-2 py-1">
            <Link
              href="/"
              className="truncate font-medium group-data-[collapsible=icon]:hidden"
            >
              Chats
            </Link>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Threads</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {threads.map((thread) => (
                  <SidebarMenuItem key={thread.id}>
                    <SidebarMenuButton
                      render={<Link href={`/threads/${thread.id}`} />}
                      isActive={thread.id === activeThreadId}
                      tooltip={thread.title}
                    >
                      <span>{thread.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href="/" />}
                tooltip="New chat"
              >
                <MessageSquarePlusIcon />
                <span>New chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="flex h-svh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" />
          <h1 className="truncate text-sm font-medium">
            {activeThread?.title ?? "Chat"}
          </h1>
        </header>

        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
