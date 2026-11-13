import argparse
import json
import os
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import Session
from alembic.config import Config
from alembic import command
from .config import Settings
from .db import make_engine
from .models import Account
from .seed import import_seed
from .jobs import process_jobs


def main():
    parser=argparse.ArgumentParser(description='CampusMY database and maintenance operations')
    parser.add_argument('command',choices=['init','seed','work','grant-role'])
    parser.add_argument('--user-id')
    parser.add_argument('--role',choices=['member','moderator','admin'])
    args=parser.parse_args()
    settings=Settings()
    root=Path(__file__).resolve().parents[1]
    if args.command=='init':
        config=Config(str(root/'alembic.ini'))
        config.set_main_option('script_location',str(root/'alembic'))
        command.upgrade(config,'head')
    engine=make_engine(settings)
    with Session(engine) as session:
        if args.command in ('init','seed'):
            result=import_seed(session)
            print(json.dumps({'status':result['status'],'counts':result['manifest'].get('counts',{})}))
        elif args.command=='work':
            print(json.dumps(process_jobs(session,settings)))
        elif args.command=='grant-role':
            from uuid import UUID
            if not args.user_id or not args.role: parser.error('--user-id and --role are required')
            user_id=str(UUID(args.user_id))
            account=session.get(Account,user_id)
            if not account: parser.error('User must sign in before assigning an operator role')
            account.role=args.role;session.commit()
            print('Role updated. Privileged API access also requires active UTAR membership and MFA.')
    engine.dispose()


if __name__=='__main__': main()
