import unittest
import asyncio
import os
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.routes import accounts
from backend.app.testing_support import temporary_database
from psycopg.conninfo import conninfo_to_dict


class AuthenticationCorsTest(unittest.TestCase):
    def setUp(self):
        isolated = temporary_database()
        isolated.start()
        self.addCleanup(isolated.stop)
        from backend.app import database
        schema = conninfo_to_dict(database.DATABASE_URL)["options"].split("=", 1)[1]
        environment = patch.dict(os.environ, {"AUTH_SECRET_KEY": "synthetic-cors-signing-secret-0123456789", "AUTH_DATABASE_SCHEMA": schema})
        environment.start()
        self.addCleanup(environment.stop)
        async def idle_scheduler():
            await asyncio.Event().wait()
        scheduler = patch.object(main, "run_snapshot_scheduler", idle_scheduler)
        scheduler.start()
        self.addCleanup(scheduler.stop)

    def test_authentication_errors_are_readable_by_allowed_browser_origins(self):
        with TestClient(main.app) as client, patch.object(main, "get_user_from_token", side_effect=HTTPException(401, "Invalid token")), patch.object(accounts, "search_accounts_data_quality_from_dynamics", new=AsyncMock()) as search:
            for origin in ("http://localhost:3000", "http://127.0.0.1:3106", "https://camoin360.com"):
                for authorization in ({}, {"Authorization": "Bearer invalid"}):
                    with self.subTest(origin=origin, authorization=bool(authorization)):
                        response = client.get("/accounts/data-quality/search?enrichment_fields=true&country=United+States", headers={"Origin": origin, **authorization})
                        self.assertEqual(response.status_code, 401)
                        self.assertEqual(response.headers.get("access-control-allow-origin"), origin)
            search.assert_not_awaited()

    def test_module_denial_keeps_cors_and_authorization(self):
        with TestClient(main.app) as client, patch.object(main, "get_user_from_token", return_value={"role": "user", "modules": []}):
            response = client.get("/accounts/data-quality/search", headers={"Origin": "http://localhost:3000", "Authorization": "Bearer denied"})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.headers.get("access-control-allow-origin"), "http://localhost:3000")

    def test_untrusted_origin_is_not_allowed(self):
        with TestClient(main.app) as client:
            response = client.get("/accounts/data-quality/search", headers={"Origin": "https://untrusted.example"})
            self.assertEqual(response.status_code, 401)
            self.assertNotIn("access-control-allow-origin", response.headers)
