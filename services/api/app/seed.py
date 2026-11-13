"""Idempotent import of validated public seed data. Never executes source JS."""
import hashlib
import json
from pathlib import Path
from sqlalchemy import select
from .models import Course, Offering, Section, SourceDocument, SourceObservation, ImportRun, LegacyMapping


def import_seed(session, path=None):
    path=Path(path) if path else Path(__file__).resolve().parents[3]/'data'/'seed.json'
    contents=path.read_bytes()
    if len(contents)>30_000_000: raise ValueError('Seed exceeds import limit')
    payload=json.loads(contents)
    digest=hashlib.sha256(contents).hexdigest()
    existing=session.scalar(select(ImportRun).where(ImportRun.digest==digest))
    if existing:
        if not existing.snapshot:
            existing.snapshot=payload
            session.commit()
        return {'status':'unchanged','manifest':existing.manifest}
    for name,model in [('courses',Course),('offerings',Offering),('sections',Section),('sources',SourceDocument),
                       ('observations',SourceObservation),('legacy_mappings',LegacyMapping)]:
        allowed={column.name for column in model.__table__.columns}
        for row in payload.get(name,[]):
            values={key:value for key,value in row.items() if key in allowed}
            current=session.get(model,values['id'])
            if current:
                for key,value in values.items(): setattr(current,key,value)
            else: session.add(model(**values))
        session.flush()
    manifest=payload.get('manifest',{})
    session.add(ImportRun(digest=digest,status='published',manifest=manifest,snapshot=payload))
    session.commit()
    return {'status':'imported','manifest':manifest}
