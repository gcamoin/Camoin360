"""Protected auth-only operator commands. No defaults, JSON access, or startup import."""

import argparse
import json
import os
import sys

import psycopg
from psycopg.rows import dict_row

from ..application_users_schema import initialize_application_users_schema, verify_application_users_schema
from ..database import _CompatConnection
from ..services.application_administrator import bootstrap_administrator
from ..services.application_auth_configuration import require_auth_configuration


class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError("Invalid operator arguments")


def main(argv=None):
    try:
        parser = _Parser(description=__doc__)
        parser.add_argument("command", choices=["prepare-schema", "verify-schema", "bootstrap-admin"])
        parser.add_argument("--database-url-env", required=True)
        parser.add_argument("--expected-database", required=True)
        parser.add_argument("--expected-schema", required=True)
        parser.add_argument("--confirm-bootstrap", action="store_true")
        args = parser.parse_args(argv)
        url = os.environ.get(args.database_url_env)
        if not url:
            raise ValueError("Explicit database target required")
        if args.command == "bootstrap-admin" and not args.confirm_bootstrap:
            raise ValueError("Explicit bootstrap confirmation required")
        with psycopg.connect(url, row_factory=dict_row, autocommit=True, connect_timeout=5) as raw:
            with raw.transaction():
                if args.command == "verify-schema":
                    raw.execute("SET TRANSACTION READ ONLY")
                raw.execute("SET LOCAL statement_timeout='30s'")
                raw.execute("SET LOCAL lock_timeout='5s'")
                identity = raw.execute("SELECT current_database() AS database, current_schema() AS schema").fetchone()
                if identity != {"database": args.expected_database, "schema": args.expected_schema}:
                    raise ValueError("Database identity mismatch")
                connection = _CompatConnection(raw)
                if args.command == "prepare-schema":
                    initialize_application_users_schema(connection)
                else:
                    verify_application_users_schema(connection, expected_schema=args.expected_schema)
                if args.command == "bootstrap-admin":
                    configuration = require_auth_configuration({**os.environ, "DATABASE_URL": url})
                    bootstrap_administrator(connection, name=os.environ["CAMOIN360_BOOTSTRAP_NAME"],
                                            email=os.environ["CAMOIN360_BOOTSTRAP_EMAIL"],
                                            password=os.environ["CAMOIN360_BOOTSTRAP_PASSWORD"],
                                            organization_id=int(os.environ["CAMOIN360_BOOTSTRAP_ORGANIZATION_ID"]),
                                            signing_key=configuration.secret_key)
        print(json.dumps({"status": "complete", "operation": args.command}))
        return 0
    except KeyboardInterrupt:
        print('{"status":"interrupted"}')
        return 130
    except Exception:
        # Driver errors may contain complete rows or credential-bearing DSNs.
        print('{"status":"error","reason":"auth_operator_operation_refused"}')
        return 2


if __name__ == "__main__":
    sys.exit(main())
