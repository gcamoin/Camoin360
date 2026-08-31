import unittest

from backend.app.testing_support import temporary_database
from backend.app.services.software_subscriptions import (
    create_software_subscription,
    delete_software_subscription,
    get_software_subscription,
    list_software_subscriptions,
    update_software_subscription,
)


class SoftwareSubscriptionServiceTest(unittest.TestCase):
    def setUp(self):
        self.database_patch = temporary_database()
        self.database_patch.start()

    def tearDown(self):
        self.database_patch.stop()

    def test_seeds_sample_subscriptions(self):
        subscriptions = list_software_subscriptions()

        self.assertGreaterEqual(len(subscriptions), 4)
        self.assertIn("ArcGIS Online", [subscription.name for subscription in subscriptions])
        self.assertIn("GIS / Mapping", [subscription.category for subscription in subscriptions])

    def test_creates_updates_and_deletes_subscription(self):
        created = create_software_subscription(
            {
                "name": "Example Data",
                "description": "Example description",
                "category": "Market Data",
                "department": "Research",
                "point_of_contact": "Operations",
                "assigned_users": "Team",
                "cost_2024_2025": 100,
                "cost_2025_2026": 125,
                "cost_2026_2027": None,
                "billing_frequency": "Annual",
                "renewal_date": "2026-05-01",
                "renewal_time_frame": "Annual - May",
                "vendor_rep": "Vendor Rep",
                "subscribed_since": "2024",
                "status": "Active",
                "notes": "Example notes",
            }
        )

        updated = update_software_subscription(
            created.id,
            {
                "name": "Example Data Updated",
                "category": "Research Data",
                "department": "Operations",
                "cost_2026_2027": 150,
                "status": "Pending Renewal",
            },
        )

        self.assertEqual(updated.name, "Example Data Updated")
        self.assertEqual(updated.category, "Research Data")
        self.assertEqual(updated.department, "Operations")
        self.assertEqual(updated.billing_frequency, "Annual")
        self.assertEqual(updated.renewal_date, "2026-05-01")
        self.assertEqual(updated.cost_2025_2026, 125)
        self.assertEqual(updated.cost_2026_2027, 150)
        self.assertEqual(get_software_subscription(created.id), updated)

        delete_software_subscription(created.id)

        with self.assertRaises(LookupError):
            get_software_subscription(created.id)


if __name__ == "__main__":
    unittest.main()
