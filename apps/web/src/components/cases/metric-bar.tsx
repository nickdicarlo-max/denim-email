"use client";

interface MetricBarProps {
  phase: "CALIBRATING" | "TRACKING" | "STABLE";
  accuracy?: number | null;
}

export function MetricBar({ phase, accuracy }: MetricBarProps) {
  if (phase === "CALIBRATING") {
    return (
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-sm text-amber-700 font-medium">
          Calibrating — use thumbs up/down to train the system
        </span>
      </div>
    );
  }

  if (phase === "TRACKING" && accuracy != null) {
    return (
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <span className="text-sm text-blue-700 font-medium">
          Accuracy: {Math.round(accuracy * 100)}%
        </span>
      </div>
    );
  }

  if (phase === "STABLE" && accuracy != null) {
    return (
      <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        <span className="text-sm text-green-700 font-medium">
          Stable — {Math.round(accuracy * 100)}% accuracy
        </span>
      </div>
    );
  }

  return null;
}
