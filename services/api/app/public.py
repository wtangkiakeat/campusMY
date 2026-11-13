from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, exists
from sqlalchemy.orm import Session
from .db import get_db
from .models import Course, Offering, Section, SourceDocument, ImportRun

router=APIRouter(prefix='/api/v1', tags=['courses'])


def course_dto(db, course):
    return {**{key:getattr(course,key) for key in ('id','code','name','campus','faculty','credits','years')},
        'offering_count':db.scalar(select(func.count()).select_from(Offering).where(Offering.course_id==course.id)),
        'identity_status':course.raw.get('identity_status','reviewed'),
        'sources':course.raw.get('sources',[]) or ([course.raw['source']] if course.raw.get('source') else [])}


def offering_dto(db, offering):
    sections=db.scalars(select(Section).where(Section.offering_id==offering.id).order_by(Section.type, Section.group)).all()
    return {**{key:getattr(offering,key) for key in ('id','course_id','campus','faculty','term','source')},
        'sections':[{key:getattr(section,key) for key in ('id','type','group','meetings')} for section in sections]}


@router.get('/courses')
def courses(query: str=Query(default='',max_length=200), campus: str=Query(default='',max_length=80),
            faculty: str=Query(default='',max_length=80), term: str=Query(default='',max_length=80),
            limit: int=Query(default=30,ge=1,le=100), offset: int=Query(default=0,ge=0,le=100000), db: Session=Depends(get_db)):
    statement=select(Course)
    if query.strip():
        # Escape SQL wildcard syntax so search input is treated as literal text.
        escaped=query.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
        pattern=f'%{escaped}%'
        statement=statement.where(or_(Course.code.ilike(pattern,escape='\\'),Course.name.ilike(pattern,escape='\\')))
    if campus: statement=statement.where(Course.campus==campus)
    if faculty: statement=statement.where(Course.faculty==faculty)
    if term: statement=statement.where(exists(select(Offering.id).where(Offering.course_id==Course.id,Offering.term==term)))
    total=db.scalar(select(func.count()).select_from(statement.subquery()))
    items=db.scalars(statement.order_by(Course.code,Course.id).limit(limit).offset(offset)).all()
    return {'items':[course_dto(db,item) for item in items], 'total':total,'limit':limit,'offset':offset}


@router.get('/courses/{course_id}')
def course_detail(course_id:str, db:Session=Depends(get_db)):
    course=db.get(Course,course_id)
    if not course: raise HTTPException(404,'Course not found')
    offerings=db.scalars(select(Offering).where(Offering.course_id==course.id).order_by(Offering.term)).all()
    return {**course_dto(db,course),'offerings':[offering_dto(db,o) for o in offerings]}


@router.get('/courses/{course_id}/offerings')
def offerings(course_id:str, db:Session=Depends(get_db)):
    if not db.get(Course,course_id): raise HTTPException(404,'Course not found')
    return {'items':[offering_dto(db,o) for o in db.scalars(select(Offering).where(Offering.course_id==course_id)).all()]}


@router.get('/terms')
def terms(db:Session=Depends(get_db)):
    values=db.scalars(select(Offering.term).distinct()).all()
    months={'February':2,'June':6,'October':10}
    values.sort(key=lambda v:(int(v.split()[-1]), months.get(v.split()[0],0)),reverse=True)
    return {'items':values}


@router.get('/coverage')
def coverage(db:Session=Depends(get_db)):
    latest=db.scalar(select(ImportRun).where(ImportRun.status=='published').limit(1))
    return {'institution':'UTAR','timezone':'Asia/Kuala_Lumpur',
        'courses':db.scalar(select(func.count()).select_from(Course)),
        'offerings':db.scalar(select(func.count()).select_from(Offering)),
        'sources':db.scalar(select(func.count()).select_from(SourceDocument)),
        'manifest':latest.manifest if latest else None,
        'notice':'Public source snapshots; check UTAR for registration eligibility and timetable changes.'}
