// Display durations using 24-hour days and 30-day months, rather than calendar dates.
export function formatElapsedTime(since: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(since)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "Just now";
  const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? "" : "s"}`;
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour") + (minutes % 60 ? ` ${unit(minutes % 60, "minute")}` : "");
  const days = Math.floor(hours / 24);
  if (days < 30) return unit(days, "day") + (hours % 24 ? ` ${unit(hours % 24, "hour")}` : "");
  return unit(Math.floor(days / 30), "month") + (days % 30 ? ` ${unit(days % 30, "day")}` : "");
}
