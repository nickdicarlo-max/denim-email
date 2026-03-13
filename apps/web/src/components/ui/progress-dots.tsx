"use client";

interface ProgressDotsProps {
  current: number;
  total: number;
}

export function ProgressDots({ current, total }: ProgressDotsProps) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-4">
      {Array.from({ length: total }, (_, i) => {
        let dotClass: string;
        if (i === current) {
          dotClass = "h-2 w-6 rounded-full bg-accent transition-all duration-300";
        } else if (i < current) {
          dotClass = "h-2 w-2 rounded-full bg-accent transition-all duration-300";
        } else {
          dotClass = "h-2 w-2 rounded-full bg-border transition-all duration-300";
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: static dot list never reorders
        return <div key={i} className={dotClass} />;
      })}
    </div>
  );
}
