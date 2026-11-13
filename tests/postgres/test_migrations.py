"""Real PostgreSQL migration, import, and least-privilege smoke checks."""
import os
from pathlib import Path
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text

URL = os.environ.get('CAMPUSMY_TEST_DATABASE_URL')
pytestmark = pytest.mark.skipif(not URL, reason='Run npm run test:postgres for isolated PostgreSQL')
ROOT = Path(__file__).resolve().parents[2]


def run_cli(schema, command):
    env = {**os.environ, 'CAMPUSMY_ENVIRONMENT': 'test', 'CAMPUSMY_DATABASE_URL': URL,
           'CAMPUSMY_DATABASE_SCHEMA': schema, 'CAMPUSMY_CREATE_TABLES': 'false',
           'CAMPUSMY_AUTH_JWKS_JSON': ''}
    result = subprocess.run([sys.executable, '-m', 'app.cli', command],
                            cwd=ROOT / 'services/api', env=env, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr + result.stdout
    return result.stdout


def test_postgres_migrations_seed_idempotency_and_runtime_role():
    schema = 'migration_' + uuid.uuid4().hex
    runtime_role = 'runtime_' + uuid.uuid4().hex
    engine = create_engine(URL)
    try:
        output = run_cli(schema, 'init')
        assert '689' in output
        with engine.begin() as connection:
            tables = connection.execute(text('SELECT tablename FROM pg_tables WHERE schemaname=:schema'), {'schema': schema}).scalars().all()
            assert {'courses', 'content', 'content_owners', 'memberships', 'plans', 'alembic_version'} <= set(tables)
            before = connection.execute(text(f'SELECT COUNT(*) FROM "{schema}".courses')).scalar_one()
            assert before == 689
            assert connection.execute(text(f'SELECT COUNT(*) FROM "{schema}".sections')).scalar_one() == 832
            # PUBLIC has no application-schema grant, even before role-specific grants.
            connection.execute(text(f'CREATE ROLE "{runtime_role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'))
            assert not connection.execute(text('SELECT has_schema_privilege(:role, :schema, :privilege)'),
                                          {'role': runtime_role, 'schema': schema, 'privilege': 'USAGE'}).scalar_one()
            connection.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO "{runtime_role}"'))
            connection.execute(text(f'GRANT SELECT ON "{schema}".courses TO "{runtime_role}"'))
            connection.execute(text(f'SET LOCAL ROLE "{runtime_role}"'))
            assert connection.execute(text(f'SELECT COUNT(*) FROM "{schema}".courses')).scalar_one() == before
            assert not connection.execute(text('SELECT has_table_privilege(current_user, :relation, :privilege)'),
                                          {'relation': f'{schema}.content_owners', 'privilege': 'SELECT'}).scalar_one()
        assert 'unchanged' in run_cli(schema, 'seed')
        with engine.connect() as connection:
            assert connection.execute(text(f'SELECT COUNT(*) FROM "{schema}".courses')).scalar_one() == before
    finally:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            connection.execute(text(f'DROP ROLE IF EXISTS "{runtime_role}"'))
        engine.dispose()
