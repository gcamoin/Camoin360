import unittest
from datetime import date
from unittest.mock import AsyncMock, patch
from .reporting_period import matches_reporting_date, reporting_days
from . import harvest


class ReportingPeriodTest(unittest.TestCase):
    def test_calendar_intersection_and_inclusive_dates(self):
        filters = dict(year=2024, quarter=1, month=2, start_date="2024-02-15", end_date="2024-02-29")
        self.assertTrue(matches_reporting_date("2024-02-29T12:00:00Z", **filters))
        self.assertFalse(matches_reporting_date("2024-02-14", **filters))
        self.assertFalse(matches_reporting_date("2023-02-20", **filters))
        self.assertFalse(matches_reporting_date(None, **filters))
        self.assertEqual(len(reporting_days(date(2020, 1, 1), **filters)), 15)

    def test_month_without_year_and_empty_selection(self):
        days = reporting_days(date(2023, 1, 1), month=2, end_date="2024-12-31")
        self.assertEqual(len(days), 57)
        self.assertEqual(reporting_days(date(2020, 1, 1), year=2024, month=4, quarter=1), [])
        self.assertEqual(reporting_days(date(2020, 1, 1), start_date="2024-05-01", end_date="2024-04-01"), [])

    def test_cache_is_isolated_by_period(self):
        key = harvest._employee_productivity_cache_key
        self.assertNotEqual(key(2024, None, {"quarter": 1}), key(2024, None, {"quarter": 2}))
        self.assertNotEqual(key(2024), key(2024, None, {"start_date": "2024-02-01"}))


class HarvestReportingPeriodTest(unittest.IsolatedAsyncioTestCase):
    async def test_recurring_month_filters_entries_and_average_week_denominator(self):
        entries = [
            {"spent_date": "2023-02-01", "user": {"name": "Employee"}, "hours": 7, "billable": True},
            {"spent_date": "2023-03-01", "user": {"name": "Employee"}, "hours": 100, "billable": True},
            {"spent_date": "2024-02-29", "user": {"name": "Employee"}, "hours": 14, "billable": True},
        ]
        with patch.object(harvest, "_fetch_time_entries", AsyncMock(return_value=entries)) as fetch:
            result = await harvest._load_employee_weekly_hours_from_harvest(
                month=2, reporting_filters={"start_date": "2023-01-01", "end_date": "2024-12-31"})
        fetch.assert_awaited_once_with(date(2023, 2, 1), date(2024, 2, 29))
        self.assertEqual(result["employees"][0]["total_hours"], 21)
        self.assertEqual(result["weeks"], round(57 / 7, 2))

    async def test_empty_selection_does_not_fetch_or_restore_unfiltered_data(self):
        with patch.object(harvest, "_fetch_time_entries", AsyncMock()) as fetch:
            result = await harvest._load_employee_weekly_hours_from_harvest(
                year=2024, month=4, reporting_filters={"quarter": 1})
        fetch.assert_not_awaited()
        self.assertEqual(result["employees"], [])
