import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import database
from backend.app.services.software_subscriptions import (
    create_software_subscription,
    delete_software_subscription,
    get_software_subscription,
    list_software_subscriptions,
    update_software_subscription,
)


class SoftwareSubscriptionServiceTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path_patch = patch.object(
            database,
            "DATABASE_PATH",
            Path(self.temporary_directory.name) / "software-subscriptions.db",
        )
        self.database_path_patch.start()

    def tearDown(self):
        self.database_path_patch.stop()
        self.temporary_directory.cleanup()

    def test_seeds_sample_subscriptions(self):
        subscriptions = list_software_subscriptions()

        self.assertGreaterEqual(len(subscriptions), 4)
        self.assertIn("ArcGIS Online", [subscription.name for subscription in subscriptions])

    def test_creates_updates_and_deletes_subscription(self):
        created = create_software_subscription(
            {
                "name": "Example Data",
                "description": "Example description",
                "point_of_contact": "Operations",
                "assigned_users": "Team",
                "cost_2024_2025": 100,
                "cost_2025_2026": 125,
                "cost_2026_2027": None,
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
                "cost_2026_2027": 150,
                "status": "Pending Renewal",
            },
        )

        self.assertEqual(updated.name, "Example Data Updated")
        self.assertEqual(updated.cost_2025_2026, 125)
        self.assertEqual(updated.cost_2026_2027, 150)
        self.assertEqual(get_software_subscription(created.id), updated)

        delete_software_subscription(created.id)

        with self.assertRaises(LookupError):
            get_software_subscription(created.id)


if __name__ == "__main__":
    unittest.main()
