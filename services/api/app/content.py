from fastapi import HTTPException
from sqlalchemy import select, func, or_, and_
from .models import Content, ContentOwner, Vote, Block, Account, Course, Offering, Revision, Notification, now

KINDS = {'reviews':'review', 'exam-tips':'tip', 'comments':'comment'}


def kind_for(value):
    kind = KINDS.get(value)
    if not kind:
        raise HTTPException(404, 'Content type not found')
    return kind


def get_content(db, identifier, kind=None):
    obj = db.get(Content, identifier)
    if not obj or (kind and obj.kind != kind):
        raise HTTPException(404, 'Content not found')
    return obj


def owner_id(db, obj):
    return db.scalar(select(ContentOwner.user_id).where(ContentOwner.content_id == obj.id))


def require_owner(db, obj, actor):
    if owner_id(db, obj) != actor.id:
        raise HTTPException(404, 'Content not found')
    return obj


def is_blocked(db, first, second):
    return bool(db.scalar(select(Block.id).where(or_(
        and_(Block.user_id == first, Block.target_id == second),
        and_(Block.user_id == second, Block.target_id == first)))))


def require_visible(db, obj, actor):
    owner = owner_id(db, obj)
    account = db.get(Account, owner) if owner else None
    if obj.status != 'published' or not account or account.deleted or is_blocked(db, actor.id, owner):
        raise HTTPException(404, 'Content not found')
    if obj.parent_id:
        require_visible(db, get_content(db, obj.parent_id), actor)
    return obj


def serialize(db, obj, actor=None):
    count = db.scalar(select(func.count()).select_from(Vote).where(Vote.content_id == obj.id)) or 0
    result = {key:getattr(obj,key) for key in ('id','kind','course_id','parent_id','campus','term','body','advice',
        'overall','difficulty','workload','assessment_type','status','version','created_at','updated_at')}
    result.update(author='Anonymous', helpful_count=count,
        is_mine=bool(actor and owner_id(db,obj) == actor.id),
        has_voted=bool(actor and db.scalar(select(Vote.id).where(Vote.content_id == obj.id, Vote.user_id == actor.id))))
    return result


def check_context(db, course_id, campus, term):
    course = db.get(Course, course_id)
    if not course:
        raise HTTPException(404, 'Course not found')
    if course.campus != campus:
        raise HTTPException(422, 'Course campus does not match')
    if course.raw.get('identity_status') == 'needs_review':
        raise HTTPException(409, 'This course identity needs operator review before contributions can be accepted')
    # Historical reviews may use documented terms absent from the current timetable.
    import re
    if not re.fullmatch(r'(February|June|October) 20\d{2}', term):
        raise HTTPException(422, 'Use a supported trimester and year, for example June 2026')
    from datetime import datetime, timezone
    if int(term[-4:]) > datetime.now(timezone.utc).year or int(term[-4:]) < 2000:
        raise HTTPException(422, 'Review term must be a past or current year')
    return course


def snapshot(obj):
    return {key:getattr(obj,key) for key in ('body','advice','overall','difficulty','workload',
        'assessment_type','status','version','updated_at')}


def notify(db, user_id, content_id, message):
    db.add(Notification(user_id=user_id, content_id=content_id, message=message))
