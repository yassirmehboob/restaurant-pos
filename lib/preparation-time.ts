export function maxPreparationMinutes(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return valid.length ? Math.max(...valid) : null;
}

export function readyTimeMessage(enabled: boolean, minutes: number | null): string | null {
  if (!enabled || minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (remainder) parts.push(`${remainder} ${remainder === 1 ? "minute" : "minutes"}`);
  return `Your order will be ready in ${parts.join(" ")}.`;
}
