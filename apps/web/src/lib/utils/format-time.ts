/**
 * Format a date as a human-readable relative time string.
 * 0-6 days: relative ("today", "yesterday", "3d ago")
 * 7+ days: actual date ("Feb 15", "Mar 2")
 * Different year: "Feb 15, 2025"
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  // 7+ days: show actual date
  return formatShortDate(date);
}

/**
 * Format a date as a short display date.
 * Same year: "Feb 15"
 * Different year: "Feb 15, 2025"
 */
export function formatShortDate(date: Date): string {
  const now = new Date();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[date.getMonth()];
  const day = date.getDate();

  if (date.getFullYear() !== now.getFullYear()) {
    return `${month} ${day}, ${date.getFullYear()}`;
  }
  return `${month} ${day}`;
}

/**
 * Format an event date/time for card display.
 * "Wed Mar 5 @ 6:00pm"
 */
export function formatEventDate(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const dayName = days[date.getDay()];
  const month = months[date.getMonth()];
  const day = date.getDate();

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  const displayHour = hours % 12 || 12;
  const displayMinutes = minutes > 0 ? `:${minutes.toString().padStart(2, "0")}` : "";

  return `${dayName} ${month} ${day} @ ${displayHour}${displayMinutes}${ampm}`;
}
