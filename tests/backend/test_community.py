import pytest
from sqlalchemy import select
from app.models import Content, ContentOwner, Revision, Notification, Account, Membership, Job


def review(**changes):
    return {'campus':'Kampar','term':'June 2026','body':'Clear teaching and useful practice.','advice':'Practice weekly.','overall':4,**changes}


def create_review(client,headers,**changes):
    result=client.post('/api/v1/courses/course/reviews',headers=headers(),json=review(**changes))
    assert result.status_code==201,result.text
    return result.json()


def publish(client,headers,content_id,version=1,action='publish'):
    result=client.post('/api/v1/admin/moderation-actions',headers=headers('moderator'),json={
        'content_id':content_id,'version':version,'action':action,'reason':'Checked against community guidelines'})
    assert result.status_code==200,result.text
    return result.json()


def test_pending_review_private_then_moderated_anonymous(client,users):
    ids,headers=users
    item=create_review(client,headers)
    assert item['status']=='pending' and item['is_mine']
    assert client.get('/api/v1/courses/course/reviews',headers=headers('bob')).json()['items']==[]
    publish(client,headers,item['id'])
    result=client.get('/api/v1/courses/course/reviews',headers=headers('bob'))
    assert result.json()['total']==1 and result.json()['stats']['average'] is None
    assert 'user_id' not in result.text and 'email' not in result.text and ids['alice'] not in result.text
    assert result.json()['items'][0]['author']=='Anonymous'


def test_duplicate_and_forged_review_rejected(client,users):
    _,headers=users
    create_review(client,headers)
    assert client.post('/api/v1/courses/course/reviews',headers=headers(),json=review()).status_code==409
    assert client.post('/api/v1/courses/course/reviews',headers=headers('bob'),json=review(user_id='attacker')).status_code==422
    assert client.post('/api/v1/courses/course/reviews',headers=headers('bob'),json=review(overall=True)).status_code==422
    assert client.post('/api/v1/courses/course/reviews',headers=headers('bob'),json=review(campus='Sungai Long')).status_code==422
    assert client.post('/api/v1/courses/course/reviews',headers=headers('bob'),json=review(term='June 2099')).status_code==422


def test_review_edit_ownership_version_and_reapproval(client,users):
    _,headers=users
    item=create_review(client,headers);published=publish(client,headers,item['id'])
    payload={'version':published['version'],'body':'Updated course experience','overall':3}
    assert client.patch(f"/api/v1/reviews/{item['id']}",headers=headers('bob'),json=payload).status_code==404
    edit=client.patch(f"/api/v1/reviews/{item['id']}",headers=headers(),json=payload)
    assert edit.status_code==200 and edit.json()['status']=='pending'
    assert client.get('/api/v1/courses/course/reviews',headers=headers('bob')).json()['items']==[]
    assert client.patch(f"/api/v1/reviews/{item['id']}",headers=headers(),json=payload).status_code==409
    assert client.post('/api/v1/admin/moderation-actions',headers=headers('moderator'),json={
        'content_id':item['id'],'version':published['version'],'action':'publish','reason':'Stale decision should not publish'}).status_code==409


def test_helpful_idempotent_self_vote_and_delete(client,users):
    _,headers=users
    item=create_review(client,headers);publish(client,headers,item['id'])
    path=f"/api/v1/reviews/{item['id']}/helpful"
    assert client.put(path,headers=headers()).status_code==422
    assert client.put(path,headers=headers('bob')).json()['helpful_count']==1
    assert client.put(path,headers=headers('bob')).json()['helpful_count']==1
    assert client.delete(path,headers=headers('bob')).json()['helpful_count']==0
    assert client.delete(path,headers=headers('bob')).json()['helpful_count']==0


