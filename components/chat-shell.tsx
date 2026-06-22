"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquarePlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import {
  createThreadAction,
  deleteAllThreadsAction,
  deleteThreadAction,
} from "@/app/(chat)/actions";
import { getThreadTitle, type Thread } from "@/lib/chat-types";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Separator } from "@/components/ui/separator";
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
} from "@/components/ui/sidebar";

function getActiveThreadId(pathname: string) {
  const match = pathname.match(/^\/threads\/([^/]+)$/);
  return match?.[1];
}

export function ChatShell({ children, threads }: { children: React.ReactNode; threads: Thread[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const activeThreadId = getActiveThreadId(pathname);
  const activeThread = activeThreadId
    ? threads.find((thread) => thread.id === activeThreadId)
    : undefined;
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [isDeleteAllDialogOpen, setIsDeleteAllDialogOpen] = useState(false);
  const [isDeletingAllThreads, setIsDeletingAllThreads] = useState(false);

  async function handleCreateThread() {
    setIsCreatingThread(true);

    try {
      const { redirectTo } = await createThreadAction();

      router.push(redirectTo);
    } finally {
      setIsCreatingThread(false);
    }
  }

  async function handleDeleteThread(threadId: string) {
    setDeletingThreadId(threadId);

    try {
      const { redirectTo } = await deleteThreadAction(threadId, pathname);

      if (redirectTo !== pathname) {
        router.replace(redirectTo);
      } else {
        router.refresh();
      }
    } finally {
      setDeletingThreadId(null);
    }
  }

  async function handleDeleteAllThreads() {
    setIsDeletingAllThreads(true);

    try {
      const { redirectTo } = await deleteAllThreadsAction(pathname);

      setIsDeleteAllDialogOpen(false);

      if (redirectTo !== pathname) {
        router.replace(redirectTo);
      } else {
        router.refresh();
      }
    } finally {
      setIsDeletingAllThreads(false);
    }
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex items-center gap-2 px-2 py-1">
            <Link href="/" className="truncate font-medium group-data-[collapsible=icon]:hidden">
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
                  <ContextMenu key={thread.id}>
                    <SidebarMenuItem>
                      <ContextMenuTrigger className="contents">
                        <SidebarMenuButton
                          render={<Link href={`/threads/${thread.id}`} />}
                          isActive={thread.id === activeThreadId}
                          tooltip={getThreadTitle(thread)}
                        >
                          <span>{getThreadTitle(thread)}</span>
                        </SidebarMenuButton>
                      </ContextMenuTrigger>
                    </SidebarMenuItem>
                    <ContextMenuContent align="start" side="bottom" sideOffset={8}>
                      <ContextMenuItem
                        nativeButton
                        variant="destructive"
                        disabled={deletingThreadId === thread.id}
                        onClick={() => {
                          void handleDeleteThread(thread.id);
                        }}
                        render={<button type="button" className="w-full" />}
                      >
                        <Trash2Icon />
                        <span>
                          {deletingThreadId === thread.id ? "Deleting thread..." : "Delete thread"}
                        </span>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                tooltip="New chat"
                disabled={isCreatingThread}
                onClick={() => {
                  void handleCreateThread();
                }}
              >
                <MessageSquarePlusIcon />
                <span>{isCreatingThread ? "Creating chat..." : "New chat"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <AlertDialog open={isDeleteAllDialogOpen} onOpenChange={setIsDeleteAllDialogOpen}>
                <AlertDialogTrigger
                  disabled={threads.length === 0 || isDeletingAllThreads}
                  render={<SidebarMenuButton type="button" tooltip="Delete all threads" />}
                >
                  <Trash2Icon />
                  <span>Delete all</span>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete all threads?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes every thread and its messages. This action cannot be
                      undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={isDeletingAllThreads}>Cancel</AlertDialogCancel>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={isDeletingAllThreads}
                      onClick={() => {
                        void handleDeleteAllThreads();
                      }}
                    >
                      <Trash2Icon />
                      <span>{isDeletingAllThreads ? "Deleting..." : "Delete all"}</span>
                    </Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="flex h-svh flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" />
          <h1 className="truncate text-sm font-medium">
            {activeThread ? getThreadTitle(activeThread) : "Chat"}
          </h1>
        </header>

        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
