"use client";

import { useState } from "react";

interface ThumbsFeedbackProps {
  schemaId: string;
  caseId: string;
  initialRating: "up" | "down" | null;
}

const DOWN_REASONS = [
  { value: "wrong_group", label: "Wrong emails grouped" },
  { value: "missing", label: "Missing emails" },
  { value: "not_useful", label: "Not useful" },
];

export function ThumbsFeedback({ schemaId, caseId, initialRating }: ThumbsFeedbackProps) {
  const [rating, setRating] = useState(initialRating);
  const [showReasons, setShowReasons] = useState(false);
  const [sending, setSending] = useState(false);

  async function sendFeedback(
    type: "THUMBS_UP" | "THUMBS_DOWN",
    payload?: Record<string, unknown>,
  ) {
    setSending(true);
    try {
      const { authenticatedFetch } = await import("@/lib/supabase/authenticated-fetch");

      await authenticatedFetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ schemaId, type, caseId, payload }),
      });

      setRating(type === "THUMBS_UP" ? "up" : "down");
      setShowReasons(false);
    } finally {
      setSending(false);
    }
  }

  function handleThumbsUp() {
    if (sending) return;
    sendFeedback("THUMBS_UP");
  }

  function handleThumbsDown() {
    if (sending) return;
    setShowReasons(true);
  }

  function handleReasonSelect(reason: string) {
    sendFeedback("THUMBS_DOWN", { reason });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleThumbsUp}
          disabled={sending}
          className={`p-1.5 rounded transition ${
            rating === "up"
              ? "bg-green-100 text-green-700"
              : "text-muted hover:text-green-600 hover:bg-green-50"
          }`}
          aria-label="Thumbs up"
        >
          <ThumbsUpIcon />
        </button>
        <button
          type="button"
          onClick={handleThumbsDown}
          disabled={sending}
          className={`p-1.5 rounded transition ${
            rating === "down"
              ? "bg-red-100 text-red-700"
              : "text-muted hover:text-red-600 hover:bg-red-50"
          }`}
          aria-label="Thumbs down"
        >
          <ThumbsDownIcon />
        </button>
      </div>

      {showReasons && (
        <div className="bg-white border border-border rounded-lg shadow-md p-2 space-y-1">
          {DOWN_REASONS.map((reason) => (
            <button
              key={reason.value}
              type="button"
              onClick={() => handleReasonSelect(reason.value)}
              disabled={sending}
              className="block w-full text-left text-xs text-secondary hover:bg-subtle px-2 py-1.5 rounded transition"
            >
              {reason.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ThumbsUpIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 10v12M15 5.88L14 10h5.83a2 2 0 011.92 2.56l-2.33 8A2 2 0 0117.5 22H4a2 2 0 01-2-2v-8a2 2 0 012-2h2.76a2 2 0 001.79-1.11L12 2a3.13 3.13 0 013 3.88z" />
    </svg>
  );
}

function ThumbsDownIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 14V2M9 18.12L10 14H4.17a2 2 0 01-1.92-2.56l2.33-8A2 2 0 016.5 2H20a2 2 0 012 2v8a2 2 0 01-2 2h-2.76a2 2 0 00-1.79 1.11L12 22a3.13 3.13 0 01-3-3.88z" />
    </svg>
  );
}
