from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy import select, update, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .auth import Actor, get_actor, member, active_account
from .db import get_db
from .models import Account, Membership, Content, ContentOwner, Plan, ImportReceipt, Job, Notification, Block, Vote, VerificationChallenge, Revision, Report, Appeal, ModerationAction, now
from .schemas import ChallengeInput, ConfirmInput, PlanInput, PlanEdit, PlanImport, ReadInput
from .verification import create_challenge, confirm_challenge
from .planner import validate_entries, serialize_plan
from .content import serialize
from .security import rate_limit

router=APIRouter(prefix='/api/v1',tags=['accounts'])


def membership_dto(db,actor):
    membership=db.get(Membership,actor.id)
    if not membership: return None
    return {'status':membership.status,'verified':membership.status=='active' and membership.expires_at>now(),
            'expires_at':membership.expires_at,'label':'UTAR email verified'}


def own_content(db,actor):
    objects=db.scalars(select(Content).join(ContentOwner,ContentOwner.content_id==Content.id)
        .where(ContentOwner.user_id==actor.id).order_by(Content.created_at.desc()).limit(200)).all()
    return [serialize(db,obj,actor) for obj in objects]


@router.get('/me')
def me(actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    account=db.get(Account,actor.id)
    return {'id':actor.id,'role':account.role,'mfa':actor.mfa,'suspended':account.suspended,
            'membership':membership_dto(db,actor),'content':own_content(db,actor)}


@router.get('/me/content')
def my_content(actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    return {'items':own_content(db,actor)}


@router.post('/me/university-verification/challenges',status_code=201)
def challenge(body:ChallengeInput,request:Request,actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    active_account(actor,db)
    return create_challenge(db,actor,str(body.email),request.app.state.settings,request.client.host if request.client else 'unknown')


@router.post('/me/university-verification/confirm')
def confirm(body:ConfirmInput,request:Request,actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    active_account(actor,db)
    rate_limit(db,actor.id,'otp-confirm',20,600)
    return confirm_challenge(db,actor,body.challenge_id,body.code,request.app.state.settings)


@router.get('/me/timetables')
def plans(actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    active_account(actor,db)
    values=db.scalars(select(Plan).where(Plan.user_id==actor.id).order_by(Plan.updated_at.desc())).all()
    return {'items':[serialize_plan(db,p) for p in values]}


@router.post('/me/timetables',status_code=201)
def create_plan(body:PlanInput,actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    active_account(actor,db)
    rate_limit(db,actor.id,'plan-create',30,3600)
    values=body.model_dump()
    values['entries']=validate_entries(db,body.entries,body.campus,body.term)
    plan=Plan(user_id=actor.id,**values)
    db.add(plan);db.commit()
    return serialize_plan(db,plan)


def owned_plan(db,identifier,actor):
    plan=db.get(Plan,identifier)
    if not plan or plan.user_id!=actor.id: raise HTTPException(404,'Timetable not found')
    return plan


@router.patch('/me/timetables/{plan_id}')
def edit_plan(plan_id:str,body:PlanEdit,actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    active_account(actor,db)
    plan=owned_plan(db,plan_id,actor)
    values=body.model_dump(exclude={'version'})
    values['entries']=validate_entries(db,body.entries,body.campus,body.term,allow_unresolved=True)
    result=db.execute(update(Plan).where(Plan.id==plan.id,Plan.user_id==actor.id,Plan.version==body.version)
        .values(**values,version=Plan.version+1,updated_at=now()))
    if not result.rowcount:
        db.rollback();raise HTTPException(409,'Timetable changed on another device. Reload before saving.')
    db.commit();db.refresh(plan)
    return serialize_plan(db,plan)


@router.delete('/me/timetables/{plan_id}',status_code=204)
def delete_plan(plan_id:str,actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    active_account(actor,db)
    plan=owned_plan(db,plan_id,actor);db.delete(plan);db.commit()


@router.post('/me/timetables/import')
def import_plans(body:PlanImport,actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    active_account(actor,db)
    import hashlib, json
    payload_digest=hashlib.sha256(json.dumps(body.model_dump(exclude={'key'}),sort_keys=True,separators=(',',':')).encode()).hexdigest()
    receipt=db.scalar(select(ImportReceipt).where(ImportReceipt.user_id==actor.id,ImportReceipt.key==body.key))
    if receipt:
        if receipt.result.get('payload_digest') != payload_digest:
            raise HTTPException(409,'An import key cannot be reused for different plans')
        return receipt.result['response']
    rate_limit(db,actor.id,'plan-import',10,3600)
    imported=[]
    for item in body.plans:
        values=item.model_dump()
        values['entries']=validate_entries(db,item.entries,item.campus,item.term,allow_unresolved=True)
        plan=Plan(user_id=actor.id,**values);db.add(plan);db.flush()
        imported.append(serialize_plan(db,plan))
    result={'items':imported,'message':'Plans merged. The original local copy has not been changed.'}
    db.add(ImportReceipt(user_id=actor.id,key=body.key,result={'payload_digest':payload_digest,'response':result}))
    try: db.commit()
    except IntegrityError:
        db.rollback()
        receipt=db.scalar(select(ImportReceipt).where(ImportReceipt.user_id==actor.id,ImportReceipt.key==body.key))
        if receipt:
            if receipt.result.get('payload_digest') != payload_digest:
                raise HTTPException(409,'An import key cannot be reused for different plans')
            return receipt.result['response']
        raise
    return result


@router.get('/me/blocks')
def my_blocks(actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    return {'items':[{'id':b.id} for b in db.scalars(select(Block).where(Block.user_id==actor.id)).all()]}


@router.get('/notifications')
def notifications(limit:int=Query(default=50,ge=1,le=100),actor:Actor=Depends(member),db:Session=Depends(get_db)):
    values=db.scalars(select(Notification).where(Notification.user_id==actor.id).order_by(Notification.created_at.desc()).limit(limit)).all()
    return {'items':[{key:getattr(n,key) for key in ('id','message','read','created_at')} for n in values]}


@router.patch('/notifications/{notification_id}')
def read_notification(notification_id:str,body:ReadInput,actor:Actor=Depends(member),db:Session=Depends(get_db)):
    obj=db.get(Notification,notification_id)
    if not obj or obj.user_id!=actor.id: raise HTTPException(404,'Notification not found')
    obj.read=body.read;db.commit()
    return {'id':obj.id,'read':obj.read}


@router.post('/me/export')
def export(actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    rate_limit(db,actor.id,'export',3,3600)
    import json
    maximum=5000
    owned=list(db.scalars(select(ContentOwner.content_id).where(ContentOwner.user_id==actor.id).limit(maximum+1)).all())
    if len(owned)>maximum:
        raise HTTPException(413,'Account export exceeds the synchronous limit. Contact the operator for a complete assisted export.')
    content=db.scalars(select(Content).where(Content.id.in_(owned))).all()
    def own_rows(model,fields,condition):
        rows=db.scalars(select(model).where(condition).limit(maximum+1)).all()
        if len(rows)>maximum:
            raise HTTPException(413,'Account export exceeds the synchronous limit. Contact the operator for a complete assisted export.')
        return [{key:getattr(row,key) for key in fields} for row in rows]
    result={'schema_version':1,'generated_at':now(),'account':{'id':actor.id,'membership':membership_dto(db,actor)},
        'plans':[serialize_plan(db,p) for p in db.scalars(select(Plan).where(Plan.user_id==actor.id)).all()],
        'content':[serialize(db,obj,actor) for obj in content],
        'revisions':own_rows(Revision,('id','content_id','previous','created_at'),Revision.content_id.in_(owned)),
        'reports':own_rows(Report,('id','content_id','reason','detail','status','created_at'),Report.user_id==actor.id),
        'appeals':own_rows(Appeal,('id','content_id','reason','status','created_at'),Appeal.user_id==actor.id),
        'helpful_votes':own_rows(Vote,('content_id',),Vote.user_id==actor.id),
        'blocks':own_rows(Block,('id',),Block.user_id==actor.id),
        'notifications':own_rows(Notification,('id','message','read','created_at'),Notification.user_id==actor.id),
        'moderation_of_own_content':own_rows(ModerationAction,('content_id','action','reason','created_at'),ModerationAction.content_id.in_(owned))}
    if len(json.dumps(result,ensure_ascii=False).encode())>8_000_000:
        raise HTTPException(413,'Account export exceeds the synchronous limit. Contact the operator for a complete assisted export.')
    return result



@router.post('/me/deletion-request',status_code=202)
def delete_account(actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    # Account tombstone blocks existing JWTs immediately, independent of token lifetime.
    account=db.get(Account,actor.id);account.deleted=True
    owned=list(db.scalars(select(ContentOwner.content_id).where(ContentOwner.user_id==actor.id)).all())
    if owned:
        db.execute(update(Content).where(Content.id.in_(owned)).values(status='removed',body='[deleted]',advice='',version=Content.version+1,updated_at=now()))
        # Revisions may contain personal text and are removed in the cleanup job.
    db.execute(delete(Plan).where(Plan.user_id==actor.id))
    db.execute(delete(ImportReceipt).where(ImportReceipt.user_id==actor.id))
    db.execute(delete(Membership).where(Membership.user_id==actor.id))
    db.execute(delete(VerificationChallenge).where(VerificationChallenge.user_id==actor.id))
    db.execute(delete(Notification).where(Notification.user_id==actor.id))
    db.execute(delete(Vote).where(Vote.user_id==actor.id))
    db.add(Job(kind='delete-account-content',payload={'user_id':actor.id}))
    db.commit()
    return {'status':'accepted','message':'Application access revoked and private timetables removed. Text history cleanup is queued. Auth-provider deletion requires operator completion.'}
