"""Required shared configuration for PostgreSQL authentication and HS256 JWTs."""

from dataclasses import dataclass, field
from urllib.parse import urlsplit


@dataclass(frozen=True)
class AuthConfiguration:
    secret_key: str = field(repr=False)
    database_url: str = field(repr=False)


def require_auth_configuration(environment):
    """No development defaults or per-process generated signing keys."""
    secret = environment.get("AUTH_SECRET_KEY", "")
    if (not isinstance(secret, str) or len(secret.strip().encode()) < 32
            or secret != secret.strip() or len(set(secret)) < 8):
        raise ValueError("AUTH_SECRET_KEY must contain at least 32 bytes")
    database_url = environment.get("DATABASE_URL", "")
    try:
        parsed = urlsplit(database_url)
        valid_target = parsed.scheme in {"postgres", "postgresql"} and parsed.hostname and parsed.path.strip("/")
    except (TypeError, ValueError):
        valid_target = False
    if not valid_target:
        raise ValueError("PostgreSQL DATABASE_URL with explicit host and database required")
    return AuthConfiguration(secret, database_url)
