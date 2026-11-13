import json
import pytest
from sqlalchemy import select, func
from app.models import Plan, Content, ContentOwner, Revision, ImportRun, now
from app.config import Settings


def test_import_key_cannot_change_payload(client,users):
    _,headers=users
    body={'key':'reused-key-1','plans':[{'name':'First','campus':'Kampar','term':'June 2026','entries':[]}]}
    assert client.post('/api/v1/me/timetables/import',headers=headers(),json=body).status_code==200
    body['plans'][0]['name']='Different'
    assert client.post('/api/v1/me/timetables/import',headers=headers(),json=body).status_code==409


def test_export_more_than_200_content_and_revisions(client,app,users):
    ids,headers=users
    with app.state.session_factory() as db:
        for number in range(205):
            content=Content(id=f'tip-{number}',kind='tip',course_id='course',campus='Kampar',term='June 2026',body='Useful preparation advice')
            db.add(content);db.flush()
            db.add(ContentOwner(content_id=content.id,user_id=ids['alice']))
            if number==0: db.add(Revision(content_id=content.id,previous={'body':'Original advice'}))
        db.commit()
    result=client.post('/api/v1/me/export',headers=headers())
    assert result.status_code==200
    assert len(result.json()['content'])==205 and len(result.json()['revisions'])==1
    assert ids['bob'] not in result.text


def test_invalid_manual_marker(client,users):
    _,headers=users
    body={'name':'My plan','campus':'Kampar','term':'June 2026','entries':[
        {'id':'x','manual':'false','name':'Wrong marker','meetings':[{'day':'Mon','start':600,'end':700}]}]}
    assert client.post('/api/v1/me/timetables',headers=headers(),json=body).status_code==422


def test_cors_does_not_allow_arbitrary_origins(client):
    response=client.options('/api/v1/courses',headers={'Origin':'https://attacker.example','Access-Control-Request-Method':'GET'})
    assert 'access-control-allow-origin' not in response.headers
    allowed=client.options('/api/v1/courses',headers={'Origin':'http://localhost:3000','Access-Control-Request-Method':'GET'})
    assert allowed.headers['access-control-allow-origin']=='http://localhost:3000'


def test_body_limit(client,users):
    _,headers=users
    result=client.post('/api/v1/me/timetables',headers=headers(),content=json.dumps({'name':'x'*2_100_000}))
    assert result.status_code==413


@pytest.mark.parametrize('settings',[
    {'database_schema':'public'},
    {'database_schema':'app;DROP TABLE courses'},
    {'smtp_starttls':False},
    {'create_tables':True},
    {'database_url':'sqlite:///test.db'},
    {'auth_jwks_json':'{"keys":[]}'},
])
def test_production_fails_unsafe_configuration(settings):
    safe={'environment':'production','database_url':'postgresql+psycopg://host/db?sslmode=verify-full',
          'database_schema':'campusmy','supabase_url':'https://test.supabase.co','otp_secret':'x'*40,
          'cors_origins':'https://campusmy.example'}
    safe.update(settings)
    with pytest.raises(ValueError): Settings(**safe)


def test_no_faux_dev_login_route(client):
    assert client.post('/api/v1/dev/login').status_code in (404,405)
    assert client.get('/api/v1/dev/login').status_code in (404,405)
