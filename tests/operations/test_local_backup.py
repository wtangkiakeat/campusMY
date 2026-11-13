"""Rehearse backup/restore of actual application tables, including private data and tombstones."""
from pathlib import Path
import importlib.util
import os
import sqlite3

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Account, Membership, Course, Content, ContentOwner, Plan, now

spec = importlib.util.spec_from_file_location('backup_local', Path(__file__).resolve().parents[2] / 'scripts/backup_local.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def test_application_database_restores_private_records_and_deletion_tombstone(tmp_path):
    live, saved, restored = [tmp_path / name for name in ['live.db', 'backup.db', 'restored.db']]
    engine = create_engine(f'sqlite:///{live}')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add_all([Account(id='member'), Account(id='deleted-member', deleted=True), Course(id='course', code='TEST', name='Backup test subject', campus='Kampar')])
        db.flush()
        db.add(Membership(user_id='member', email_hash='private-hash', expires_at=now() + 1000))
        db.add(Plan(id='plan', user_id='member', name='Private plan', campus='Kampar', term='June 2026', entries=[]))
        db.add(Content(id='review', kind='review', course_id='course', campus='Kampar', term='June 2026', body='Anonymous study advice', overall=4))
        db.flush()
        db.add(ContentOwner(content_id='review', user_id='member', review_context='course|Kampar|June 2026'))
        db.commit()
    engine.dispose()
    backup.copy_database(live, saved)
    assert os.stat(saved).st_mode & 0o077 == 0
    # Original data can be unavailable; restore must depend on the backup, not the live file.
    live.unlink()
    backup.copy_database(saved, restored)
    recovered = create_engine(f'sqlite:///{restored}')
    with Session(recovered) as db:
        assert db.get(Plan, 'plan').user_id == 'member'
        assert db.get(Membership, 'member').email_hash == 'private-hash'
        assert db.get(ContentOwner, 'review').user_id == 'member'
        assert db.get(Content, 'review').body == 'Anonymous study advice'
        assert db.get(Account, 'deleted-member').deleted is True
    recovered.dispose()


def test_backup_refuses_overwrite_same_path_missing_source_and_corruption(tmp_path):
    live, output = tmp_path / 'live.db', tmp_path / 'output.db'
    with sqlite3.connect(live) as connection:
        connection.execute('create table test (value integer)')
    with pytest.raises(ValueError):
        backup.copy_database(live, live)
    with pytest.raises(ValueError):
        backup.copy_database(tmp_path / 'missing.db', output)
    output.write_text('keep this file')
    with pytest.raises(FileExistsError):
        backup.copy_database(live, output)
    assert output.read_text() == 'keep this file'
    corrupt = tmp_path / 'corrupt.db'
    corrupt.write_text('not a database')
    target = tmp_path / 'failed.db'
    with pytest.raises(sqlite3.DatabaseError):
        backup.copy_database(corrupt, target)
    assert not target.exists()
