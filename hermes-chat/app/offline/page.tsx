export default function OfflinePage() {
  return (
    <div className="main-chat-depth flex h-dvh items-center justify-center bg-[var(--sidebar-depth-canvas)] text-foreground">
      <div className="text-center px-6">
        <h1 className="text-2xl font-semibold mb-2">You are offline</h1>
        <p className="text-muted-foreground">
          Check your connection and try again.
        </p>
      </div>
    </div>
  );
}
