"""Independent fail-closed checks. No production signing key or login bypass is used."""
from __future__ import annotations

import json
import os
import time
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import Actor, TokenVerifier, get_actor, member, moderator
from app.config import Settings
from app.db import Base, make_engine
from app.models import Account, Membership, Offering, Section, Course, RateBucket
from app.planner import validate_entries, overlaps
from app.security import rate_limit


@pytest.fixture(scope='module')
def signing_material():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key(), as_dict=True)
    public.update(kid='security-fixture', alg='RS256', use='sig')
    settings = Settings(environment='test', supabase_url='https://unit.supabase.co',
                        auth_jwks_json=json.dumps({'keys': [public]}))
    return private, settings


def signed_token(material, changes=None, remove=()):
    private, settings = material
    current = int(time.time())
    payload = {'sub': '8d00f271-7c16-49ed-b80a-cce0f67a59ea', 'iss': settings.issuer,
               'aud': 'authenticated', 'iat': current, 'exp': current + 120, 'role': 'authenticated'}
    payload.update(changes or {})
    for key in remove:
        payload.pop(key, None)
    return jwt.encode(payload, private, algorithm='RS256', headers={'kid': 'security-fixture'})


@pytest.fixture
def db():
    url = os.getenv('CAMPUSMY_TEST_DATABASE_URL', 'sqlite:///:memory:')
    schema = 'security_' + uuid4().hex if url.startswith('postgresql') else None
    settings = Settings(environment='test', database_url=url, database_schema=schema)
    engine = make_engine(settings)
    if schema:
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
        session.rollback()
    if schema:
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
    engine.dispose()


class TestJWTBoundary:
    def test_verified_subject_and_mfa_not_invented(self, signing_material):
        token = signed_token(signing_material)
        actor = TokenVerifier(signing_material[1]).verify(token)
        assert actor.id == '8d00f271-7c16-49ed-b80a-cce0f67a59ea'
        assert actor.mfa is False

    @pytest.mark.parametrize('changes', [
        {'iss': 'https://attacker.invalid/auth/v1'}, {'aud': 'another-api'},
        {'exp': 1}, {'sub': 'not-a-uuid'}, {'role': 'service_role'},
        {'nbf': int(time.time()) + 3600}, {'iat': int(time.time()) + 3600},
    ])
    def test_invalid_claims_are_rejected(self, signing_material, changes):
        with pytest.raises(HTTPException) as error:
            TokenVerifier(signing_material[1]).verify(signed_token(signing_material, changes))
        assert error.value.status_code == 401

    @pytest.mark.parametrize('claim', ['sub', 'iss', 'aud', 'iat', 'exp'])
    def test_required_claims_are_not_optional(self, signing_material, claim):
        with pytest.raises(HTTPException) as error:
            TokenVerifier(signing_material[1]).verify(signed_token(signing_material, remove=[claim]))
        assert error.value.status_code == 401

    def test_forged_signature_is_rejected(self, signing_material):
        token = signed_token(signing_material)
        header, payload, signature = token.split('.')
        forged = header + '.' + payload + '.' + ('A' if signature[0] != 'A' else 'B') + signature[1:]
        with pytest.raises(HTTPException) as error:
            TokenVerifier(signing_material[1]).verify(forged)
        assert error.value.status_code == 401

    def test_hmac_algorithm_confusion_rejected(self, signing_material):
        token = jwt.encode({'sub': str(uuid4()), 'aud': 'authenticated'}, 'attacker-secret-with-at-least-32-bytes',
                           algorithm='HS256', headers={'kid': 'security-fixture'})
        with pytest.raises(HTTPException) as error:
            TokenVerifier(signing_material[1]).verify(token)
        assert error.value.status_code == 401

    def test_unknown_key_and_malformed_token_rejected(self, signing_material):
        private, settings = signing_material
        unknown = jwt.encode({'sub': str(uuid4())}, private, algorithm='RS256', headers={'kid': 'unknown'})
        for token in [unknown, 'not.a.token', '', 'Bearer arbitrary']:
            with pytest.raises(HTTPException) as error:
                TokenVerifier(settings).verify(token)
            assert error.value.status_code == 401

    def test_missing_configuration_does_not_enable_guest_auth(self):
        with pytest.raises(HTTPException) as error:
            TokenVerifier(Settings(environment='test')).verify('arbitrary')
        assert error.value.status_code == 503

    def test_inline_test_keys_cannot_be_used_in_production(self, signing_material):
        with pytest.raises(ValueError):
            Settings(environment='production', auth_jwks_json=signing_material[1].auth_jwks_json)

    def test_user_editable_metadata_cannot_grant_operator_role(self, db, signing_material):
        from types import SimpleNamespace
        from fastapi.security import HTTPAuthorizationCredentials
        from starlette.requests import Request
        token = signed_token(signing_material, {'user_metadata': {'is_admin': True, 'role': 'admin'},
                                               'app_metadata': {'role': 'admin'}})
        application = SimpleNamespace(state=SimpleNamespace(token_verifier=TokenVerifier(signing_material[1])))
        request = Request({'type': 'http', 'app': application})
        actor = get_actor(request, credentials=HTTPAuthorizationCredentials(scheme='Bearer', credentials=token), db=db)
        assert db.get(Account, actor.id).role == 'member'



