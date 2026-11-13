import hashlib
import hmac
import secrets
import smtplib
import ssl
from email.message import EmailMessage
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from .models import Membership, VerificationChallenge, Account, now, uid
from .security import rate_limit


def digest(secret, value):
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def send_otp(settings, address, code):
    if not settings.smtp_host or not settings.smtp_from:
        raise HTTPException(503, 'Email delivery is not configured. Ask the operator to configure SMTP.')
    message = EmailMessage()
    message['Subject'] = 'Verify your UTAR email — CampusMY'
    message['From'] = settings.smtp_from
    message['To'] = address
    message.set_content(f'Your CampusMY verification code is {code}. It expires in 10 minutes. Do not share this code. If you did not request it, ignore this message.')
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            if settings.smtp_starttls:
                server.starttls(context=ssl.create_default_context())
            if settings.smtp_username:
                server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(message)
    except (OSError, smtplib.SMTPException):
        raise HTTPException(503, 'Email delivery is temporarily unavailable. Please try again later.')


def create_challenge(db, actor, email, settings, ip):
    if len(settings.otp_secret) < 32:
        raise HTTPException(503, 'University email verification is not configured')
    email = email.strip().lower()
    if email.count('@') != 1 or email.rsplit('@', 1)[1] != '1utar.my':
        raise HTTPException(422, 'Use your UTAR student email ending in @1utar.my')
    email_hash = digest(settings.otp_secret, 'email:' + email)
    rate_limit(db, actor.id, 'otp-account', 5, 3600)
    rate_limit(db, ip, 'otp-ip', 30, 3600)
    rate_limit(db, email_hash, 'otp-email', 5, 3600)
    # Serialize challenge issuance per account; SQLite serializes writes, PostgreSQL takes this row lock.
    db.scalar(select(Account).where(Account.id == actor.id).with_for_update())
    recent = db.scalar(select(VerificationChallenge).where(VerificationChallenge.user_id == actor.id,
                                                        VerificationChallenge.created_at > now() - 60))
    if recent:
        raise HTTPException(429, 'Wait one minute before requesting another code', headers={'Retry-After':'60'})
    challenge_id = uid()
    code = f'{secrets.randbelow(1_000_000):06d}'
    challenge = VerificationChallenge(id=challenge_id, user_id=actor.id, email_hash=email_hash,
        code_hash=digest(settings.otp_secret, f'{challenge_id}:{actor.id}:{code}'), expires_at=now()+600)
    # Delivery is synchronous so plaintext OTPs never enter persistent job payloads.
    send_otp(settings, email, code)
    db.execute(update(VerificationChallenge).where(VerificationChallenge.user_id == actor.id).values(consumed=True))
    db.add(challenge)
    db.commit()
    return {'challenge_id':challenge_id, 'expires_in':600, 'message':'A verification code was sent. Check your UTAR email.'}


def confirm_challenge(db, actor, challenge_id, code, settings):
    if len(settings.otp_secret) < 32:
        raise HTTPException(503, 'University email verification is not configured')
    challenge = db.scalar(select(VerificationChallenge).where(VerificationChallenge.id == challenge_id,
        VerificationChallenge.user_id == actor.id).with_for_update())
    if not challenge or challenge.consumed or challenge.expires_at <= now() or challenge.attempts >= 5:
        raise HTTPException(400, 'Invalid or expired verification challenge')
    expected = digest(settings.otp_secret, f'{challenge_id}:{actor.id}:{code}')
    if not hmac.compare_digest(challenge.code_hash, expected):
        db.execute(update(VerificationChallenge).where(VerificationChallenge.id == challenge.id).values(attempts=VerificationChallenge.attempts+1))
        db.commit()
        raise HTTPException(400, 'Invalid or expired verification code')
    claimed = db.scalar(select(Membership).where(Membership.email_hash == challenge.email_hash))
    if claimed and claimed.user_id != actor.id:
        raise HTTPException(409, 'This email cannot verify another account. Contact support for recovery.')
    result = db.execute(update(VerificationChallenge).where(VerificationChallenge.id == challenge.id,
        VerificationChallenge.consumed.is_(False), VerificationChallenge.attempts < 5,
        VerificationChallenge.expires_at > now()).values(consumed=True))
    if not result.rowcount:
        db.rollback()
        raise HTTPException(400, 'Invalid or expired verification challenge')
    membership = db.get(Membership, actor.id)
    if not membership:
        membership = Membership(user_id=actor.id, email_hash=challenge.email_hash, expires_at=now()+365*86400)
        db.add(membership)
    else:
        membership.email_hash = challenge.email_hash
        membership.status = 'active'
        membership.verified_at = now()
        membership.expires_at = now()+365*86400
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'This email cannot verify another account. Contact support for recovery.')
    return {'status':membership.status, 'verified':True, 'expires_at':membership.expires_at,
            'label':'UTAR email verified'}
