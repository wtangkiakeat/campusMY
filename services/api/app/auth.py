import json
import threading
import time
from dataclasses import dataclass
from uuid import UUID
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .db import get_db
from .models import Account, Membership, now

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Actor:
    id: str
    mfa: bool = False


class TokenVerifier:
    def __init__(self, settings):
        self.settings = settings
        self.client = None
        self.refresh_lock = threading.Lock()
        self.last_unknown_refresh = 0.0
        if settings.supabase_url and not settings.auth_jwks_json:
            self.client = jwt.PyJWKClient(
                f'{settings.supabase_url.rstrip("/")}/auth/v1/.well-known/jwks.json',
                cache_keys=False, cache_jwk_set=True, lifespan=300, timeout=5,
            )

    def verify(self, token):
        if not self.settings.supabase_url:
            raise HTTPException(503, 'Authentication is not configured. Configure Supabase to sign in.')
        try:
            if len(token) > 16384:
                raise ValueError('Access token exceeds size limit')
            header = jwt.get_unverified_header(token)
            if header.get('alg') not in ('RS256', 'ES256') or not isinstance(header.get('kid'),str) or not 1 <= len(header['kid']) <= 128:
                raise ValueError('Unsupported signing algorithm')
            if self.settings.auth_jwks_json:
                keyset = json.loads(self.settings.auth_jwks_json)
                keys = [key for key in keyset['keys'] if key.get('kid') == header['kid']]
                if len(keys) != 1:
                    raise ValueError('Unknown signing key')
                key = jwt.PyJWK.from_dict(keys[0]).key
            else:
                keys = self.client.get_signing_keys()
                matches = [candidate for candidate in keys if candidate.key_id == header['kid']]
                if not matches:
                    # Unknown key IDs cannot force an unbounded remote fetch on every request.
                    with self.refresh_lock:
                        if time.monotonic() - self.last_unknown_refresh >= 30:
                            self.last_unknown_refresh = time.monotonic()
                            keys = self.client.get_signing_keys(refresh=True)
                    matches = [candidate for candidate in keys if candidate.key_id == header['kid']]
                if len(matches) != 1:
                    raise ValueError('Unknown signing key')
                key = matches[0].key
            claims = jwt.decode(token, key, algorithms=['RS256','ES256'],
                                audience=self.settings.jwt_audience, issuer=self.settings.issuer,
                                options={'require':['exp','iat','sub','iss','aud']}, leeway=5)
            identifier = str(UUID(claims['sub']))
            if claims.get('role') not in (None, 'authenticated'):
                raise ValueError('Invalid session role')
            return Actor(id=identifier, mfa=claims.get('aal') == 'aal2')
        except (jwt.PyJWTError, ValueError, KeyError, TypeError):
            raise HTTPException(401, 'Invalid or expired access token', headers={'WWW-Authenticate':'Bearer'})


def get_actor(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)):
    if not credentials:
        raise HTTPException(401, 'Sign in to continue', headers={'WWW-Authenticate':'Bearer'})
    actor = request.app.state.token_verifier.verify(credentials.credentials)
    account = db.get(Account, actor.id)
    if not account:
        account = Account(id=actor.id)
        db.add(account)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            account = db.get(Account, actor.id)
    if account.deleted:
        raise HTTPException(403, 'This account has been deleted')
    return actor


def active_account(actor, db):
    account = db.get(Account, actor.id)
    if not account or account.deleted or account.suspended:
        raise HTTPException(403, 'Account access is restricted')
    return account


def member(actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    active_account(actor, db)
    membership = db.get(Membership, actor.id)
    if not membership or membership.status != 'active' or membership.expires_at <= now():
        raise HTTPException(403, 'Verify your UTAR email to access the student community')
    return actor


def moderator(actor: Actor = Depends(member), db: Session = Depends(get_db)):
    account = active_account(actor, db)
    if account.role not in ('moderator','admin'):
        raise HTTPException(403, 'Moderator access required')
    if not actor.mfa:
        raise HTTPException(403, 'Multi-factor authentication required')
    return actor
