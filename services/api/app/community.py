from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, update, delete, exists, or_, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .auth import Actor, member, get_actor, active_account
from .db import get_db
from .models import Content, ContentOwner, Course, Vote, Report, Block, Appeal, Revision, Account, now
from .schemas import ReviewInput, TipInput, ContentEdit, CommentInput, ReportInput, BlockInput, AppealInput
from .content import kind_for, get_content, owner_id, require_owner, require_visible, serialize, check_context, snapshot, notify
from .security import rate_limit, bounded_text

router=APIRouter(prefix='/api/v1',tags=['community'])


def visible_query(actor):
    blocked=exists(select(Block.id).where(or_(
        and_(Block.user_id==actor.id,Block.target_id==ContentOwner.user_id),
        and_(Block.target_id==actor.id,Block.user_id==ContentOwner.user_id))))
    return select(Content).join(ContentOwner,ContentOwner.content_id==Content.id).join(Account,Account.id==ContentOwner.user_id).where(
        Content.status=='published',Account.deleted.is_(False),~blocked)


def list_content(db,course_id,kind,actor,limit,offset,term=''):
    if not db.get(Course,course_id): raise HTTPException(404,'Course not found')
    statement=visible_query(actor).where(Content.course_id==course_id,Content.kind==kind)
    if term: statement=statement.where(Content.term==term)
    count=db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    objects=db.scalars(statement.order_by(Content.created_at.desc(),Content.id).offset(offset).limit(limit)).all()
    ratings=statement.with_only_columns(Content.overall).where(Content.overall.is_not(None)).subquery()
    score_count,average=db.execute(select(func.count(ratings.c.overall),func.avg(ratings.c.overall))).one()
    return {'items':[serialize(db,o,actor) for o in objects],'total':count,
        'stats':{'count':score_count if kind=='review' else count,
                 'average':round(float(average),2) if score_count>=3 else None}}


@router.get('/courses/{course_id}/reviews')
def reviews(course_id:str,term:str=Query(default='',max_length=80),limit:int=Query(default=20,ge=1,le=100),
            offset:int=Query(default=0,ge=0,le=10000),actor:Actor=Depends(member),db:Session=Depends(get_db)):
    return list_content(db,course_id,'review',actor,limit,offset,term)


@router.get('/courses/{course_id}/exam-tips')
def tips(course_id:str,term:str=Query(default='',max_length=80),limit:int=Query(default=20,ge=1,le=100),
         offset:int=Query(default=0,ge=0,le=10000),actor:Actor=Depends(member),db:Session=Depends(get_db)):
    return list_content(db,course_id,'tip',actor,limit,offset,term)


def create_content(db,actor,course_id,kind,body):
    check_context(db,course_id,body.campus,body.term)
    rate_limit(db,actor.id,'publish',10,3600)
    obj=Content(kind=kind,course_id=course_id,**body.model_dump())
    bounded_text(obj.body);bounded_text(obj.advice)
    db.add(obj);db.flush()
    context=f'{course_id}|{body.campus}|{body.term}' if kind=='review' else None
    db.add(ContentOwner(content_id=obj.id,user_id=actor.id,review_context=context))
    try: db.commit()
    except IntegrityError:
        db.rollback();raise HTTPException(409,'You already reviewed this course for that term. Edit your existing review.')
    return serialize(db,obj,actor)


@router.post('/courses/{course_id}/reviews',status_code=201)
def create_review(course_id:str,body:ReviewInput,actor:Actor=Depends(member),db:Session=Depends(get_db)):
    return create_content(db,actor,course_id,'review',body)


@router.post('/courses/{course_id}/exam-tips',status_code=201)
def create_tip(course_id:str,body:TipInput,actor:Actor=Depends(member),db:Session=Depends(get_db)):
    return create_content(db,actor,course_id,'tip',body)


