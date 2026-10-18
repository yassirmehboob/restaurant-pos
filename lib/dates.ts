export const DATE_PLACEHOLDER = "DD/MM/YYYY";
export const APP_TIME_ZONE = "Asia/Karachi";

export function isISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseDisplayDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return "";
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isISODate(iso) ? iso : "";
}

export function dateISO(value: Date | string | number = new Date()): string {
  if (typeof value === "string" && isISODate(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function formatDate(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const iso = dateISO(value);
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
}

export function formatTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === "" || !dateISO(value)) return "—";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: APP_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(new Date(value)).toUpperCase();
  return time;
}

export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === "" || !dateISO(value)) return "—";
  return `${formatDate(value)} ${formatTime(value)}`;
}
