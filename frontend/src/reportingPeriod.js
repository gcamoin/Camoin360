// Aggregated observations are included when their calendar period overlaps the
// selection. Their totals remain at the source's monthly/quarterly/annual grain.
const pad = (value) => String(value).padStart(2, "0");
const iso = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;
const active = (value) => value !== undefined && value !== null && value !== "" && value !== "all";

export function reportingParams(filters = {}) {
  return Object.fromEntries(Object.entries({
    year: filters.year, quarter: filters.quarter, month: filters.month,
    start_date: filters.startDate, end_date: filters.endDate,
  }).filter(([, value]) => active(value)));
}

function periodFor(row) {
  const key = row.period_key || row.day_key || row.month_key || row.monthKey || row.created_on || row.createdon || row.date || row.month;
  const match = String(key || "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (match) return { year: +match[1], month: +match[2], day: match[3] ? +match[3] : null, months: 1 };
  const quarter = String(row.quarter || "").replace(/^Q/, "") || String(key || "").match(/Q([1-4])/)?.[1];
  const year = Number(row.year || String(key || "").match(/\b(\d{4})\b/)?.[1]);
  const month = Number(row.monthNumber || (Number(row.month) <= 12 ? row.month : 0));
  if (year && month) return { year, month, months: 1 };
  const monthName = String(key || "").match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
  if (year && monthName) return { year, month: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(monthName[1].toLowerCase()) + 1, months: 1 };
  if (year && quarter) return { year, month: (+quarter - 1) * 3 + 1, months: 3 };
  return year ? { year, month: 1, months: 12 } : null;
}

export function matchesReportingPeriod(row, filters = {}) {
  if (!Object.keys(reportingParams(filters)).length) return true;
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) return false;
  const period = periodFor(row);
  if (!period) return false;
  if (active(filters.year) && period.year !== Number(filters.year)) return false;
  for (let month = period.month; month < period.month + period.months; month += 1) {
    if (active(filters.month) && month !== Number(filters.month)) continue;
    if (active(filters.quarter) && Math.ceil(month / 3) !== Number(filters.quarter)) continue;
    const start = iso(period.year, month, period.day || 1);
    const end = iso(period.year, month, period.day || new Date(period.year, month, 0).getDate());
    if ((!filters.startDate || end >= filters.startDate) && (!filters.endDate || start <= filters.endDate)) return true;
  }
  return false;
}

export const filterReportingRows = (rows = [], filters) => rows.filter((row) => matchesReportingPeriod(row, filters));