@router.patch('/{content_type}/{content_id}')
def edit_content(content_type:str,content_id:str,body:ContentEdit,actor:Actor=Depends(member),db:Session=Depends(get_db)):
    obj=require_owner(db,get_content(db,content_id,kind_for(content_type)),actor)
    if obj.status=='removed': raise HTTPException(409,'Removed content cannot be edited. Submit an appeal.')
    if obj.kind=='review' and body.overall is None: raise HTTPException(422,'A review needs an overall rating')
    if obj.kind=='tip' and not body.assessment_type: raise HTTPException(422,'An exam tip needs an assessment type')
    if obj.kind!='review' and any(body.model_dump()[field] is not None for field in ('overall','difficulty','workload')):
        raise HTTPException(422,'Ratings apply only to course reviews')
    rate_limit(db,actor.id,'edit',30,3600)
    previous=snapshot(obj)
    if obj.version!=body.version: raise HTTPException(409,'Content changed. Reload before editing.')
    values=body.model_dump(exclude={'version'},exclude_none=True)
    bounded_text(values['body']);bounded_text(values['advice'])
    db.add(Revision(content_id=obj.id,previous=previous))
    result=db.execute(update(Content).where(Content.id==obj.id,Content.version==body.version,Content.status!='removed')
        .values(**values,status='pending',version=Content.version+1,updated_at=now()))
    if not result.rowcount:
        db.rollback();raise HTTPException(409,'Content changed. Reload before editing.')
    db.commit();db.refresh(obj)
    return serialize(db,obj,actor)


