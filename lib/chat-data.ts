export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
}

export type Thread = {
  id: string
  title: string
  messages: Message[]
}

export function getThreadById(id: string) {
  return threads.find((thread) => thread.id === id)
}

export const threads: Thread[] = [
  {
    id: "1",
    title: "Welcome chat",
    messages: [
      {
        id: "1-1",
        role: "user",
        content: "Hello! What can you help me with?",
      },
      {
        id: "1-2",
        role: "assistant",
        content:
          "Hi there! I can help you brainstorm ideas, answer questions, or walk through code. What would you like to work on?",
      },
    ],
  },
  {
    id: "2",
    title: "Project planning",
    messages: [
      {
        id: "2-1",
        role: "user",
        content: "I need to plan a small side project.",
      },
      {
        id: "2-2",
        role: "assistant",
        content:
          "Great! Start by defining the core problem you want to solve and who it's for. Keep the first version as small as possible.",
      },
      {
        id: "2-3",
        role: "user",
        content: "It's a chat app with threads.",
      },
      {
        id: "2-4",
        role: "assistant",
        content:
          "Perfect scope. Focus on thread list, message view, and input first. You can add persistence and auth later.",
      },
    ],
  },
  {
    id: "3",
    title: "Weekend ideas",
    messages: [
      {
        id: "3-1",
        role: "user",
        content: "Any fun weekend project ideas?",
      },
      {
        id: "3-2",
        role: "assistant",
        content:
          "How about a personal dashboard, a habit tracker, or a recipe organizer? Pick something you'll actually use.",
      },
    ],
  },
]