class TestMembershipBoundary:
    @pytest.mark.parametrize('state', ['missing', 'expired', 'inactive', 'suspended', 'deleted'])
    def test_restricted_accounts_cannot_access_community(self, db, state):
        actor = Actor(str(uuid4()))
        account = Account(id=actor.id, suspended=state == 'suspended', deleted=state == 'deleted')
        db.add(account)
        db.flush()
        if state != 'missing':
            db.add(Membership(user_id=actor.id, email_hash=uuid4().hex * 2,
                              status='revoked' if state == 'inactive' else 'active',
                              expires_at=int(time.time()) - 10 if state == 'expired' else int(time.time()) + 3600))
        db.commit()
        with pytest.raises(HTTPException) as error:
            member(actor=actor, db=db)
        assert error.value.status_code == 403

    def test_role_and_mfa_both_required(self, db):
        identity = str(uuid4())
        db.add(Account(id=identity, role='member'))
        db.flush()
        db.add(Membership(user_id=identity, email_hash=uuid4().hex * 2,
                          status='active', expires_at=int(time.time()) + 3600))
        db.commit()
        with pytest.raises(HTTPException):
            moderator(actor=Actor(identity, mfa=True), db=db)
        account = db.get(Account, identity)
        account.role = 'moderator'
        db.commit()
        with pytest.raises(HTTPException):
            moderator(actor=Actor(identity, mfa=False), db=db)
        assert moderator(actor=Actor(identity, mfa=True), db=db).id == identity


class TestPlannerTrustBoundary:
    @pytest.fixture
    def academic(self, db):
        course = Course(id=str(uuid4()), code='TEST1001', name='Testing', campus='Kampar')
        db.add(course)
        db.flush()
        offering = Offering(id=str(uuid4()), course_id=course.id, campus='Kampar', term='June 2026')
        db.add(offering)
        db.flush()
        section = Section(id=str(uuid4()), offering_id=offering.id, type='L', group='1',
                          meetings=[{'day': 'Mon', 'start': 600, 'end': 660, 'weekNumbers': [1, 3]}])
        db.add(section)
        db.commit()
        return offering, section

    def test_cross_campus_and_term_selections_rejected(self, db, academic):
        offering, section = academic
        entry = {'id': 'entry', 'offering': offering.id, 'sectionIds': [section.id]}
        for campus, term in [('Sungai Long', 'June 2026'), ('Kampar', 'October 2026')]:
            with pytest.raises(HTTPException) as error:
                validate_entries(db, [entry], campus, term)
            assert error.value.status_code == 422

    def test_mismatched_section_and_duplicate_entries_rejected(self, db, academic):
        offering, section = academic
        other = Offering(id=str(uuid4()), course_id=offering.course_id, campus='Kampar', term='October 2026')
        db.add(other)
        db.commit()
        with pytest.raises(HTTPException):
            validate_entries(db, [{'id': 'entry', 'offering': other.id, 'sectionIds': [section.id]}], 'Kampar', 'October 2026')
        entry = {'id': 'entry', 'offering': offering.id, 'sectionIds': [section.id]}
        with pytest.raises(HTTPException):
            validate_entries(db, [entry, entry], 'Kampar', 'June 2026')
        with pytest.raises(HTTPException):
            validate_entries(db, [dict(entry, sectionIds=[section.id, section.id])], 'Kampar', 'June 2026')

    def test_week_aware_boundary_has_no_false_conflict(self):
        first = {'day': 'Mon', 'start': 600, 'end': 660, 'weekNumbers': [1, 3]}
        assert not overlaps(first, {'day': 'Mon', 'start': 600, 'end': 660, 'weekNumbers': [2, 4]})
        assert not overlaps(first, {'day': 'Mon', 'start': 660, 'end': 720, 'weekNumbers': [1]})
        assert overlaps(first, {'day': 'Mon', 'start': 659, 'end': 720, 'weekNumbers': [1]})
        assert overlaps(first, {'day': 'Mon', 'start': 600, 'end': 660, 'weekNumbers': []})

    @pytest.mark.parametrize('meeting', [
        {'day': 'Mon', 'start': True, 'end': 660},
        {'day': 'Mon', 'start': 660, 'end': 600},
        {'day': 'Mon', 'start': 600, 'end': 1441},
        {'day': 'Mon', 'start': 600, 'end': 660, 'weekNumbers': [True]},
        {'day': 'Mon', 'start': 600, 'end': 660, 'weekNumbers': [53]},
        {'day': 'Invalid', 'start': 600, 'end': 660},
    ])
    def test_invalid_manual_meeting_cannot_be_persisted(self, db, meeting):
        entry = {'id': 'manual', 'manual': True, 'name': 'A real manual event', 'meetings': [meeting]}
        with pytest.raises(HTTPException) as error:
            validate_entries(db, [entry], 'Kampar', 'June 2026')
        assert error.value.status_code == 422


