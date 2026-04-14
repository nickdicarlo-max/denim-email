export function CaseCardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-lg p-6 border-l-4 border-l-surface-highest">
          <div className="h-4 bg-surface-mid rounded w-3/4 mb-3" />
          <div className="h-3 bg-surface-mid rounded w-1/2 mb-2" />
          <div className="h-3 bg-surface-mid rounded w-full" />
        </div>
      ))}
    </div>
  );
}
