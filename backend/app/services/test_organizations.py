import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import database
from backend.app.services.client_users import create_client_user, list_client_users
from backend.app.services.organizations import (
    delete_organization,
    get_organization,
    list_organizations,
    sync_organizations,
    update_organization,
    upsert_organization,
)


class OrganizationServiceTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path_patch = patch.object(
            database,
            "DATABASE_PATH",
            Path(self.temporary_directory.name) / "organizations.db",
        )
        self.database_path_patch.start()

    def tearDown(self):
        self.database_path_patch.stop()
        self.temporary_directory.cleanup()

    def test_creates_and_updates_organization_table_records(self):
        created = upsert_organization(
            {
                "account_id": "account-1",
                "client_name": "Example Capital",
                "city": "Albany",
                "state": "NY",
                "users": 1,
                "contract_expiration": "2027-06-30",
            }
        )

        updated = upsert_organization(
            {
                "account_id": "account-1",
                "client_name": "Example Capital Partners",
                "city": "Troy",
                "state": "NY",
                "users": 2,
                "contract_expiration": "2028-06-30",
            }
        )

        self.assertEqual(created.id, updated.id)
        self.assertEqual(updated.organization_name, "Example Capital Partners")
        self.assertEqual(updated.user_count, 0)
        self.assertEqual(len(list_organizations()), 1)

    def test_syncs_multiple_dynamics_organizations(self):
        organizations = sync_organizations(
            [
                {
                    "account_id": "account-1",
                    "client_name": "Alpha",
                    "city": "",
                    "state": "NY",
                    "users": 0,
                    "contract_expiration": None,
                },
                {
                    "account_id": "account-2",
                    "client_name": "Beta",
                    "city": "Boston",
                    "state": "MA",
                    "users": 3,
                    "contract_expiration": None,
                },
            ]
        )

        self.assertEqual([organization.organization_name for organization in organizations], ["Alpha", "Beta"])
        self.assertEqual(len(list_organizations()), 2)

    def test_updates_organization_fields(self):
        organization = upsert_organization(
            {
                "account_id": "account-1",
                "client_name": "Example Capital",
                "city": "Albany",
                "state": "NY",
                "users": 0,
                "contract_expiration": None,
            }
        )

        updated = update_organization(
            organization.id,
            {
                "organization_name": "Example Capital Partners",
                "city": "Troy",
                "state": "NY",
                "contract_expiration": "2028-06-30",
            },
        )

        self.assertEqual(updated.organization_name, "Example Capital Partners")
        self.assertEqual(updated.city, "Troy")
        self.assertEqual(updated.contract_expiration, "2028-06-30")
        self.assertEqual(get_organization(organization.id), updated)

    def test_deletes_organization_and_linked_users(self):
        organization = upsert_organization(
            {
                "account_id": "account-1",
                "client_name": "Example Capital",
                "city": "Albany",
                "state": "NY",
                "users": 0,
                "contract_expiration": None,
            }
        )
        create_client_user(
            {
                "organization_id": organization.id,
                "name": "Jane Client",
                "username": "jane@example.com",
                "password": "secure-password",
                "role": "user",
            }
        )

        delete_organization(organization.id)

        self.assertEqual(list_organizations(), [])
        self.assertEqual(list_client_users(), [])
