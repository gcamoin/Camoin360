import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import database
from backend.app.main import app
from backend.app.routes.auth import require_user


class ClientManagementRoutesTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path_patch = patch.object(
            database,
            "DATABASE_PATH",
            Path(self.temporary_directory.name) / "client-management-routes.db",
        )
        self.database_path_patch.start()
        app.dependency_overrides[require_user] = lambda: {"email": "admin@example.com"}
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()
        self.database_path_patch.stop()
        self.temporary_directory.cleanup()

    def test_client_management_rest_routes(self):
        create_organization_response = self.client.post(
            "/organizations",
            json={
                "organization_name": "Example Capital",
                "city": "Albany",
                "state": "NY",
                "contract_expiration": None,
            },
        )
        self.assertEqual(create_organization_response.status_code, 201)
        organization_id = create_organization_response.json()["id"]

        self.assertTrue(create_organization_response.json()["dynamics_account_id"].startswith("manual-"))
        self.assertEqual(self.client.get("/organizations").status_code, 200)
        self.assertEqual(self.client.get(f"/organizations/{organization_id}").status_code, 200)

        update_organization_response = self.client.patch(
            f"/organizations/{organization_id}",
            json={"organization_name": "Example Capital Partners", "city": "Troy"},
        )
        self.assertEqual(update_organization_response.status_code, 200)
        self.assertEqual(update_organization_response.json()["organization_name"], "Example Capital Partners")

        create_user_response = self.client.post(
            f"/organizations/{organization_id}/users",
            json={
                "name": "Jane Client",
                "username": "jane@example.com",
                "password": "secure-password",
                "role": "admin",
            },
        )
        self.assertEqual(create_user_response.status_code, 201)
        user_id = create_user_response.json()["id"]

        organization_users_response = self.client.get(f"/organizations/{organization_id}/users")
        self.assertEqual(organization_users_response.status_code, 200)
        self.assertEqual(organization_users_response.json()["count"], 1)

        self.assertEqual(self.client.get(f"/users/{user_id}").status_code, 200)

        update_user_response = self.client.patch(
            f"/users/{user_id}",
            json={"name": "Jane Updated", "role": "manager"},
        )
        self.assertEqual(update_user_response.status_code, 200)
        self.assertEqual(update_user_response.json()["role"], "manager")

        reset_password_response = self.client.post(
            f"/users/{user_id}/reset-password",
            json={"password": "new-password"},
        )
        self.assertEqual(reset_password_response.status_code, 200)

        subscriptions_response = self.client.get("/software-subscriptions")
        self.assertEqual(subscriptions_response.status_code, 200)
        self.assertGreaterEqual(subscriptions_response.json()["count"], 4)

        create_subscription_response = self.client.post(
            "/software-subscriptions",
            json={
                "name": "Example Data Subscription",
                "description": "Sample data subscription",
                "point_of_contact": "Operations",
                "assigned_users": "Analysts",
                "cost_2024_2025": 1000,
                "cost_2025_2026": 1250,
                "cost_2026_2027": None,
                "renewal_time_frame": "Annual - June",
                "vendor_rep": "Vendor Rep",
                "subscribed_since": "2025",
                "status": "Active",
                "notes": "Route test record",
            },
        )
        self.assertEqual(create_subscription_response.status_code, 201)
        subscription_id = create_subscription_response.json()["id"]

        self.assertEqual(self.client.get(f"/software-subscriptions/{subscription_id}").status_code, 200)

        update_subscription_response = self.client.patch(
            f"/software-subscriptions/{subscription_id}",
            json={"status": "Pending Renewal", "cost_2026_2027": 1500},
        )
        self.assertEqual(update_subscription_response.status_code, 200)
        self.assertEqual(update_subscription_response.json()["status"], "Pending Renewal")

        invalid_subscription_response = self.client.post(
            "/software-subscriptions",
            json={
                "name": "",
                "point_of_contact": "",
                "renewal_time_frame": "",
                "status": "",
            },
        )
        self.assertEqual(invalid_subscription_response.status_code, 422)

        self.assertEqual(self.client.delete(f"/software-subscriptions/{subscription_id}").status_code, 204)

        self.assertEqual(self.client.delete(f"/users/{user_id}").status_code, 204)
        self.assertEqual(self.client.delete(f"/organizations/{organization_id}").status_code, 204)


if __name__ == "__main__":
    unittest.main()
