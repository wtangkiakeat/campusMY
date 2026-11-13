import json
import pytest
from sqlalchemy import select, update
from app.models import VerificationChallenge, Membership, now
from app.config import Settings
from app.auth import TokenVerifier
from fastapi import HTTPException


def test_health_public_and_missing_auth(client):
    assert client.get('/health/live').status_code==200
    assert client.get('/health/ready').json()['status']=='ready'
    assert client.get('/api/v1/me').status_code==401
    assert client.get('/api/v1/courses').json()['total']==1


@pytest.mark.parametrize('claims',[{'exp':1},{'aud':'attacker'},{'iss':'https://evil.test'},{'sub':'not-a-uuid'},{'role':'service_role'}])
def test_bad_token_claims(client,users,claims):
    _,headers=users
    assert client.get('/api/v1/me',headers=headers(**claims)).status_code==401


def test_auth_missing_configuration_fails_closed():
    verifier=TokenVerifier(Settings(supabase_url=''))
    with pytest.raises(HTTPException) as exc: verifier.verify('anything')
    assert exc.value.status_code==503


@pytest.mark.parametrize('name',['unverified','expired','suspended'])
def test_membership_required(client,users,name):
    _,headers=users
    assert client.get('/api/v1/courses/course/reviews',headers=headers(name)).status_code==403


def test_mfa_and_roles_enforced(client,users):
    _,headers=users
    assert client.get('/api/v1/admin/moderation-queue',headers=headers('alice')).status_code==403
    assert client.get('/api/v1/admin/moderation-queue',headers=headers('moderator',aal='aal1')).status_code==403
    assert client.get('/api/v1/admin/moderation-queue',headers=headers('moderator')).status_code==200


@pytest.mark.parametrize('email',['student@1utar.my.evil.test','student@utar.edu.my','student@gmail.com','not-email'])
def test_verification_exact_domain(client,users,email):
    _,headers=users
    assert client.post('/api/v1/me/university-verification/challenges',headers=headers('unverified'),json={'email':email}).status_code==422


def test_account_bound_otp_and_no_secret_leaks(client,app,users,monkeypatch):
    import app.verification as verification
    sent=[]
    monkeypatch.setattr(verification,'send_otp',lambda settings,email,code:sent.append((email,code)))
    ids,headers=users
    result=client.post('/api/v1/me/university-verification/challenges',headers=headers('unverified'),json={'email':'student@1utar.my'})
    assert result.status_code==201
    challenge=result.json()['challenge_id'];code=sent[0][1]
    assert code not in result.text
    with app.state.session_factory() as db:
        row=db.get(VerificationChallenge,challenge)
        assert code not in row.code_hash and 'student' not in row.email_hash
    assert client.post('/api/v1/me/university-verification/confirm',headers=headers('bob'),json={'challenge_id':challenge,'code':code}).status_code==400
    good=client.post('/api/v1/me/university-verification/confirm',headers=headers('unverified'),json={'challenge_id':challenge,'code':code})
    assert good.status_code==200 and good.json()['verified']
    assert client.post('/api/v1/me/university-verification/confirm',headers=headers('unverified'),json={'challenge_id':challenge,'code':code}).status_code==400
    assert client.get('/api/v1/me',headers=headers('unverified')).json()['id']==ids['unverified']


def test_otp_attempt_limit_and_expiry(client,app,users,monkeypatch):
    import app.verification as verification
    monkeypatch.setattr(verification,'send_otp',lambda *args:None)
    _,headers=users
    response=client.post('/api/v1/me/university-verification/challenges',headers=headers(),json={'email':'student@1utar.my'})
    challenge=response.json()['challenge_id']
    with app.state.session_factory() as db:
        row=db.get(VerificationChallenge,challenge);row.code_hash='invalid';db.commit()
    for _ in range(5):
        assert client.post('/api/v1/me/university-verification/confirm',headers=headers(),json={'challenge_id':challenge,'code':'111111'}).status_code==400
    with app.state.session_factory() as db: assert db.get(VerificationChallenge,challenge).attempts==5
    assert client.post('/api/v1/me/university-verification/confirm',headers=headers(),json={'challenge_id':challenge,'code':'111111'}).status_code==400
    with app.state.session_factory() as db:
        row=db.get(VerificationChallenge,challenge);row.attempts=0;row.expires_at=now()-1;db.commit()
    assert client.post('/api/v1/me/university-verification/confirm',headers=headers(),json={'challenge_id':challenge,'code':'111111'}).status_code==400


def test_no_smtp_no_challenge(client,app,users):
    app.state.settings.smtp_host=''
    _,headers=users
    assert client.post('/api/v1/me/university-verification/challenges',headers=headers(),json={'email':'student@1utar.my'}).status_code==503


def test_challenge_cooldown(client,users,monkeypatch):
    import app.verification as verification
    monkeypatch.setattr(verification,'send_otp',lambda *args:None)
    _,headers=users
    assert client.post('/api/v1/me/university-verification/challenges',headers=headers(),json={'email':'student@1utar.my'}).status_code==201
    assert client.post('/api/v1/me/university-verification/challenges',headers=headers(),json={'email':'student@1utar.my'}).status_code==429


def test_jwks_unknown_key_refresh_is_bounded_and_rotation_supported(signing_key):
    from types import SimpleNamespace
    import jwt
    from app.auth import TokenVerifier
    settings=Settings(environment='test',supabase_url='https://test-project.supabase.co')
    verifier=TokenVerifier(settings)
    known=SimpleNamespace(key_id='old-key',key=signing_key.public_key())
    rotated=SimpleNamespace(key_id='rotated-key',key=signing_key.public_key())
    class FakeKeyClient:
        def __init__(self): self.keys=[known];self.refreshes=0
        def get_signing_keys(self,refresh=False):
            if refresh:
                self.refreshes+=1;self.keys=[known,rotated]
            return self.keys
    verifier.client=FakeKeyClient()
    claims={'sub':'b52854eb-7633-410c-9f44-cfd6738ab92f','iss':settings.issuer,'aud':'authenticated','iat':now(),'exp':now()+120}
    rotated_token=jwt.encode(claims,signing_key,algorithm='RS256',headers={'kid':'rotated-key'})
    assert verifier.verify(rotated_token).id==claims['sub']
    assert verifier.client.refreshes==1
    for index in range(10):
        token=jwt.encode(claims,signing_key,algorithm='RS256',headers={'kid':f'attacker-key-{index}'})
        with pytest.raises(HTTPException): verifier.verify(token)
    assert verifier.client.refreshes==1
