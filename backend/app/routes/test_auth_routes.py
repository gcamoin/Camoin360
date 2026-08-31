import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend.app.routes import auth


class AuthRoutesTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.users_file = Path(self.temp_dir.name) / "users.json"
        self.users_file_patch = patch.object(auth, "USERS_FILE", self.users_file)
        self.users_file_patch.start()

    def tearDown(self):
        self.users_file_patch.stop()
        self.temp_dir.cleanup()

    async def test_public_signup_is_disabled(self):
        with self.assertRaises(HTTPException) as error:
            await auth.signup(
                auth.SignupRequest(
                    name="Jane User",
                    email="jane@example.com",
                    password="secure-password",
                )
            )

        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(error.exception.detail, "Account creation is restricted to the admin")

    async def test_admin_login_uses_seeded_credentials(self):
        response = await auth.login(
            auth.LoginRequest(
                email="garrett@camoinassociates.com",
                password="Roccky#5",
            )
        )

        self.assertEqual(response.email, "garrett@camoinassociates.com")

    async def test_admin_can_create_account(self):
        response = await auth.create_user(
            auth.SignupRequest(
                name="Jane User",
                email="jane@example.com",
                password="secure-password",
                modules=["main", "management", "invalid"],
            ),
            _admin={"email": "garrett@camoinassociates.com"},
        )

        self.assertEqual(response.email, "jane@example.com")
        self.assertEqual(response.name, "Jane User")
        self.assertEqual(response.modules, ["main", "management"])
        self.assertFalse(hasattr(response, "token"))

        login_response = await auth.login(
            auth.LoginRequest(
                email="jane@example.com",
                password="secure-password",
            )
        )
        self.assertEqual(login_response.email, "jane@example.com")
        self.assertEqual(login_response.modules, ["main", "management"])

    async def test_admin_can_list_update_and_delete_account(self):
        await auth.create_user(
            auth.SignupRequest(
                name="Jane User",
                email="jane@example.com",
                password="secure-password",
                modules=["main"],
            ),
            _admin={"email": "garrett@camoinassociates.com"},
        )

        users_response = await auth.list_users(_admin={"email": "garrett@camoinassociates.com"})
        self.assertEqual(
            [user.email for user in users_response.users],
            ["garrett@camoinassociates.com", "jane@example.com"],
        )

        update_response = await auth.update_user(
            "jane@example.com",
            auth.UpdateUserRequest(name="Jane Updated", modules=["prospecting"]),
            _admin={"email": "garrett@camoinassociates.com"},
        )
        self.assertEqual(update_response.name, "Jane Updated")
        self.assertEqual(update_response.modules, ["prospecting"])

        await auth.delete_user("jane@example.com", _admin={"email": "garrett@camoinassociates.com"})

        with self.assertRaises(HTTPException) as error:
            await auth.login(
                auth.LoginRequest(
                    email="jane@example.com",
                    password="secure-password",
                )
            )

        self.assertEqual(error.exception.status_code, 401)

    def test_non_admin_cannot_create_account(self):
        self.users_file.write_text(
            json.dumps(
                {
                    "jane@example.com": {
                        "name": "Jane User",
                        "email": "jane@example.com",
                        "password": auth._hash_password("secure-password"),
                    }
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaises(HTTPException) as error:
            auth.require_admin_user({"email": "jane@example.com"})

        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(error.exception.detail, "Admin access required")


if __name__ == "__main__":
    unittest.main()
