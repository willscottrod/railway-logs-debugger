import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import duration from "dayjs/plugin/duration.js";

dayjs.extend(relativeTime);
dayjs.extend(duration);

/**
 * Parse a period string like "1h", "30m", "7d", "2w" into a start/end date range.
 * Also accepts ISO 8601 date strings directly.
 */
export function parsePeriod(period: string): { start: string; end: string } {
  const end = dayjs().toISOString();

  // Check for relative time formats (e.g., 1h, 30m, 7d, 2w)
  const match = period.match(/^(\d+)([smhdw])$/);
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2];

    const unitMap: Record<string, dayjs.ManipulateType> = {
      s: "second",
      m: "minute",
      h: "hour",
      d: "day",
      w: "week",
    };

    const start = dayjs().subtract(amount, unitMap[unit]).toISOString();
    return { start, end };
  }

  // Plain number without a unit defaults to hours (e.g., "244" → "244h")
  if (/^\d+$/.test(period)) {
    const amount = parseInt(period, 10);
    const start = dayjs().subtract(amount, "hour").toISOString();
    return { start, end };
  }

  // Try ISO 8601 date string (must look like a full date, not a bare number)
  const parsed = dayjs(period);
  if (parsed.isValid() && parsed.year() >= 2000) {
    return { start: parsed.toISOString(), end };
  }

  throw new Error(
    `Invalid period format: "${period}". Use relative format (e.g., 1h, 30m, 7d, 2w) or ISO 8601 date.`
  );
}

/**
 * Calculate an appropriate sample rate based on the time range.
 */
export function calculateSampleRate(startDate: string, endDate: string): number {
  const diffMs = dayjs(endDate).diff(dayjs(startDate), "millisecond");
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours <= 1) return 60; // 1 minute samples
  if (diffHours <= 6) return 300; // 5 minute samples
  if (diffHours <= 24) return 600; // 10 minute samples
  if (diffHours <= 168) return 3600; // 1 hour samples
  return 7200; // 2 hour samples
}

export function formatDuration(startDate: string, endDate: string): string {
  const diff = dayjs(endDate).diff(dayjs(startDate));
  const d = dayjs.duration(diff);

  const parts: string[] = [];
  if (d.days() > 0) parts.push(`${d.days()}d`);
  if (d.hours() > 0) parts.push(`${d.hours()}h`);
  if (d.minutes() > 0) parts.push(`${d.minutes()}m`);
  if (parts.length === 0) parts.push(`${d.seconds()}s`);

  return parts.join(" ");
}
