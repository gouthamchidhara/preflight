export function Toast({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-sm text-page shadow-lg">
      {children}
    </div>
  );
}