class TestDurableAbuseLimits:
    def test_limits_survive_failed_request_rollback(self, db):
        actor = str(uuid4())
        for _ in range(3):
            rate_limit(db, actor, 'security-test', 3, 86400)
            db.rollback()
        with pytest.raises(HTTPException) as error:
            rate_limit(db, actor, 'security-test', 3, 86400)
        assert error.value.status_code == 429
        assert int(error.value.headers['Retry-After']) > 0
        assert db.query(RateBucket).filter(RateBucket.key.like('security-test:%')).one().count == 3


class TestModerationRaceBoundary:
    def test_student_edit_invalidates_old_moderation_decision(self, db, monkeypatch):
        from app import admin
        from app.models import Content, ContentOwner, ModerationAction
        from app.schemas import ModerationInput
        author, operator = str(uuid4()), str(uuid4())
        db.add_all([Account(id=author), Account(id=operator, role='moderator')])
        db.flush()
        post = Content(id=str(uuid4()), kind='review', body='Original text reviewed by operator', overall=4)
        db.add(post)
        db.flush()
        db.add(ContentOwner(content_id=post.id, user_id=author, review_context='isolated-context'))
        db.commit()
        identifier = post.id

        def concurrent_edit(*args):
            # Reproduce an edit arriving after the handler loads the old version.
            with Session(db.bind) as second:
                current = second.get(Content, identifier)
                current.body = 'New text that has never been reviewed'
                current.version += 1
                second.commit()

        monkeypatch.setattr(admin, 'rate_limit', concurrent_edit)
        decision = ModerationInput(content_id=identifier, action='publish', reason='Read and approved', version=1)
        with pytest.raises(HTTPException) as error:
            admin.moderate(decision, actor=Actor(operator, mfa=True), db=db)
        assert error.value.status_code == 409
        db.expire_all()
        current = db.get(Content, identifier)
        assert current.status == 'pending'
        assert current.version == 2
        assert current.body == 'New text that has never been reviewed'
        assert db.query(ModerationAction).count() == 0

    def test_anonymous_serialization_contains_no_private_author_identifier(self, db):
        from app.models import Content, ContentOwner
        from app.content import serialize
        author, reader = str(uuid4()), str(uuid4())
        db.add_all([Account(id=author), Account(id=reader)])
        db.flush()
        post = Content(kind='review', body='An actual anonymous course experience', overall=4, status='published')
        db.add(post)
        db.flush()
        db.add(ContentOwner(content_id=post.id, user_id=author, review_context='private-context'))
        db.commit()
        public = serialize(db, post, Actor(reader))
        assert public['author'] == 'Anonymous'
        assert public['is_mine'] is False
        assert author not in json.dumps(public)
        assert not ({'user_id', 'author_id', 'owner_id', 'email', 'review_context'} & public.keys())

    def test_block_mutation_returns_no_cross_course_author_correlator(self, db):
        from app.models import Content, ContentOwner
        from app.schemas import BlockInput
        from app.community import block
        author, reader = str(uuid4()), str(uuid4())
        db.add_all([Account(id=author), Account(id=reader)])
        db.flush()
        posts = []
        for number in range(2):
            post = Content(kind='tip', body='Preparation advice ' + str(number), status='published')
            db.add(post)
            db.flush()
            db.add(ContentOwner(content_id=post.id, user_id=author))
            posts.append(post.id)
        db.commit()
        first = block(BlockInput(content_id=posts[0]), actor=Actor(reader), db=db)
        second = block(BlockInput(content_id=posts[1]), actor=Actor(reader), db=db)
        assert first == second == {'status': 'blocked'}
        assert 'id' not in first


class TestPostgresChallengeRace:
    @pytest.mark.skipif(not os.getenv('CAMPUSMY_TEST_DATABASE_URL'), reason='Requires real PostgreSQL row locks')
    def test_parallel_requests_cannot_bypass_challenge_cooldown(self, db, monkeypatch):
        from concurrent.futures import ThreadPoolExecutor
        import threading
        import app.verification as verification
        actor = Actor(str(uuid4()))
        db.add(Account(id=actor.id))
        db.commit()
        settings = Settings(environment='test', otp_secret='test-otp-key-with-more-than-32-characters')
        launch = threading.Barrier(2)
        sent = []
        sent_lock = threading.Lock()

        def send(*args):
            with sent_lock:
                sent.append(args[1])
            # Keep the winner between cooldown check and commit long enough to
            # expose a second unchecked sender if the account lock is removed.
            time.sleep(0.12)

        monkeypatch.setattr(verification, 'send_otp', send)

        def request_code():
            with Session(db.bind) as session:
                launch.wait(timeout=5)
                try:
                    verification.create_challenge(session, actor, 'student@1utar.my', settings, 'shared-campus-ip')
                    return 201
                except HTTPException as error:
                    session.rollback()
                    return error.status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: request_code(), range(2)))
        assert sorted(results) == [201, 429]
        assert len(sent) == 1
