"""Cache-aside safety net for the singleton Dataverse Account total only."""
import asyncio
import logging

from .cache import AsyncStaleCache
from .maintenance_dynamics import MaintenanceDynamicsClient, TOTAL_SOURCE
from .maintenance_observations import MaintenanceConfig, _db, _save_total, _total_snapshot, utc_now

logger = logging.getLogger(__name__)
total_fallback_cache = AsyncStaleCache()


async def missing_total_snapshot():
    """Coalesce missing-snapshot requests within this web process, including failures.

    Recheck PostgreSQL inside the cache lock in case the worker has just committed.
    Existing snapshots, including stale valid snapshots, never need this fallback.
    A short memory cache also preserves successful lookups if persistence fails.
    """
    async def load():
        try:
            snapshot = await asyncio.to_thread(_db, _total_snapshot)
            if snapshot is not None:
                # The normal read model computes snapshot staleness. This raced worker
                # snapshot is usable even if stale; do not replace it with unknown.
                snapshot["is_stale"] = (utc_now() - snapshot["fetched_at"]).total_seconds() >= MaintenanceConfig.from_env().total_seconds
                return {"snapshot": {**snapshot, "maximum_source_age_hours": 24}, "persisted": True}
        except Exception:
            logger.warning("Maintenance total fallback cache read unavailable")
        try:
            async with MaintenanceDynamicsClient() as client:
                value = await client.total_count()
        except Exception:
            logger.warning("Maintenance total fallback Dynamics lookup unavailable")
            return {"snapshot": None, "persisted": False}
        fetched_at = utc_now()
        persisted = True
        try:
            await asyncio.to_thread(_db, _save_total, value, fetched_at)
        except Exception:
            persisted = False
            logger.warning("Maintenance total fallback persistence unavailable; valid Dynamics count retained")
        return {"snapshot": {"value": value, "fetched_at": fetched_at, "source": TOTAL_SOURCE,
                             "maximum_source_age_hours": 24, "is_stale": False}, "persisted": persisted}

    # One shared key covers every Home view, days range, cursor and page size.
    # Failed lookups are briefly cached too, preventing repeated outage requests.
    return await total_fallback_cache.get("account", load, ttl_seconds=60, stale_seconds=0)
