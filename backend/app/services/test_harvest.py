import unittest

from . import harvest


def _time_entry(employee, hours, billable=False, client="", project="", task="", notes=""):
    return {
        "user": {"name": employee},
        "hours": hours,
        "billable": billable,
        "client": {"name": client},
        "project": {"name": project},
        "task": {"name": task},
        "notes": notes,
    }


class HarvestMetricsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.original_fetch_time_entries = harvest._fetch_time_entries
        self.original_prospect_engage_employee_names = set(harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES)

    async def asyncTearDown(self):
        harvest._fetch_time_entries = self.original_fetch_time_entries
        harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES.clear()
        harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES.update(self.original_prospect_engage_employee_names)

    async def test_employee_hours_are_consulting_only(self):
        captured_dates = {}

        async def fake_fetch_time_entries(start_date, end_date):
            captured_dates["start_date"] = start_date
            return [
                _time_entry("Consultant McConnell", 30, billable=True, project="Consulting Retainer"),
                _time_entry("Consultant McConnell", 10, billable=False, project="Internal Admin"),
                _time_entry("Consultant Outside", 80, billable=True, project="Consulting Retainer"),
                _time_entry("Garrett Example", 20, billable=True, project="Consulting Retainer"),
                _time_entry("Jacob Example", 20, billable=True, project="Consulting Retainer"),
                _time_entry("PE Employee", 20, billable=True, project="ProspectEngage Campaign"),
            ]

        harvest._fetch_time_entries = fake_fetch_time_entries

        result = await harvest._load_employee_weekly_hours_from_harvest(year=2026)

        self.assertEqual(captured_dates["start_date"].isoformat(), "2026-01-01")
        self.assertEqual(result["scope"], "consulting")
        self.assertEqual(result["excluded_scope"], "prospect_engage")
        employees_by_name = {employee["employee"]: employee for employee in result["employees"]}
        self.assertEqual(employees_by_name["Consultant McConnell"]["total_hours"], 40)
        self.assertEqual(employees_by_name["Consultant Outside"]["total_hours"], 80)
        self.assertEqual(employees_by_name["Garrett Example"]["total_hours"], 20)
        self.assertEqual(employees_by_name["Jacob Example"]["total_hours"], 20)
        self.assertEqual(employees_by_name["PE Employee"]["total_hours"], 20)
        self.assertEqual(len(result["utilization_employees"]), 1)
        self.assertEqual(result["utilization_employees"][0]["employee"], "Consultant McConnell")
        self.assertEqual(result["utilization_employees"][0]["billable_hours"], 30)
        self.assertEqual(result["utilization_employees"][0]["total_hours"], 40)
        self.assertEqual(result["utilization_employees"][0]["utilization_rate"], 75)

    async def test_utilization_last_name_allowlist_normalizes_punctuation(self):
        self.assertTrue(harvest._is_utilization_employee_time_entry(_time_entry("Casey D'Amicis", 1)))
        self.assertFalse(harvest._is_utilization_employee_time_entry(_time_entry("Casey Smith", 1)))

    async def test_billable_breakdown_excludes_configured_prospect_engage_employees(self):
        harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES.clear()
        harvest.PROSPECT_ENGAGE_EMPLOYEE_NAMES.update({"garrett", "jacob", "pe employee"})

        async def fake_fetch_time_entries(start_date, end_date):
            return [
                _time_entry("Consultant One", 12, billable=True),
                _time_entry("Consultant One", 3, billable=False),
                _time_entry("Garrett Example", 8, billable=True),
                _time_entry("Jacob Example", 8, billable=True),
                _time_entry("PE Employee", 8, billable=True),
            ]

        harvest._fetch_time_entries = fake_fetch_time_entries

        result = await harvest.get_billable_breakdown(year=2026, month=1)

        self.assertEqual(result["billable_hours"], 12)
        self.assertEqual(result["non_billable_hours"], 3)
        self.assertEqual(result["total_hours"], 15)
        self.assertEqual(result["scope"], "consulting")


if __name__ == "__main__":
    unittest.main()