def test_comment_parent_visibility_and_blocks(client,users):
    _,headers=users
    item=create_review(client,headers);publish(client,headers,item['id'])
    path=f"/api/v1/reviews/{item['id']}/comments"
    comment=client.post(path,headers=headers('bob'),json={'body':'Was there a group assignment?'})
    assert comment.status_code==201 and comment.json()['status']=='pending'
    assert client.get(path,headers=headers()).json()['total']==0
    publish(client,headers,comment.json()['id'])
    assert client.get(path,headers=headers()).json()['total']==1
    blocked=client.post('/api/v1/blocks',headers=headers('bob'),json={'content_id':item['id']})
    assert blocked.json()=={'status':'blocked'}
    assert client.get('/api/v1/courses/course/reviews',headers=headers('bob')).json()['total']==0
    assert client.get(path,headers=headers('bob')).status_code==404
    blocks=client.get('/api/v1/me/blocks',headers=headers('bob')).json()['items']
    assert len(blocks)==1
    assert client.delete('/api/v1/blocks/'+blocks[0]['id'],headers=headers('alice')).status_code==404
    assert client.delete('/api/v1/blocks/'+blocks[0]['id'],headers=headers('bob')).status_code==204
    assert client.get('/api/v1/courses/course/reviews',headers=headers('bob')).json()['total']==1


def test_reports_appeals_and_hidden_content(client,users):
    ids,headers=users
    item=create_review(client,headers);published=publish(client,headers,item['id'])
    payload={'content_id':item['id'],'reason':'wrong_context','detail':'Please check this term.'}
    report=client.post('/api/v1/reports',headers=headers('bob'),json=payload)
    assert report.status_code==201
    assert client.post('/api/v1/reports',headers=headers('bob'),json=payload).json()['id']==report.json()['id']
    queue=client.get('/api/v1/admin/moderation-queue',headers=headers('moderator'))
    assert ids['bob'] not in queue.text and ids['alice'] not in queue.text
    publish(client,headers,item['id'],version=published['version'],action='hide')
    assert client.get('/api/v1/courses/course/reviews',headers=headers('bob')).json()['total']==0
    assert client.post('/api/v1/appeals',headers=headers(),json={'content_id':item['id'],'reason':'Please reconsider the term context.'}).status_code==201
    assert client.post('/api/v1/appeals',headers=headers('bob'),json={'content_id':item['id'],'reason':'Please reconsider the term context.'}).status_code==404


def test_tip_and_content_type_allowlist(client,users):
    _,headers=users
    item=client.post('/api/v1/courses/course/exam-tips',headers=headers(),json={
        'campus':'Kampar','term':'June 2026','assessment_type':'Final exam','body':'Practice explaining concepts before coding.'})
    assert item.status_code==201
    publish(client,headers,item.json()['id'])
    assert client.get('/api/v1/courses/course/exam-tips',headers=headers('bob')).json()['total']==1
    assert client.put('/api/v1/accounts/'+item.json()['id']+'/helpful',headers=headers('bob')).status_code==404
    assert client.delete('/api/v1/reviews/'+item.json()['id'],headers=headers()).status_code==404


def test_member_content_no_store_and_not_public(client,users):
    _,headers=users
    result=client.get('/api/v1/courses/course/reviews',headers=headers())
    assert result.headers['cache-control']=='no-store'
    assert result.headers['x-robots-tag']=='noindex'
    assert client.get('/api/v1/courses/course/reviews').status_code==401


def test_deleted_owner_content_cannot_be_republished(client,users):
    _,headers=users
    item=create_review(client,headers);published=publish(client,headers,item['id'])
    assert client.delete('/api/v1/reviews/'+item['id'],headers=headers()).status_code==204
    assert client.post('/api/v1/admin/moderation-actions',headers=headers('moderator'),json={
        'content_id':item['id'],'version':published['version'],'action':'publish','reason':'Attempt to revive deleted content'}).status_code==409


def test_deletion_export_tombstone_and_cleanup(client,app,users):
    ids,headers=users
    item=create_review(client,headers)
    exported=client.post('/api/v1/me/export',headers=headers()).json()
    assert exported['account']['id']==ids['alice']
    assert ids['bob'] not in str(exported)
    assert client.post('/api/v1/me/deletion-request',headers=headers()).status_code==202
    assert client.get('/api/v1/me',headers=headers()).status_code==403
    with app.state.session_factory() as db:
        assert db.get(Account,ids['alice']).deleted
        assert db.get(Membership,ids['alice']) is None
        assert db.get(Content,item['id']).status=='removed'
        from app.jobs import process_jobs
        result=process_jobs(db,app.state.settings)
        assert result['needs_operator']==1
        assert db.scalar(select(Job)).kind=='delete-supabase-user'
