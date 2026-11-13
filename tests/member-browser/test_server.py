"""Test-only member browser fixture. No routes or bypasses are added to production.

The private signing key exists only in this process. Short-lived fixture sessions
are written to an owner-only OS temporary file consumed by the browser harness.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from uuid import uuid4

import jwt
import uvicorn
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import select

from app.config import Settings
from app.main import create_app
from app.models import Account, Membership, Course, Offering
from app.seed import import_seed


def create_fixture_app():
    output = Path(os.environ['CAMPUSMY_MEMBER_FIXTURE'])
    database = output.parent / 'member-test.db'
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    jwk.update(kid='ephemeral-member-test', use='sig', alg='RS256')
    settings = Settings(environment='test', database_url=f'sqlite:///{database}', create_tables=True,
                        cors_origins='http://127.0.0.1:3001',
                        supabase_url='https://test-project.supabase.co',
                        auth_jwks_json=json.dumps({'keys': [jwk]}),
                        otp_secret=os.urandom(32).hex())
    application = create_app(settings)
    with application.state.session_factory() as db:
        import_seed(db)
        identities = {name: str(uuid4()) for name in ['alice', 'bob', 'moderator', 'unverified']}
        for name, identifier in identities.items():
            db.add(Account(id=identifier, role='moderator' if name == 'moderator' else 'member'))
        db.flush()
        for name, identifier in identities.items():
            if name != 'unverified':
                db.add(Membership(user_id=identifier, institution='utar', email_hash=uuid4().hex * 2,
                                  status='active', expires_at=int(time.time()) + 86400))
        db.commit()
        course = db.scalar(select(Course).where(Course.code == 'UCCD1004', Course.campus == 'Kampar'))
        offering = db.scalar(select(Offering).where(Offering.course_id == course.id, Offering.term == 'June 2026'))
        if not offering:
            offering = db.scalar(select(Offering).where(Offering.course_id == course.id))
        records = {}
        for name, identifier in identities.items():
            current = int(time.time())
            claims = {'sub': identifier, 'aud': 'authenticated', 'iss': settings.issuer,
                      'iat': current, 'exp': current + 3600, 'role': 'authenticated',
                      'aal': 'aal2' if name == 'moderator' else 'aal1',
                      'email': name + '@example.invalid'}
            token = jwt.encode(claims, key, algorithm='RS256', headers={'kid': 'ephemeral-member-test'})
            user = {'id': identifier, 'aud': 'authenticated', 'role': 'authenticated',
                    'email': name + '@example.invalid', 'app_metadata': {'provider': 'email', 'providers': ['email']},
                    'user_metadata': {}, 'identities': [], 'created_at': '2026-01-01T00:00:00Z'}
            records[name] = {'id': identifier, 'session': {'access_token': token,
                'refresh_token': 'test-only-refresh-' + uuid4().hex, 'token_type': 'bearer',
                'expires_in': 3600, 'expires_at': current + 3600, 'user': user}}
        fixture = {'users': records, 'course': {'id': course.id, 'code': course.code,
            'name': course.name, 'term': offering.term, 'offering_id': offering.id},
            'warning': 'Simulated provider sessions signed by an ephemeral test-only key. Not a real Supabase/Google integration test.'}
    output.write_text(json.dumps(fixture))
    output.chmod(0o600)
    return application


if __name__ == '__main__':
    uvicorn.run(create_fixture_app(), host='127.0.0.1', port=8001, log_level='warning')
