export default function HomePage() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
      <div className="max-w-sm space-y-2">
        <p className="text-sm font-medium">No thread selected</p>
        <p className="text-sm text-muted-foreground">
          Choose a thread from the sidebar or start a new chat.
        </p>
      </div>
    </div>
  )
}
