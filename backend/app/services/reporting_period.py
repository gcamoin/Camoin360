"""Calendar selection shared by reports that aggregate individual records."""
from datetime import date, timedelta


def matches_reporting_date(value, year=None, month=None, quarter=None, start_date=None, end_date=None):
    try:
        day = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return False
    return (
        (not year or day.year == int(year))
        and (not month or day.month == int(month))
        and (not quarter or (day.month - 1) // 3 + 1 == int(quarter))
        and (not start_date or day.isoformat() >= str(start_date))
        and (not end_date or day.isoformat() <= str(end_date))
    )


def reporting_days(history_start, year=None, month=None, **filters):
    start = date(int(year), 1, 1) if year else history_start
    end = min(date(int(year), 12, 31), date.today()) if year else date.today()
    if filters.get("start_date"):
        start = max(start, date.fromisoformat(str(filters["start_date"])))
    if filters.get("end_date"):
        end = min(end, date.fromisoformat(str(filters["end_date"])))
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)
            if matches_reporting_date(start + timedelta(days=offset), year=year, month=month, **filters)]
