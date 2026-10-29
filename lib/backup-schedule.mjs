const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DEFAULT_BACKUP_SCHEDULE = { enabled: false, mode: "DAILY", time: "23:00", days: [0, 1, 2, 3, 4, 5, 6], intervalMinutes: 60, afterClosing: false, timezone: "Asia/Karachi" };

export function validateBackupSchedule(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.enabled !== "boolean" || typeof raw.afterClosing !== "boolean") throw new Error("Check the backup settings.");
  if (!["DAILY", "WEEKLY", "INTERVAL"].includes(raw.mode)) throw new Error("Choose a valid backup schedule.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) throw new Error("Choose a valid backup time.");
  if (!Array.isArray(raw.days) || !raw.days.length || raw.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Select at least one backup day.");
  if (!Number.isInteger(raw.intervalMinutes) || raw.intervalMinutes < 5 || raw.intervalMinutes > 10080) throw new Error("Backup interval must be 5 to 10,080 minutes.");
  try { new Intl.DateTimeFormat("en", { timeZone: raw.timezone }).format(); } catch { throw new Error("Choose a valid time zone."); }
  if (typeof raw.timezone !== "string" || raw.timezone.length > 100) throw new Error("Choose a valid time zone.");
  return { enabled: raw.enabled, mode: raw.mode, time: raw.time, days: [...new Set(raw.days)].sort(), intervalMinutes: raw.intervalMinutes, afterClosing: raw.afterClosing, timezone: raw.timezone };
}

export function nextBackupAt(raw, after = new Date()) {
  const schedule = validateBackupSchedule(raw);
  if (!schedule.enabled) return null;
  if (schedule.mode === "INTERVAL") return new Date(after.getTime() + schedule.intervalMinutes * 60000);
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const parts = date => Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const today = parts(after), [hour, minute] = schedule.time.split(":").map(Number);
  for (let offset = 0; offset < 9; offset++) {
    const localDay = new Date(Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) + offset));
    if (schedule.mode === "WEEKLY" && !schedule.days.includes(localDay.getUTCDay())) continue;
    const wallTime = Date.UTC(localDay.getUTCFullYear(), localDay.getUTCMonth(), localDay.getUTCDate(), hour, minute);
    let candidate = new Date(wallTime);
    for (let i = 0; i < 4; i++) {
      const actual = parts(candidate);
      const difference = Date.UTC(Number(actual.year), Number(actual.month) - 1, Number(actual.day), Number(actual.hour), Number(actual.minute)) - wallTime;
      if (!difference) break;
      candidate = new Date(candidate.getTime() - difference);
    }
    const result = parts(candidate);
    // Skip a nonexistent local time during a daylight-saving transition.
    if (candidate > after && result.hour === String(hour).padStart(2, "0") && result.minute === String(minute).padStart(2, "0") && (schedule.mode !== "WEEKLY" || schedule.days.includes(weekdays.indexOf(result.weekday)))) return candidate;
  }
  throw new Error("Could not calculate the next backup time.");
}
