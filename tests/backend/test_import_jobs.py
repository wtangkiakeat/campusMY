import json
import os
from concurrent.futures import ThreadPoolExecutor
import pytest
from sqlalchemy import select, text
from app.models import ImportRun, Course, Job, Account, Content, ContentOwner, Revision
from app.seed import import_seed
from app.jobs import process_jobs


def test_seed_versions_keep_previous_source_snapshot(app,tmp_path):
    target=tmp_path/'seed.json'
    original={'courses':[{'id':'course','institution':'utar','code':'UCCD1004','name':'Original name','campus':'Kampar','faculty':'FICT','credits':None,'years':[],'raw':{'source':'https://utar.edu.my/first'}}],
        'manifest':{'version':'first'}}
    target.write_text(json.dumps(original))
    with app.state.session_factory() as db:
        assert import_seed(db,target)['status']=='imported'
        assert import_seed(db,target)['status']=='unchanged'
        changed=json.loads(json.dumps(original));changed['courses'][0]['name']='Updated name'
        changed['courses'][0]['raw']['source']='https://utar.edu.my/second';changed['manifest']['version']='second'
        target.write_text(json.dumps(changed))
        assert import_seed(db,target)['status']=='imported'
        runs=db.scalars(select(ImportRun)).all()
        assert len(runs)==2
        snapshots={run.manifest['version']:run.snapshot for run in runs}
        assert snapshots['first']['courses'][0]['name']=='Original name'
        assert snapshots['second']['courses'][0]['name']=='Updated name'
        assert db.get(Course,'course').name=='Updated name'


@pytest.mark.skipif(not os.environ.get('CAMPUSMY_TEST_DATABASE_URL'),reason='Requires actual PostgreSQL row locks')
def test_job_workers_claim_one_transaction_at_a_time(app,users):
    identities,_=users
    with app.state.session_factory() as db:
        for index in range(8):
            db.add(Job(kind='delete-account-content',payload={'user_id':identities['alice']}))
        db.commit()
    def worker():
        with app.state.session_factory() as db:
            return process_jobs(db,app.state.settings,limit=8)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:worker(),range(2)))
    assert sum(result['processed'] for result in results)==8
    with app.state.session_factory() as db:
        jobs=db.scalars(select(Job)).all()
        assert all(job.status=='needs_operator' and job.attempts==1 for job in jobs)


def test_additive_migration_preserves_preexisting_import_manifest(tmp_path):
    """Exercise the real old->new revision path rather than metadata.create_all."""
    import subprocess
    import sys
    from pathlib import Path
    from uuid import uuid4
    from sqlalchemy import create_engine, MetaData, Table
    root=Path(__file__).resolve().parents[2]
    url=os.environ.get('CAMPUSMY_TEST_DATABASE_URL') or f'sqlite:///{tmp_path}/migration.db'
    schema='upgrade_'+uuid4().hex if url.startswith('postgresql') else None
    env={**os.environ,'CAMPUSMY_ENVIRONMENT':'test','CAMPUSMY_DATABASE_URL':url,
         'CAMPUSMY_DATABASE_SCHEMA':schema or '', 'CAMPUSMY_AUTH_JWKS_JSON':''}
    if not schema: env.pop('CAMPUSMY_DATABASE_SCHEMA',None)
    engine=create_engine(url)
    def migrate(revision):
        result=subprocess.run([sys.executable,'-m','alembic','-c','alembic.ini','upgrade',revision],
            cwd=root/'services'/'api',env=env,capture_output=True,text=True)
        assert result.returncode==0,result.stdout+result.stderr
    try:
        migrate('dda0ac174cd1')
        old=Table('import_runs',MetaData(),autoload_with=engine,schema=schema)
        assert 'snapshot' not in old.c
        with engine.begin() as connection:
            connection.execute(old.insert().values(id='historical-import',digest='d'*64,status='published',manifest={'version':'old'}))
        migrate('head')
        upgraded=Table('import_runs',MetaData(),autoload_with=engine,schema=schema)
        with engine.connect() as connection:
            row=connection.execute(select(upgraded).where(upgraded.c.id=='historical-import')).mappings().one()
            assert row['manifest']=={'version':'old'} and row['snapshot']=={}
    finally:
        if schema:
            with engine.begin() as connection: connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()