def remove_content(content_type:str,content_id:str,actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    # Owners retain a deletion path if verification expires or their account is suspended.
    obj=require_owner(db,get_content(db,content_id,kind_for(content_type)),actor)
    obj.status='removed';obj.body='[deleted]';obj.advice='';obj.version+=1;obj.updated_at=now()
    db.execute(delete(Revision).where(Revision.content_id==obj.id))
    db.commit()


@router.get('/{content_type}/{content_id}/comments')
def comments(content_type:str,content_id:str,limit:int=Query(default=30,ge=1,le=100),
             offset:int=Query(default=0,ge=0,le=10000),actor:Actor=Depends(member),db:Session=Depends(get_db)):
    kind=kind_for(content_type)
    if kind=='comment': raise HTTPException(422,'Nested comments are not supported')
    parent=require_visible(db,get_content(db,content_id,kind),actor)
    statement=visible_query(actor).where(Content.parent_id==parent.id)
    count=db.scalar(select(func.count()).select_from(statement.subquery())) or 0
    objects=db.scalars(statement.order_by(Content.created_at,Content.id).offset(offset).limit(limit)).all()
    return {'items':[serialize(db,obj,actor) for obj in objects],'total':count}



@router.post('/{content_type}/{content_id}/comments',status_code=201)
def create_comment(content_type:str,content_id:str,body:CommentInput,actor:Actor=Depends(member),db:Session=Depends(get_db)):
    kind=kind_for(content_type)
    if kind=='comment': raise HTTPException(422,'Nested comments are not supported')
    parent=require_visible(db,get_content(db,content_id,kind),actor)
    rate_limit(db,actor.id,'comment',30,3600)
    obj=Content(kind='comment',course_id=parent.course_id,parent_id=parent.id,campus=parent.campus,
                term=parent.term,body=bounded_text(body.body))
    db.add(obj);db.flush();db.add(ContentOwner(content_id=obj.id,user_id=actor.id))
    recipient=owner_id(db,parent)
    if recipient!=actor.id:
        notify(db,recipient,parent.id,'A comment was submitted on your course contribution.')
    db.commit()
    return serialize(db,obj,actor)


@router.put('/{content_type}/{content_id}/helpful')
def vote(content_type:str,content_id:str,actor:Actor=Depends(member),db:Session=Depends(get_db)):
    obj=require_visible(db,get_content(db,content_id,kind_for(content_type)),actor)
    if owner_id(db,obj)==actor.id: raise HTTPException(422,'You cannot vote on your own content')
    rate_limit(db,actor.id,'vote',120,3600)
    existing=db.scalar(select(Vote).where(Vote.content_id==obj.id,Vote.user_id==actor.id))
    if not existing:
        db.add(Vote(content_id=obj.id,user_id=actor.id))
        try: db.commit()
        except IntegrityError: db.rollback()  # Idempotent concurrent PUT.
    return serialize(db,obj,actor)


@router.delete('/{content_type}/{content_id}/helpful')
def unvote(content_type:str,content_id:str,actor:Actor=Depends(member),db:Session=Depends(get_db)):
    obj=require_visible(db,get_content(db,content_id,kind_for(content_type)),actor)
    db.execute(delete(Vote).where(Vote.content_id==obj.id,Vote.user_id==actor.id));db.commit()
    return serialize(db,obj,actor)


@router.post('/reports',status_code=201)
def report(body:ReportInput,actor:Actor=Depends(member),db:Session=Depends(get_db)):
    obj=require_visible(db,get_content(db,body.content_id),actor)
    rate_limit(db,actor.id,'report',20,3600)
    existing=db.scalar(select(Report).where(Report.content_id==obj.id,Report.user_id==actor.id,Report.reason==body.reason))
    if existing: return {'id':existing.id,'status':existing.status}
    report=Report(content_id=obj.id,user_id=actor.id,reason=body.reason,detail=bounded_text(body.detail))
    db.add(report)
    try: db.commit()
    except IntegrityError:
        db.rollback();report=db.scalar(select(Report).where(Report.content_id==obj.id,Report.user_id==actor.id,Report.reason==body.reason))
    return {'id':report.id,'status':report.status}


@router.post('/blocks',status_code=201)
def block(body:BlockInput,actor:Actor=Depends(member),db:Session=Depends(get_db)):
    obj=get_content(db,body.content_id)
    target=owner_id(db,obj)
    if target==actor.id: raise HTTPException(422,'You cannot block yourself')
    existing=db.scalar(select(Block).where(Block.user_id==actor.id,Block.target_id==target))
    if existing: return {'status':'blocked'}
    require_visible(db,obj,actor)
    rate_limit(db,actor.id,'block',30,3600)
    block=Block(user_id=actor.id,target_id=target);db.add(block)
    try: db.commit()
    except IntegrityError:
        db.rollback();block=db.scalar(select(Block).where(Block.user_id==actor.id,Block.target_id==target))
    return {'status':'blocked'}


@router.delete('/blocks/{block_id}',status_code=204)
def unblock(block_id:str,actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    obj=db.get(Block,block_id)
    if not obj or obj.user_id!=actor.id: raise HTTPException(404,'Block not found')
    db.delete(obj);db.commit()


@router.post('/appeals',status_code=201)
def appeal(body:AppealInput,actor:Actor=Depends(get_actor),db:Session=Depends(get_db)):
    obj=require_owner(db,get_content(db,body.content_id),actor)
    if obj.status not in ('hidden','removed'): raise HTTPException(422,'Only moderated content can be appealed')
    rate_limit(db,actor.id,'appeal',5,86400)
    existing=db.scalar(select(Appeal).where(Appeal.content_id==obj.id,Appeal.user_id==actor.id))
    if existing: return {'id':existing.id,'status':existing.status}
    value=Appeal(content_id=obj.id,user_id=actor.id,reason=bounded_text(body.reason));db.add(value)
    try: db.commit()
    except IntegrityError:
        db.rollback();value=db.scalar(select(Appeal).where(Appeal.content_id==obj.id,Appeal.user_id==actor.id))
    return {'id':value.id,'status':value.status}


# Register generic deletion after specific /blocks/{id} so it cannot swallow that route.
router.add_api_route('/{content_type}/{content_id}',remove_content,methods=['DELETE'],status_code=204)
