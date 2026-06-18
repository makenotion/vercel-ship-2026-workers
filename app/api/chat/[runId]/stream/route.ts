import { createUIMessageStreamResponse } from "ai"
import { getRun } from "workflow/api"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  const startIndexParam = new URL(request.url).searchParams.get("startIndex")
  const startIndex = startIndexParam ? Number.parseInt(startIndexParam, 10) : 0
  const run = getRun(runId)
  const readable = run.getReadable({ startIndex })
  const tailIndex = await readable.getTailIndex()

  return createUIMessageStreamResponse({
    stream: readable,
    headers: {
      "x-workflow-run-id": runId,
      "x-workflow-stream-tail-index": String(tailIndex),
    },
  })
}
