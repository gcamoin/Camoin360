"""Pure reconciliation for explicit operator migration; no file/database access."""

import json
from uuid import uuid4

from .application_users import (
    AccountConflict, ApplicationUser, _metadata, _validate_postgres_text, normalize_email, validate_password_hash,
)


def decode_legacy_snapshot(payload):
    """Decode captured bytes without silently losing duplicate JSON keys."""
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise AccountConflict("Duplicate legacy JSON keys require review")
            result[key] = value
        return result

    try:
        snapshot = json.loads(payload, object_pairs_hook=unique_object)
    except (TypeError, ValueError, UnicodeError) as exc:
        if isinstance(exc, AccountConflict):
            raise
        raise ValueError("Invalid legacy JSON snapshot") from None
    if not isinstance(snapshot, dict):
        raise ValueError("Legacy snapshot must be an account mapping")
    return snapshot


def reconcile_legacy_accounts(snapshots, *, default_organization_id):
    """Merge decoded snapshots from ALL instances, failing on every discrepancy.

    The caller must securely capture inputs and approve the legacy org default.
    Never call legacy _load_users(): it modifies the source during reads.
    """
    merged = {}
    ids = set()
    source_count = 0
    for snapshot in snapshots:
        source_count += 1
        if not isinstance(snapshot, dict):
            raise ValueError("Legacy snapshot must be an account mapping")
        for key, record in snapshot.items():
            if not isinstance(record, dict):
                raise ValueError("Invalid legacy account")
            # Unknown fields may contain identity/permission data. Require review.
            if set(record) - {"id", "email", "name", "password", "role", "organization_id", "modules"}:
                raise ValueError("Unrecognized legacy account fields require review")
            email = normalize_email(key)
            if normalize_email(record.get("email", key)) != email:
                raise AccountConflict("Legacy account email mismatch")
            name, role, organization_id, modules = _metadata(
                record.get("name"), record.get("role", "user"),
                record.get("organization_id", default_organization_id), record.get("modules", []),
            )
            password_hash = validate_password_hash(record.get("password"))
            legacy_id = record.get("id")
            if legacy_id is not None and (type(legacy_id) not in (str, int) or not str(legacy_id).strip()):
                raise ValueError("Unsupported legacy account ID")
            if isinstance(legacy_id, str):
                _validate_postgres_text(legacy_id)
            candidate = ApplicationUser(str(legacy_id) if legacy_id is not None else str(uuid4()),
                                        email, name, password_hash, role, organization_id, modules, legacy_id)
            previous = merged.get(email)
            if previous:
                if (previous.public_dict() != candidate.public_dict()
                        or previous.password_hash != candidate.password_hash
                        or type(previous.legacy_id) is not type(candidate.legacy_id)
                        or previous.legacy_id != candidate.legacy_id):
                    raise AccountConflict("Snapshots require manual account reconciliation")
                continue
            if candidate.id in ids:
                raise AccountConflict("Legacy account IDs require manual reconciliation")
            ids.add(candidate.id)
            merged[email] = candidate
    if source_count == 0:
        raise ValueError("At least one legacy snapshot required")
    return list(merged.values())
