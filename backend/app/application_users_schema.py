"""Additive auth-only DDL and fail-closed catalog verification. No provisioning."""

import re


class AuthSchemaError(RuntimeError):
    """Never include catalog contents, connection strings, or records in errors."""


_CHECKS = {
    '(length(btrim(name)) > 0)', '(length(password_hash) > 0)',
    '(length(btrim(role)) > 0)', '(organization_id > 0)',
    "((email = lower(btrim(email))) AND (email ~~ '%@%'::text) AND (email !~ '[[:space:]]'::text))",
    "((legacy_id IS NULL) OR (jsonb_typeof(legacy_id) = ANY (ARRAY['string'::text, 'number'::text])))",
}


def _canonical(expression):
    # Match PostgreSQL's deparsed expressions, preserving literals/operators.
    # Do not remove parentheses, casts or change case: these affect semantics.
    return re.sub(r"\s+", " ", expression or "").strip()


def initialize_application_users_schema(connection):
    connection.execute("SELECT pg_advisory_xact_lock(360028102027)")
    # Legacy organization IDs need not exist in the client-management directory.
    # Do not cascade directory deletions into authentication identities.
    connection.execute("""
        CREATE TABLE IF NOT EXISTS application_users (
            id TEXT PRIMARY KEY,
            legacy_id JSONB,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
            password_hash TEXT NOT NULL CHECK (length(password_hash) > 0),
            role TEXT NOT NULL CHECK (length(btrim(role)) > 0),
            organization_id BIGINT NOT NULL CHECK (organization_id > 0),
            modules TEXT[] NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT application_users_normalized_email CHECK (
                email = lower(btrim(email)) AND email LIKE '%@%'
                AND email !~ '[[:space:]]'
            ),
            CONSTRAINT application_users_legacy_id_type CHECK (
                legacy_id IS NULL OR jsonb_typeof(legacy_id) IN ('string', 'number')
            )
        )
    """)
    connection.execute("""CREATE UNIQUE INDEX IF NOT EXISTS application_users_single_admin
                          ON application_users (role) WHERE role = 'admin'""")
    connection.execute("""
        CREATE TABLE IF NOT EXISTS application_auth_bootstrap (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            administrator_id TEXT NOT NULL UNIQUE REFERENCES application_users(id) ON DELETE RESTRICT,
            signing_key_digest TEXT NOT NULL CHECK (signing_key_digest ~ '^[0-9a-f]{64}$'),
            completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    verify_application_users_schema(connection)


def verify_application_users_schema(connection, *, expected_schema=None):
    """Read catalogs only; refuse drift instead of silently repairing tables."""
    columns_expected = {
        "application_users": {"id": "text", "legacy_id": "jsonb", "email": "text", "name": "text",
                              "password_hash": "text", "role": "text", "organization_id": "bigint",
                              "modules": "text[]", "created_at": "timestamp with time zone",
                              "updated_at": "timestamp with time zone"},
        "application_auth_bootstrap": {"singleton": "integer", "administrator_id": "text",
                                       "signing_key_digest": "text", "completed_at": "timestamp with time zone"},
    }
    relations = {}
    for table, expected in columns_expected.items():
        relation = connection.execute("""
            SELECT c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity, n.nspname
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.oid = to_regclass(%s)
        """, (table,)).fetchone()
        if not relation or relation["relkind"] != "r" or relation["relrowsecurity"] or relation["relforcerowsecurity"]:
            raise AuthSchemaError("Authentication schema missing or incompatible")
        if expected_schema is not None and relation["nspname"] != expected_schema:
            raise AuthSchemaError("Authentication schema identity mismatch")
        relations[table] = relation["oid"]
        columns = connection.execute("""
            SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
                   pg_get_expr(d.adbin, d.adrelid) AS default_expression
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE a.attrelid=%s AND a.attnum>0 AND NOT a.attisdropped
        """, (relation["oid"],)).fetchall()
        if ({c["attname"]: c["type"] for c in columns} != expected
                or any(not c["attnotnull"] for c in columns if c["attname"] != "legacy_id")):
            raise AuthSchemaError("Authentication columns incompatible")
        for column in columns:
            name, default = column["attname"], column["default_expression"]
            if name in {"created_at", "updated_at", "completed_at"}:
                valid = default in {"CURRENT_TIMESTAMP", "now()"}
            elif name == "modules":
                valid = default == "'{}'::text[]"
            else:
                valid = default is None
            if not valid:
                raise AuthSchemaError("Authentication defaults incompatible")
        constraints = connection.execute("""
            SELECT contype, convalidated, condeferrable, confrelid, confdeltype,
                   COALESCE((to_jsonb(c)->>'conenforced')::boolean,true) AS enforced,
                   pg_get_expr(conbin,conrelid) AS expression,
                   ARRAY(SELECT a.attname FROM unnest(conkey) WITH ORDINALITY k(n,i)
                         JOIN pg_attribute a ON a.attrelid=conrelid AND a.attnum=k.n ORDER BY k.i) AS columns,
                   ARRAY(SELECT a.attname FROM unnest(confkey) WITH ORDINALITY k(n,i)
                         JOIN pg_attribute a ON a.attrelid=confrelid AND a.attnum=k.n ORDER BY k.i) AS foreign_columns
            FROM pg_constraint c WHERE conrelid=%s
        """, (relation["oid"],)).fetchall()
        expected_checks = (_CHECKS if table == "application_users" else
                           {"(singleton = 1)", "(signing_key_digest ~ '^[0-9a-f]{64}$'::text)"})
        if ({_canonical(c["expression"]) for c in constraints if c["contype"] == "c"} != expected_checks
                or any(not c["convalidated"] or not c["enforced"] or c["condeferrable"] for c in constraints)):
            raise AuthSchemaError("Authentication CHECK definitions incompatible")
        indexes = connection.execute("""
            SELECT indisunique, indisprimary, indisvalid, indisready, indimmediate,
                   pg_get_expr(indpred,indrelid) AS predicate,
                   ARRAY(SELECT pg_get_indexdef(indexrelid,k,false)
                         FROM generate_series(1,indnkeyatts) k) AS columns
            FROM pg_index WHERE indrelid=%s
        """, (relation["oid"],)).fetchall()
        signatures = set()
        for index in indexes:
            if index["indisunique"]:
                if not (index["indisvalid"] and index["indisready"] and index["indimmediate"]):
                    raise AuthSchemaError("Authentication unique index invalid")
                signatures.add((tuple(index["columns"]), index["predicate"], index["indisprimary"]))
        expected_indexes = ({(("id",), None, True), (("email",), None, False),
                             (("role",), "(role = 'admin'::text)", False)} if table == "application_users"
                            else {(("singleton",), None, True), (("administrator_id",), None, False)})
        if signatures != expected_indexes:
            raise AuthSchemaError("Authentication unique indexes incompatible")
        if table == "application_auth_bootstrap":
            foreign = [c for c in constraints if c["contype"] == "f"]
            if (len(foreign) != 1 or foreign[0]["columns"] != ["administrator_id"]
                    or foreign[0]["foreign_columns"] != ["id"]
                    or foreign[0]["confrelid"] != relations["application_users"] or foreign[0]["confdeltype"] != "r"):
                raise AuthSchemaError("Administrator bootstrap reference incompatible")
        elif any(c["contype"] == "f" for c in constraints):
            raise AuthSchemaError("Authentication foreign keys incompatible")
        modified = connection.execute("""SELECT
            EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=%s AND NOT tgisinternal) OR
            EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class=%s) AS modified""",
                                      (relation["oid"], relation["oid"])).fetchone()["modified"]
        if modified:
            raise AuthSchemaError("Authentication triggers or rules require review")
