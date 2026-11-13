import re
from alembic import context
from sqlalchemy import text
from app.config import Settings
from app.db import Base, make_engine
from app import models

settings=Settings()
target_metadata=Base.metadata

def run_migrations_online():
    engine=make_engine(settings)
    with engine.connect() as connection:
        if settings.database_schema:
            if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}',settings.database_schema):
                raise ValueError('Invalid application schema')
            connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{settings.database_schema}"'))
            connection.commit()
        context.configure(connection=connection,target_metadata=target_metadata,
                          version_table_schema=settings.database_schema,
                          compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
        if settings.database_schema and engine.dialect.name=='postgresql':
            schema=settings.database_schema
            connection.execute(text(f'REVOKE ALL ON SCHEMA "{schema}" FROM PUBLIC'))
            for role in ('anon','authenticated'):
                exists=connection.scalar(text('SELECT 1 FROM pg_roles WHERE rolname=:role'),{'role':role})
                if exists:
                    connection.execute(text(f'REVOKE ALL ON SCHEMA "{schema}" FROM "{role}"'))
                    connection.execute(text(f'REVOKE ALL ON ALL TABLES IN SCHEMA "{schema}" FROM "{role}"'))
                    connection.execute(text(f'ALTER DEFAULT PRIVILEGES IN SCHEMA "{schema}" REVOKE ALL ON TABLES FROM "{role}"'))
            connection.commit()
    engine.dispose()

if context.is_offline_mode():
    context.configure(url=settings.database_url,target_metadata=target_metadata,literal_binds=True)
    with context.begin_transaction(): context.run_migrations()
else:
    run_migrations_online()
