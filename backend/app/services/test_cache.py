import asyncio
import unittest

from .cache import AsyncStaleCache


class AsyncStaleCacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_coalesces_concurrent_cache_misses(self):
        cache = AsyncStaleCache()
        load_count = 0

        async def loader():
            nonlocal load_count
            load_count += 1
            await asyncio.sleep(0.01)
            return {"value": load_count}

        results = await asyncio.gather(
            cache.get("key", loader, ttl_seconds=10, stale_seconds=10),
            cache.get("key", loader, ttl_seconds=10, stale_seconds=10),
            cache.get("key", loader, ttl_seconds=10, stale_seconds=10),
        )

        self.assertEqual(results, [{"value": 1}, {"value": 1}, {"value": 1}])
        self.assertEqual(load_count, 1)

    async def test_invalidate_forces_reload(self):
        cache = AsyncStaleCache()
        load_count = 0

        async def loader():
            nonlocal load_count
            load_count += 1
            return load_count

        self.assertEqual(await cache.get("accounts", loader, ttl_seconds=10, stale_seconds=10), 1)
        cache.invalidate("accounts")
        self.assertEqual(await cache.get("accounts", loader, ttl_seconds=10, stale_seconds=10), 2)


if __name__ == "__main__":
    unittest.main()
