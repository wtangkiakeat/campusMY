"""Retryable maintenance tasks. Run using `python -m app.cli work`."""
from sqlalchemy import select, delete, update
from .models import Job, ContentOwner, Content, Revision, RateBucket, VerificationChallenge, now


def process_jobs(session,settings,limit=50):
    result={'processed':0,'retry':0,'needs_operator':0}
    for _ in range(limit):
        # Claim exactly one row; committing one task never releases another task's lock.
        job=session.scalar(select(Job).where(Job.status.in_(['pending','retry']),Job.run_after<=now())
                         .order_by(Job.created_at).limit(1).with_for_update(skip_locked=True))
        if not job:
            break
        job_id=job.id
        try:
            job.attempts+=1
            if job.kind=='delete-account-content':
                identifiers=list(session.scalars(select(ContentOwner.content_id).where(ContentOwner.user_id==job.payload['user_id'])).all())
                if identifiers:
                    session.execute(delete(Revision).where(Revision.content_id.in_(identifiers)))
                    session.execute(update(Content).where(Content.id.in_(identifiers)).values(body='[deleted]',advice='',status='removed'))
                job.kind='delete-supabase-user'
                job.status='needs_operator'
                result['needs_operator']+=1
            elif job.kind=='delete-supabase-user':
                job.status='needs_operator';result['needs_operator']+=1
            else:
                job.status='failed'
            session.commit()
            result['processed']+=1
        except Exception:
            session.rollback()
            job=session.get(Job,job_id)
            job.attempts+=1;job.status='retry' if job.attempts<8 else 'failed'
            job.run_after=now()+min(3600,2**job.attempts*30)
            session.commit()
            result['retry']+=1
    session.execute(delete(RateBucket).where(RateBucket.expires_at<now()-86400))
    session.execute(delete(VerificationChallenge).where(VerificationChallenge.expires_at<now()-86400))
    session.commit()
    return result
