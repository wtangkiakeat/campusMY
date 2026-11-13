import hashlib
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from .models import RateBucket, now


def rate_limit(db, identity: str, action: str, maximum: int, seconds: int):
    """Database-backed fixed window. Atomic increments persist even when a route fails."""
    current = now()
    window = current // seconds
    digest = hashlib.sha256(f'{action}:{identity}:{window}'.encode()).hexdigest()
    key = f'{action}:{digest}'
    row = db.get(RateBucket, key)
    if not row:
        try:
            with db.begin_nested():
                db.add(RateBucket(key=key, count=0, expires_at=(window + 1) * seconds))
                db.flush()
        except IntegrityError:
            pass
    result = db.execute(update(RateBucket).where(RateBucket.key == key, RateBucket.count < maximum).values(count=RateBucket.count + 1))
    db.commit()
    if not result.rowcount:
        raise HTTPException(429, 'Too many requests. Please try again later.',
                            headers={'Retry-After':str((window + 1) * seconds - current)})


def bounded_text(value):
    # Content remains plain text; escaping belongs to each presentation context.
    if '\x00' in value:
        raise HTTPException(422, 'Null characters are not permitted')
    return value
