import math
from fastapi import HTTPException
from sqlalchemy import select
from .models import Offering, Section, LegacyMapping, Course

DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']


def validate_meeting(value):
    if not isinstance(value,dict):
        raise HTTPException(422, 'Invalid meeting')
    start, end = value.get('start'), value.get('end')
    if isinstance(start,bool) or isinstance(end,bool) or not isinstance(start,(int,float)) or not isinstance(end,(int,float)):
        raise HTTPException(422, 'Meeting times must be minutes after midnight')
    if not math.isfinite(start) or not math.isfinite(end) or not 0 <= start < end <= 1440 or value.get('day') not in DAYS:
        raise HTTPException(422, 'Invalid meeting time or weekday')
    weeks = value.get('weekNumbers',[])
    if not isinstance(weeks,list) or len(weeks)>52 or any(isinstance(w,bool) or not isinstance(w,int) or not 1 <= w <= 52 for w in weeks):
        raise HTTPException(422, 'Invalid teaching weeks')
    for name in ('room','lecturer','mode'):
        if name in value and (not isinstance(value[name],str) or len(value[name])>300):
            raise HTTPException(422, f'Invalid meeting {name}')
    return dict(value, weekNumbers=sorted(set(weeks)))


def mapped(db, identifier, kind):
    if not isinstance(identifier,str) or len(identifier)>100:
        return None
    legacy = db.scalar(select(LegacyMapping).where(LegacyMapping.legacy_id == identifier, LegacyMapping.kind == kind))
    return legacy.canonical_id if legacy else identifier


def validate_entries(db, entries, campus, term, allow_unresolved=False):
    normalized=[]
    ids=set()
    for entry in entries:
        if not isinstance(entry,dict) or not isinstance(entry.get('id'),str) or not 1 <= len(entry['id'])<=100 or entry['id'] in ids:
            raise HTTPException(422, 'Each timetable entry needs a unique bounded ID')
        ids.add(entry['id'])
        if 'manual' in entry and not isinstance(entry['manual'],bool):
            raise HTTPException(422, 'Manual flag must be a boolean')
        if entry.get('manual'):
            if not isinstance(entry.get('name'),str) or not 1<=len(entry['name'].strip())<=200:
                raise HTTPException(422, 'Manual classes need a name')
            meetings=entry.get('meetings')
            if not isinstance(meetings,list) or not 1<=len(meetings)<=30:
                raise HTTPException(422, 'Manual classes need 1–30 meetings')
            normalized.append({'id':entry['id'],'manual':True,'name':entry['name'].strip(),
                'code':str(entry.get('code',''))[:40], 'meetings':[validate_meeting(m) for m in meetings]})
            continue
        offering_id = mapped(db, entry.get('offering'),'offering')
        offering = db.get(Offering,offering_id) if offering_id else None
        section_ids = entry.get('sectionIds')
        if not isinstance(section_ids,list) or not 1<=len(section_ids)<=20:
            raise HTTPException(422, 'Select at least one class section')
        canonical=[mapped(db,s,'section') for s in section_ids]
        sections=[db.get(Section,s) if s else None for s in canonical]
        unresolved=not offering or any(not s for s in sections)
        if unresolved and allow_unresolved:
            normalized.append({'id':entry['id'],'offering':str(entry.get('offering',''))[:100],
                'sectionIds':[str(s)[:100] for s in section_ids], 'unresolved':True,
                'name':str(entry.get('name','Unresolved course'))[:200]})
            continue
        if unresolved or offering.campus!=campus or offering.term!=term or any(s.offering_id!=offering.id for s in sections):
            raise HTTPException(422, 'Offering and section selection must match the plan campus and term')
        if len(set(canonical))!=len(canonical):
            raise HTTPException(422, 'Duplicate section selection')
        normalized.append({'id':entry['id'],'offering':offering.id,'sectionIds':canonical})
    return normalized


def overlaps(a,b):
    return a['day']==b['day'] and a['start']<b['end'] and b['start']<a['end'] and (
        not a.get('weekNumbers') or not b.get('weekNumbers') or bool(set(a['weekNumbers']) & set(b['weekNumbers'])))


def conflicts(db, entries):
    meetings=[]
    for entry in entries:
        if entry.get('unresolved'):
            continue
        if entry.get('manual'):
            mm=entry['meetings']
        else:
            mm=[m for s in entry['sectionIds'] for m in db.get(Section,s).meetings]
        meetings.extend((entry['id'],m) for m in mm)
    hits=[]
    for i,(first,a) in enumerate(meetings):
        for second,b in meetings[i+1:]:
            if first!=second and overlaps(a,b):
                pair=sorted([first,second])
                if pair not in hits:
                    hits.append(pair)
    return hits


def serialize_plan(db, plan):
    hydrated=[]
    for entry in plan.entries:
        if entry.get('manual'):
            hydrated.append({**entry,'sectionIds':[]})
        elif entry.get('unresolved'):
            hydrated.append({**entry,'code':'','meetings':[]})
        else:
            offering=db.get(Offering,entry['offering'])
            if not offering:
                hydrated.append({**entry,'name':'Unresolved course','code':'','meetings':[],'unresolved':True})
                continue
            course=db.get(Course,offering.course_id)
            mm=[m for identifier in entry['sectionIds'] if (section:=db.get(Section,identifier)) for m in section.meetings]
            hydrated.append({**entry,'name':course.name or course.code,'code':course.code,
                'course_id':course.id,'meetings':mm})
    return {**{key:getattr(plan,key) for key in ('id','name','campus','term','version','updated_at')},
            'entries':hydrated,'conflicts':conflicts(db,plan.entries)}
