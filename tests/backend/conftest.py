import json
import os
import sys
from pathlib import Path
from uuid import uuid4
import pytest
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'services'/'api'))
from app.config import Settings
from app.main import create_app
from app.db import Base
from app.models import Account, Membership, Course, Offering, Section, now
from fastapi.testclient import TestClient


@pytest.fixture(scope='session')
def signing_key():
    return rsa.generate_private_key(public_exponent=65537,key_size=2048)


@pytest.fixture
def app(tmp_path,signing_key):
    jwk=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(signing_key.public_key()))
    jwk.update(kid='test-key',alg='RS256',use='sig')
    url=os.environ.get('CAMPUSMY_TEST_DATABASE_URL') or f'sqlite:///{tmp_path}/test.db'
    schema='test_'+uuid4().hex if url.startswith('postgresql') else None
    settings=Settings(environment='test',database_url=url,database_schema=schema,create_tables=False,
        supabase_url='https://test-project.supabase.co',auth_jwks_json=json.dumps({'keys':[jwk]}),
        otp_secret='test-secret-'+'x'*40,smtp_host='smtp.test',smtp_from='test@example.com')
    application=create_app(settings)
    if schema:
        with application.state.engine.begin() as conn: conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    Base.metadata.create_all(application.state.engine)
    with application.state.session_factory() as db:
        db.add(Course(id='course',code='UCCD1004',name='Programming Concepts',campus='Kampar',faculty='FICT'))
        db.flush()
        db.add(Offering(id='offering',course_id='course',campus='Kampar',term='June 2026',faculty='FICT',source='https://fict.utar.edu.my/test.pdf'))
        db.flush()
        db.add(Section(id='section',offering_id='offering',type='L',group='1',meetings=[{'day':'Mon','start':600,'end':720,'weekNumbers':[1,2],'room':'KB1','lecturer':'Test lecturer'}]))
        db.commit()
    yield application
    if schema:
        with application.state.engine.begin() as conn: conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    application.state.engine.dispose()


@pytest.fixture
def client(app):
    with TestClient(app) as client: yield client


@pytest.fixture
def users(app,signing_key):
    identities={name:str(uuid4()) for name in ('alice','bob','moderator','unverified','suspended','expired')}
    with app.state.session_factory() as db:
        for name,identifier in identities.items():
            db.add(Account(id=identifier,role='moderator' if name=='moderator' else 'member',suspended=name=='suspended'))
        db.flush()
        for name,identifier in identities.items():
            if name!='unverified':
                db.add(Membership(user_id=identifier,email_hash=uuid4().hex,status='active',expires_at=now()-10 if name=='expired' else now()+3600))
        db.commit()
    def headers(name='alice',**overrides):
        payload={'sub':identities[name],'aud':'authenticated','iss':app.state.settings.issuer,'iat':now(),'exp':now()+3600,'role':'authenticated','aal':'aal2' if name=='moderator' else 'aal1'}
        payload.update(overrides)
        token=jwt.encode(payload,signing_key,algorithm='RS256',headers={'kid':'test-key'})
        return {'Authorization':'Bearer '+token}
    return identities,headers
