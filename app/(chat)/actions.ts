"use server";

import { revalidatePath } from "next/cache";

import { createThread, deleteAllThreads, deleteThread } from "@/lib/chat-data";

export async function createThreadAction() {
  const thread = await createThread();

  revalidatePath("/");

  return {
    redirectTo: `/threads/${thread.id}`,
  };
}

export async function deleteThreadAction(threadId: string, currentPath: string) {
  await deleteThread(threadId);

  const nextPath = currentPath === `/threads/${threadId}` ? "/" : currentPath;

  revalidatePath("/");
  revalidatePath(currentPath);

  return {
    redirectTo: nextPath,
  };
}

export async function deleteAllThreadsAction(currentPath: string) {
  await deleteAllThreads();

  revalidatePath("/");
  revalidatePath(currentPath);

  return {
    redirectTo: "/",
  };
}
