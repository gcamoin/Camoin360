import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any


class AsyncStaleCache:
    def __init__(self):
        self._entries: dict[str, dict[str, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._refresh_tasks: dict[str, asyncio.Task] = {}

    async def get(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        *,
        ttl_seconds: int,
        stale_seconds: int,
    ):
        now = time.monotonic()
        entry = self._entries.get(key)

        if entry and entry["fresh_until"] > now:
            return entry["value"]

        if entry and entry["stale_until"] > now:
            self._start_background_refresh(
                key,
                loader,
                ttl_seconds=ttl_seconds,
                stale_seconds=stale_seconds,
            )
            return entry["value"]

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            entry = self._entries.get(key)
            if entry and entry["fresh_until"] > now:
                return entry["value"]

            value = await loader()
            self._store(key, value, ttl_seconds, stale_seconds)
            return value

    def invalidate(self, key_prefix: str | None = None):
        if key_prefix is None:
            self._entries.clear()
            return

        matching_keys = [key for key in self._entries if key.startswith(key_prefix)]
        for key in matching_keys:
            self._entries.pop(key, None)

    def _store(self, key: str, value: Any, ttl_seconds: int, stale_seconds: int):
        now = time.monotonic()
        self._entries[key] = {
            "value": value,
            "fresh_until": now + ttl_seconds,
            "stale_until": now + ttl_seconds + stale_seconds,
        }

    def _start_background_refresh(
        self,
        key: str,
        loader: Callable[[], Awaitable[Any]],
        *,
        ttl_seconds: int,
        stale_seconds: int,
    ):
        existing_task = self._refresh_tasks.get(key)
        if existing_task and not existing_task.done():
            return

        async def refresh():
            try:
                value = await loader()
                self._store(key, value, ttl_seconds, stale_seconds)
            except Exception:
                # Keep serving the stale value. The next request can retry.
                return
            finally:
                self._refresh_tasks.pop(key, None)

        self._refresh_tasks[key] = asyncio.create_task(refresh())
