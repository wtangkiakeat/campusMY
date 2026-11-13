from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from .auth import Actor, moderator
from .db import get_db
from .models import Content, Report, Appeal, ModerationAction, Account, ImportRun, Notification, now
from .schemas import ModerationInput, RestrictionInput
from .content import serialize, get_content, owner_id, notify
from .security import rate_limit

router=APIRouter(prefix='/api/v1/admin',tags=['moderation'])


@router.get('/moderation-queue')
def queue(limit:int=Query(default=50,ge=1,le=100),actor:Actor=Depends(moderator),db:Session=Depends(get_db)):
    content=db.scalars(select(Content).where(Content.status=='pending').order_by(Content.created_at).limit(limit)).all()
    reports=db.scalars(select(Report).where(Report.status=='open').order_by(Report.created_at).limit(limit)).all()
    appeals=db.scalars(select(Appeal).where(Appeal.status=='open').order_by(Appeal.created_at).limit(limit)).all()
    # Include reported/appealed content for contextual decisions, with no private author/reporter IDs.
    identifiers={r.content_id for r in reports}|{a.content_id for a in appeals}
    values={c.id:c for c in content}
    values.update({c.id:c for c in db.scalars(select(Content).where(Content.id.in_(identifiers))).all()})
    return {'items':[serialize(db,c) for c in values.values()],
        'reports':[{key:getattr(r,key) for key in ('id','content_id','reason','detail','status','created_at')} for r in reports],
        'appeals':[{key:getattr(a,key) for key in ('id','content_id','reason','status','created_at')} for a in appeals]}


@router.post('/moderation-actions')
def moderate(body:ModerationInput,actor:Actor=Depends(moderator),db:Session=Depends(get_db)):
    obj=get_content(db,body.content_id)
    if obj.body=='[deleted]' and body.action=='publish': raise HTTPException(409,'Deleted content cannot be republished')
    if obj.parent_id and body.action=='publish':
        parent=get_content(db,obj.parent_id)
        if parent.status!='published': raise HTTPException(409,'Publish the parent contribution first')
    rate_limit(db,actor.id,'moderate',300,3600)
    new_status={'publish':'published','hide':'hidden','remove':'removed'}[body.action]
    changed=db.execute(update(Content).where(Content.id==obj.id,Content.version==body.version,Content.body!='[deleted]')
        .values(status=new_status,version=Content.version+1,updated_at=now()))
    if not changed.rowcount:
        db.rollback();raise HTTPException(409,'Content changed since this decision was prepared. Reload the queue.')
    db.refresh(obj)
    db.add(ModerationAction(content_id=obj.id,moderator_id=actor.id,action=body.action,reason=body.reason))
    db.execute(update(Report).where(Report.content_id==obj.id,Report.status=='open').values(status='resolved'))
    db.execute(update(Appeal).where(Appeal.content_id==obj.id,Appeal.status=='open').values(status='resolved'))
    notify(db,owner_id(db,obj),obj.id,f'Your contribution was {obj.status}: {body.reason}')
    db.commit()
    return serialize(db,obj)


@router.post('/restrictions')
def restrict(body:RestrictionInput,actor:Actor=Depends(moderator),db:Session=Depends(get_db)):
    # Resolve a reported author internally; the moderator response still excludes identity.
    obj=get_content(db,body.content_id)
    target=db.get(Account,owner_id(db,obj))
    if not target or target.id==actor.id or target.role!='member':
        raise HTTPException(403,'This account cannot be restricted through this workflow')
    target.suspended=body.suspended
    db.add(ModerationAction(content_id=obj.id,moderator_id=actor.id,action='suspend' if body.suspended else 'restore',reason=body.reason))
    db.commit()
    return {'status':'restricted' if target.suspended else 'active'}


@router.get('/imports')
def imports(actor:Actor=Depends(moderator),db:Session=Depends(get_db)):
    values=db.scalars(select(ImportRun).limit(50)).all()
    return {'items':[{'id':v.id,'digest':v.digest,'status':v.status,'manifest':v.manifest} for v in values]}
