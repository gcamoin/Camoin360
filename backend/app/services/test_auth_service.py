import asyncio
import unittest
from unittest.mock import patch

from . import auth


class FakeTokenResponse:
    status_code = 200
    text = ""

    def __init__(self, token="cached-token", expires_in=3600):
        self.token = token
        self.expires_in = expires_in

    def json(self):
        return {
            "access_token": self.token,
            "expires_in": self.expires_in,
        }


class FakeTokenClient:
    request_count = 0

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, url, data):
        self.__class__.request_count += 1
        await asyncio.sleep(0)
        return FakeTokenResponse()


class AccessTokenCacheTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        FakeTokenClient.request_count = 0
        auth.reset_access_token_cache()

    async def test_reuses_valid_token(self):
        with (
            patch.object(auth, "TENANT_ID", "tenant"),
            patch.object(auth, "CLIENT_ID", "client"),
            patch.object(auth, "CLIENT_SECRET", "secret"),
            patch.object(auth, "SCOPE", "scope"),
            patch.object(auth.httpx, "AsyncClient", new=FakeTokenClient),
        ):
            first_token = await auth.get_access_token()
            second_token = await auth.get_access_token()

        self.assertEqual(first_token, "cached-token")
        self.assertEqual(second_token, "cached-token")
        self.assertEqual(FakeTokenClient.request_count, 1)

    async def test_coalesces_concurrent_refreshes(self):
        with (
            patch.object(auth, "TENANT_ID", "tenant"),
            patch.object(auth, "CLIENT_ID", "client"),
            patch.object(auth, "CLIENT_SECRET", "secret"),
            patch.object(auth, "SCOPE", "scope"),
            patch.object(auth.httpx, "AsyncClient", new=FakeTokenClient),
        ):
            tokens = await asyncio.gather(
                auth.get_access_token(),
                auth.get_access_token(),
                auth.get_access_token(),
            )

        self.assertEqual(tokens, ["cached-token", "cached-token", "cached-token"])
        self.assertEqual(FakeTokenClient.request_count, 1)


if __name__ == "__main__":
    unittest.main()
