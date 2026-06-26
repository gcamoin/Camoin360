import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app import database
from backend.app.services.client_users import (
    create_client_user,
    delete_client_user,
    get_client_user,
    list_client_users,
    reset_client_user_password,
    update_client_user,
    verify_password,
)
from backend.app.services.organizations import list_organizations, upsert_organization


class ClientUserServiceTest(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path_patch = patch.object(
            database,
            "DATABASE_PATH",
            Path(self.temporary_directory.name) / "client-users.db",
        )
        self.database_path_patch.start()
        self.organization = upsert_organization(
            {
                "account_id": "account-1",
                "client_name": "Example Capital",
                "city": "Albany",
                "state": "NY",
                "users": 0,
                "contract_expiration": None,
            }
        )

    def tearDown(self):
        self.database_path_patch.stop()
        self.temporary_directory.cleanup()

    def test_creates_user_with_hashed_password_and_updates_organization_count(self):
        created = create_client_user(
            {
                "organization_id": self.organization.id,
                "name": "Jane Client",
                "username": "Jane.Client",
                "password": "secure-password",
                "role": "admin",
            }
        )

        self.assertEqual(created.organization_id, self.organization.id)
        self.assertEqual(created.username, "jane.client")
        self.assertEqual(created.role, "admin")
        self.assertNotEqual(created.password_hash, "secure-password")
        self.assertTrue(verify_password("secure-password", created.password_hash))
        self.assertEqual(list_organizations()[0].user_count, 1)

    def test_lists_and_fetches_users_by_organization(self):
        created = create_client_user(
            {
                "organization_id": self.organization.id,
                "name": "Jane Client",
                "username": "jane@example.com",
                "password": "secure-password",
                "role": "user",
            }
        )

        self.assertEqual(list_client_users(self.organization.id), [created])
        self.assertEqual(get_client_user(created.id), created)

    def test_updates_user_and_resets_password(self):
        created = create_client_user(
            {
                "organization_id": self.organization.id,
                "name": "Jane Client",
                "username": "jane@example.com",
                "password": "secure-password",
                "role": "user",
            }
        )

        updated = update_client_user(
            created.id,
            {
                "name": "Jane Updated",
                "username": "updated@example.com",
                "role": "manager",
            },
        )
        reset = reset_client_user_password(created.id, "new-password")

        self.assertEqual(updated.name, "Jane Updated")
        self.assertEqual(updated.username, "updated@example.com")
        self.assertEqual(updated.role, "manager")
        self.assertNotEqual(reset.password_hash, created.password_hash)
        self.assertTrue(verify_password("new-password", reset.password_hash))

    def test_deletes_user_and_updates_organization_count(self):
        created = create_client_user(
            {
                "organization_id": self.organization.id,
                "name": "Jane Client",
                "username": "jane@example.com",
                "password": "secure-password",
                "role": "user",
            }
        )

        delete_client_user(created.id)

        self.assertEqual(list_client_users(), [])
        self.assertEqual(list_organizations()[0].user_count, 0)
