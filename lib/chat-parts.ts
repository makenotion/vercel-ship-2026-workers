import type { UIMessage } from "ai";

export type UIMessagePart = UIMessage["parts"][number];

type ToolLikePart = UIMessagePart & {
  type: string;
  toolCallId?: string;
};

export function getTextFromParts(parts: UIMessage["parts"]): string {
  return parts
    .filter((part): part is Extract<UIMessagePart, { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join("");
}

export function isToolPart(part: UIMessagePart): part is ToolLikePart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

export function hasPersistableAssistantParts(parts: UIMessage["parts"]): boolean {
  return getTextFromParts(parts).trim().length > 0 || parts.some(isToolPart);
}

export function markTextPartsDone(parts: UIMessage["parts"]): UIMessage["parts"] {
  return parts.map((part) => {
    if (part.type !== "text") {
      return part;
    }

    return { ...part, state: "done" };
  });
}
