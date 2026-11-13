import pytest
from app.models import Course, Offering, Section, LegacyMapping


def plan(entries=None,**overrides):
    return {'name':'My term','campus':'Kampar','term':'June 2026','entries':entries or [],**overrides}


def selected(identifier='e1'):
    return {'id':identifier,'offering':'offering','sectionIds':['section']}


def test_search_pagination_detail(client):
    assert client.get('/api/v1/courses?query=UCCD').json()['total']==1
    assert client.get('/api/v1/courses?query=%25').json()['total']==0
    assert client.get('/api/v1/courses?limit=0').status_code==422
    assert client.get('/api/v1/courses?offset=-1').status_code==422
    detail=client.get('/api/v1/courses/course').json()
    assert detail['offerings'][0]['sections'][0]['meetings'][0]['start']==600
    assert client.get('/api/v1/courses/missing').status_code==404
    assert client.get('/api/v1/terms').json()['items']==['June 2026']


def test_private_plan_and_hydration(client,users):
    _,headers=users
    result=client.post('/api/v1/me/timetables',headers=headers(),json=plan([selected()]))
    assert result.status_code==201
    item=result.json();identifier=item['id']
    assert item['entries'][0]['code']=='UCCD1004'
    assert item['entries'][0]['meetings'][0]['start']==600
    assert client.get('/api/v1/me/timetables',headers=headers('bob')).json()['items']==[]
    assert client.patch(f'/api/v1/me/timetables/{identifier}',headers=headers('bob'),json={**plan(),'version':1}).status_code==404
    assert client.delete(f'/api/v1/me/timetables/{identifier}',headers=headers('bob')).status_code==404
    good=client.patch(f'/api/v1/me/timetables/{identifier}',headers=headers(),json={**plan([selected()]),'version':1})
    assert good.status_code==200 and good.json()['version']==2
    assert client.patch(f'/api/v1/me/timetables/{identifier}',headers=headers(),json={**plan(),'version':1}).status_code==409


@pytest.mark.parametrize('entry',[
    {'id':'a','offering':'missing','sectionIds':['section']},
    {'id':'a','offering':'offering','sectionIds':['section','section']},
    {'id':'a','offering':'offering','sectionIds':[]},
    {'id':'a','manual':True,'name':'manual','meetings':[{'day':'Mon','start':900,'end':800}]},
    {'id':'a','manual':True,'name':'manual','meetings':[{'day':'Holiday','start':600,'end':700}]},
    {'id':'a','manual':True,'name':'manual','meetings':[{'day':'Mon','start':600,'end':700,'weekNumbers':[True]}]},
])
def test_bad_plan_entries(client,users,entry):
    _,headers=users
    assert client.post('/api/v1/me/timetables',headers=headers(),json=plan([entry])).status_code==422


def test_cross_campus_and_duplicate_entries(client,users):
    _,headers=users
    assert client.post('/api/v1/me/timetables',headers=headers(),json=plan([selected()],campus='Sungai Long')).status_code==422
    assert client.post('/api/v1/me/timetables',headers=headers(),json=plan([selected(),selected()])).status_code==422


def test_week_clashes_and_manual_entries(client,users):
    _,headers=users
    manual={'id':'manual','manual':True,'name':'Study','meetings':[{'day':'Mon','start':630,'end':690,'weekNumbers':[3]}]}
    result=client.post('/api/v1/me/timetables',headers=headers(),json=plan([selected(),manual]))
    assert result.status_code==201 and result.json()['conflicts']==[]
    assert result.json()['entries'][1]['sectionIds']==[]
    manual['meetings'][0]['weekNumbers']=[2]
    result=client.post('/api/v1/me/timetables',headers=headers(),json=plan([selected(),manual]))
    assert result.json()['conflicts']==[['e1','manual']]


def test_import_legacy_idempotent_unresolved(client,app,users):
    _,headers=users
    with app.state.session_factory() as db:
        db.add(LegacyMapping(kind='offering',legacy_id='OFF-OLD',canonical_id='offering'))
        db.add(LegacyMapping(kind='section',legacy_id='SEC-OLD',canonical_id='section'));db.commit()
    payload={'key':'import-key-1','plans':[plan([{'id':'old','offering':'OFF-OLD','sectionIds':['SEC-OLD']},
        {'id':'unknown','offering':'OLD-MISSING','sectionIds':['OLD-SECTION']}])]}
    first=client.post('/api/v1/me/timetables/import',headers=headers(),json=payload)
    assert first.status_code==200
    assert first.json()['items'][0]['entries'][0]['offering']=='offering'
    assert first.json()['items'][0]['entries'][1]['unresolved']
    assert first.json()==client.post('/api/v1/me/timetables/import',headers=headers(),json=payload).json()
    assert len(client.get('/api/v1/me/timetables',headers=headers()).json()['items'])==1
