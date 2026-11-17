'use strict';
(() => {
  const A = window.CampusAccount, P = window.CampusPlanner, E = window.CampusSocialCore.esc;
  const $ = s => document.querySelector(s);
  const topics = [['All','grid'],['Study','book'],['Gaming','game'],['Anime','sparkle'],['Fitness','fitness'],['Sports','ball'],['Music','music'],['Campus life','home']];
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const button = (label, action, attrs = '', cls = 'outline-button') => `<button type="button" class="${cls}" data-chat="${action}" ${attrs}>${label}</button>`;
  const signed = () => !!A.state.user?.email_confirmed_at;
  const campus = () => A.state.profile?.campus || P.exportCurrent().campus || 'Kampar';
  let state = fresh(), searchTimer, pollBusy = false;
  function fresh() { return {owner:A.state.user?.id || '',epoch:0,tab:'local',area:campus(),topic:'All',query:'',searchOpen:false,rooms:[],friends:[],room:null,messages:[],older:false,problem:'',loading:false,listVersion:0,viewVersion:0,mineUnread:0}; }
  const rpc = (name, args = {}) => A.rpc('cm_room_' + name, args);
  function when(v) { if (!v) return ''; const mins = Math.max(0, Math.floor((Date.now()-new Date(v).getTime())/60000)); return mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins/60)}h ago` : new Date(v).toLocaleDateString('en-MY',{day:'numeric',month:'short'}); }
  function issue(e) { window.CampusDiagnostics?.record('rooms',e); return /PGRST202|does not exist|schema cache|unknown rpc|Supabase tables are not ready/i.test(e?.message || '') ? 'Community rooms are not connected yet. Friend messages are still available in My Chats.' : e?.message || 'Could not connect. Please try again.'; }
  function gate() { if (signed()) return true; window.CampusShell.go('account'); if (!A.state.user) document.querySelector('[data-shell="login"]')?.click(); return false; }
  function modal(title, body) { P.show(P.header(title) + `<div class="modal-body room-modal">${body}<p class="form-error" role="alert"></p></div>`,'social-dialog'); }
  const field = (label, html) => `<label class="form-field">${label}${html}</label>`;
  const choices = (items, value) => items.map(x => `<option value="${E(x)}" ${x===value?'selected':''}>${E(x)}</option>`).join('');
  function empty(title, text, action = '') { return `<div class="room-empty">${icon('chat')}<h2>${E(title)}</h2><p>${E(text)}</p>${action}</div>`; }
  function route() { const parts=location.hash.slice(1).split('/'); return {tab:['local','campus','my'].includes(parts[1])?parts[1]:'local',room:parts[1]==='room'&&window.CampusSocialCore.uuid(parts[2])?parts[2]:null}; }
  function reset() { const epoch=state.epoch+1; state=fresh(); state.epoch=epoch; clearTimeout(searchTimer);window.dispatchEvent(new Event('campusmy:chat-unread')); }
  function render({friends = [],error = ''} = {}) {
    if ((A.state.user?.id || '') !== state.owner) reset();
    state.friends=friends.filter(f=>f.status==='accepted');
    const r=route();
    if (r.room) { void openRoom(r.room); return; }
    state.viewVersion++; state.room=null; state.messages=[]; state.tab=r.tab;
    if (state.tab==='campus') state.area=campus();
    $('#chat-content').innerHTML=`<div class="chat-hub">
      <div class="chat-hub-heading"><div><p class="eyebrow">A LITTLE MORE CONNECTED</p><h1>Your people, <em>your place.</em></h1></div><span class="chat-no-ad">${icon('chat')} Made for conversation</span></div>
      <div class="chat-hub-nav"><nav class="chat-hub-tabs" aria-label="Chat sections">${[['local','Local'],['campus','Campus'],['my','My Chats']].map(([v,label])=>`<a href="#chat/${v}" class="${v===state.tab?'active':''}" ${v===state.tab?'aria-current="page"':''}>${label}</a>`).join('')}</nav><div class="chat-tools">${button(icon('search'),'search','aria-label="Search chats" aria-expanded="'+state.searchOpen+'"','top-icon')}${button(icon('settings'),'settings','aria-label="Chat settings"','top-icon')}</div></div>
      <div class="chat-search-wrap" ${state.searchOpen?'':'hidden'}><label class="hub-search">${icon('search')}<input id="chat-search" aria-label="Search chats" type="search" maxlength="80" placeholder="Search a room, topic or friend" value="${E(state.query)}"></label></div>
      <div class="chat-hub-grid"><div class="chat-discovery">
        <div class="chat-area-bar"><span class="area-icon">${icon(state.tab==='local'?'pin':state.tab==='campus'?'home':'users')}</span><div><strong>${state.tab==='local'?'Good company, close by':state.tab==='campus'?'Same campus. New connections.':'Pick up where you left off.'}</strong><small>${state.tab==='my'?'Your joined rooms and private friend messages':state.tab==='campus'?'UTAR · '+E(campus())+' · based on your profile':'Choose a campus area to find conversations'}</small></div>${state.tab==='local'?`<label class="area-select"><span class="sr-only">Local chat area</span><select id="chat-area">${choices(['Kampar','Sungai Long'],state.area)}</select>${icon('arrow')}</label>`:icon('chat')}</div>
        <div class="chat-topic-strip" aria-label="Chat topics">${topics.map(([name,i])=>button(`<span class="topic-icon topic-${i}">${icon(i)}</span><span>${name}</span>`,'topic',`data-topic="${E(name)}" aria-pressed="${state.topic===name}"`,state.topic===name?'chat-topic active':'chat-topic')).join('')}</div>
        <div class="room-list-heading"><h2>${state.tab==='my'?'Your conversations':state.topic==='All'?'Find your circle':E(state.topic)+' conversations'}</h2><span>Recent activity</span></div>
        <div id="room-list" aria-live="polite"></div>
      </div><aside class="chat-hub-aside"><div class="chat-aside-art" aria-hidden="true"><span>${icon('chat')}</span><span>${icon('sparkle')}</span></div><p class="eyebrow">A SHARED INTEREST IS A START</p><h2>There’s a room<br>for your kind of people.</h2><p>Revision partners, a badminton crew, or someone who knows that one game. Start with hello.</p>${button(icon('plus')+' Start a conversation','create','','primary-button')}<div class="chat-ground-rules"><strong>${icon('lock')} A little care goes a long way</strong><p>Keep personal details private. Be kind, and report messages that cross a line.</p>${button('How chat works '+icon('arrow'),'about','','text-button')}</div></aside></div>
      <button type="button" class="chat-create-fab" data-chat="create" aria-label="Start a new chat">${icon('chat')}<span>+</span></button>
    </div>`;
    paintList();
    if (signed()) void loadRooms();
    else { state.rooms=[]; state.problem=''; paintList(); }
  }
  function roomCard(r) { const i=topics.find(t=>t[0]===r.category)?.[1] || 'chat'; return `<a class="room-card" href="#chat/room/${E(r.id)}"><div class="room-card-main"><div class="room-tags"><span>${r.scope==='local'?'Local':'Campus'}</span><span>${E(r.category)}</span>${r.closed?'<span>Closed</span>':r.joined?'<span class="room-joined">Joined</span>':''}</div><h3>${E(r.title)}</h3>${r.description?`<p>${E(r.description)}</p>`:''}<div class="room-card-meta"><span>${icon('users')} ${Number(r.count)} joined</span><i></i><span>${E(when(r.updated_at))}</span>${r.unread&&!r.muted?`<b class="unread-pill">${Number(r.unread)}</b>`:''}</div></div><span class="room-card-icon topic-${i}">${icon(i)}</span></a>`; }
  function friendCards() { const q=state.query.toLowerCase(); return state.friends.filter(f=>(f.person.name+' '+f.person.username).toLowerCase().includes(q)).map(f=>`<a class="room-card dm-card" href="#chat/${E(f.id)}"><span class="chat-friend-avatar">${E((f.person.name||f.person.username||'?').slice(0,1).toUpperCase())}</span><div class="room-card-main"><div class="room-tags"><span>Friend</span><span>Private message</span></div><h3>${E(f.person.name||f.person.username)}</h3><div class="room-card-meta"><span>@${E(f.person.username)}</span>${f.unread?`<b class="unread-pill">${Number(f.unread)}</b>`:''}</div></div>${icon('arrow')}</a>`).join(''); }
  function paintList() {
    const target=$('#room-list'); if(!target || state.room) return;
    if (!signed()) { target.innerHTML=empty('A familiar face. A new friend.','Sign in with a confirmed email to discover rooms and chat with your campus.',button('Sign in to connect','signin','','primary-button')); return; }
    const roomHTML=state.rooms.map(roomCard).join(''), dm=state.tab==='my'&&state.topic==='All'?friendCards():'';
    target.innerHTML=`${state.tab==='my'?`<div class="chat-list-section"><h3>Friend messages <span>${state.friends.length}</span></h3>${dm?`<div class="room-card-grid">${dm}</div>`:state.topic!=='All'?'<p class="chat-list-note">Choose All topics to see private friend messages.</p>':empty('Say hello to a friend','Accepted friends appear here.',button('Add a friend','friend','','outline-button'))}</div><h3 class="joined-rooms-label">Joined rooms</h3>`:''}${state.problem?`<div class="chat-connection" role="status">${icon('chat')}<div><strong>Rooms are unavailable</strong><p>${E(state.problem)}</p></div>${button('Retry','retry','','text-button')}</div>`:state.loading&&!roomHTML?'<div class="chat-loading" role="status">Finding conversations…</div>':roomHTML?`<div class="room-card-grid">${roomHTML}</div>${state.rooms.length===60?'<p class="chat-list-note">Showing the 60 most recently active rooms. Use search or a topic to narrow the list.</p>':''}`:empty(state.query?'No matching conversations':state.tab==='my'?'Your rooms will feel at home here':'Be the first to bring people together',state.query?'Try another name or a broader topic.':state.tab==='my'?'Rooms you join appear here alongside your friend messages.':'No rooms here yet. Start one around something you enjoy.',button(icon('plus')+' Create a room','create','','outline-button'))}`;
  }
  async function refreshUnread() {
    if(!signed()) return;
    const epoch=state.epoch;
    try { const rooms=await rpc('list',{p_scope:'local',p_campus:campus(),p_category:'',p_query:'',p_mine:true});if(epoch!==state.epoch)return;state.mineUnread=rooms.filter(r=>!r.muted).reduce((n,r)=>n+Number(r.unread),0);window.dispatchEvent(new Event('campusmy:chat-unread')); } catch { /* Room setup/network errors are shown by the main view. */ }
  }
  async function loadRooms(quiet=false) {
    if(!signed() || state.room) return;
    const epoch=state.epoch,version=++state.listVersion;
    state.loading=true; if(!quiet) paintList();
    try { const rows=await rpc('list',{p_scope:state.tab==='my'?'local':state.tab,p_campus:state.area,p_category:state.topic==='All'?'':state.topic,p_query:state.query,p_mine:state.tab==='my'}); if(epoch!==state.epoch||version!==state.listVersion||state.room) return; state.rooms=rows;state.problem=''; if(state.tab!=='my')void refreshUnread(); if(state.tab==='my'){state.mineUnread=rows.filter(r=>!r.muted).reduce((n,r)=>n+Number(r.unread),0);window.dispatchEvent(new Event('campusmy:chat-unread'));} }
    catch(e) { if(epoch===state.epoch&&version===state.listVersion) {state.problem=issue(e);state.rooms=[];} }
    finally { if(epoch===state.epoch&&version===state.listVersion) {state.loading=false;paintList();} }
  }
  function createRoom() {
    if(!gate()) return;
    const scope=state.tab==='campus'?'campus':'local';
    modal('Start something good',`<p class="modal-caption">A shared interest is all it takes. Your CampusMY profile name will be visible to members.</p><form data-chat-form="create">${field('Room name','<input name="title" required minlength="3" maxlength="80" placeholder="e.g. Badminton after class">')}${field('A little about your room','<textarea name="description" maxlength="300" rows="3" placeholder="Who is it for? What will you talk about?"></textarea>')}<div class="room-form-columns">${field('Who can find it',`<select name="scope"><option value="local" ${scope==='local'?'selected':''}>Local area</option><option value="campus" ${scope==='campus'?'selected':''}>My campus</option></select>`)}${field('Area / campus',`<select name="campus">${choices(['Kampar','Sungai Long'],scope==='campus'?campus():state.area)}</select>`)}</div><p class="privacy-note">Campus rooms use the campus selected in your profile. CampusMY does not currently verify university enrolment.</p><div class="room-form-columns">${field('Topic',`<select name="category">${choices(topics.slice(1).map(t=>t[0]),state.topic==='All'?'Campus life':state.topic)}</select>`)}${field('Maximum members','<input name="capacity" type="number" min="2" max="100" value="30" required>')}</div><label class="social-check"><input type="checkbox" required> I’ll keep this room respectful and avoid sharing private information.</label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="primary-button" type="submit">Create room ${icon('arrow')}</button></div></form>`);
  }
  function settings() {
    modal('Chat, your way',`<div class="chat-settings-copy"><h3>Your conversations</h3><p>Friend messages are for accepted friends. Community rooms require joining before you can read or send messages.</p><h3>Your privacy</h3><p>Local uses your selected area, not GPS. Campus rooms use your profile campus; this is not verified university enrolment. Joining a room never shares your timetable or email.</p><h3>Notifications</h3><p>Mute individual rooms from their conversation menu. Muted rooms keep their messages, but are excluded from the room unread badge.</p><h3>Your controls</h3><p>Leave a room whenever you choose. Report a message to the site operator. Room organisers can close their room and remove members. Blocking a student hides their messages from you; shared rooms can still contain mutual members.</p><p class="privacy-note">Chat is stored by CampusMY and is not end-to-end encrypted. Reporting submits a report for manual review; it does not automatically remove content.</p></div>${button('Open My page','account','','outline-button')}`);
  }
  async function openRoom(id) {
    state.listVersion++; const version=++state.viewVersion,epoch=state.epoch; state.room={id};state.messages=[];
    $('#chat-content').innerHTML=`<a class="room-back" href="#chat/my">${icon('back')} Back to chats</a>${empty('Opening the conversation…','Checking your room access.')}`;
    if(!signed()){state.room=null;$('#chat-content').innerHTML=empty('Join the conversation','Sign in with a confirmed email to open this room.',button('Sign in','signin','','primary-button'));return;}
    try { const room=await rpc('detail',{p_room:id});if(version!==state.viewVersion||epoch!==state.epoch)return;state.room=room;paintThread();if(room.joined)await loadMessages(false,true); }
    catch(e){if(version===state.viewVersion&&epoch===state.epoch)$('#chat-content').innerHTML=`<a class="room-back" href="#chat/my">${icon('back')} Back to chats</a>${empty('Room unavailable',issue(e))}`;}
  }
  function paintThread() {
    const r=state.room;
    $('#chat-content').innerHTML=`<div class="room-thread-page"><a class="room-back" href="#chat/${r.scope}">${icon('back')} Back to ${r.scope==='local'?'Local':'Campus'}</a><div class="room-thread-card"><header class="room-thread-heading"><span class="room-card-icon">${icon('chat')}</span><div><div class="room-tags"><span>${r.scope==='local'?'Local':'Campus'} · ${E(r.campus)}</span><span>${E(r.category)}</span></div><h1>${E(r.title)}</h1><p id="room-member-count">${r.count}/${r.capacity} members${r.closed?' · Room closed':''}</p></div>${r.joined?button(icon('more'),'room-menu','aria-label="Room options"','top-icon'):''}</header>${r.description?`<p class="room-description">${E(r.description)}</p>`:''}${r.joined?`<div class="room-message-controls">${button('Load earlier messages','older','','text-button')}<span id="room-live-status" role="status">Updates every 5 seconds</span>${button('Members','members','','text-button')}</div><div id="room-messages" class="room-messages" role="log" aria-label="Room messages"></div><form data-chat-form="send" class="room-compose"><label class="sr-only" for="room-message-input">Message to ${E(r.title)}</label><textarea id="room-message-input" name="body" rows="2" maxlength="2000" required placeholder="${r.closed?'This room is closed':'Say something kind…'}" ${r.closed?'disabled':''}></textarea><button class="primary-button" ${r.closed?'disabled':''} type="submit">Send ${icon('arrow')}</button><p class="form-error" role="alert"></p></form>`:empty(r.closed?'This room is closed':'You’ve found your people?',r.closed?'The organiser has closed this conversation.':'Join to read messages and take part. Your profile name will be visible to members.',!r.closed?button(r.count>=r.capacity?'Room full':'Join conversation','join',r.count>=r.capacity?'disabled':'','primary-button'):'')}<p class="room-privacy">${icon('lock')} Room messages are visible to members. Your timetable stays private.</p></div></div>`;
    paintMessages();
  }
  function paintMessages(first=false,older=false) {
    const target=$('#room-messages'); if(!target) return;
    const bottom=target.scrollHeight-target.scrollTop-target.clientHeight<80, height=target.scrollHeight,top=target.scrollTop;
    target.innerHTML=state.messages.length?state.messages.map(m=>`<article class="room-message ${m.mine?'mine':''}"><div class="room-message-avatar" aria-hidden="true">${E((m.sender||m.username||'?').slice(0,1).toUpperCase())}</div><div class="room-message-content"><div class="room-message-byline"><strong>${m.mine?'You':E(m.sender||m.username||'Student')}</strong><time datetime="${E(m.created_at)}">${E(new Date(m.created_at).toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit'}))}</time>${m.mine?'':button('Report','report',`data-id="${E(m.id)}" aria-label="Report message by ${E(m.sender||m.username)}"`,'room-report')}</div><p>${E(m.body)}</p></div></article>`).join(''):empty('Every conversation starts somewhere','Be the first to say hello.');
    if(older)target.scrollTop=top+target.scrollHeight-height;else if(first||bottom)target.scrollTop=target.scrollHeight;
    const load=$('[data-chat="older"]');if(load)load.hidden=!state.older;
  }
  async function loadMessages(older=false,first=false) {
    const room=state.room;if(!room?.joined)return;
    const epoch=state.epoch,version=state.viewVersion;
    const rows=await rpc('messages',{p_room:room.id,p_before:older?state.messages[0]?.seq||null:null});
    if(epoch!==state.epoch||version!==state.viewVersion||room.id!==state.room?.id)return;
    if(older||first)state.older=rows.length===50;
    state.messages=[...new Map((older?[...rows,...state.messages]:[...state.messages,...rows]).map(m=>[m.id,m])).values()].sort((a,b)=>BigInt(a.seq)<BigInt(b.seq)?-1:BigInt(a.seq)>BigInt(b.seq)?1:0);
    // Hidden/reported moderation is reflected in the current page on the next fetch.
    if(!older&&rows.length<50)state.messages=rows;
    else if(!older&&rows.length)state.messages=state.messages.filter(m=>BigInt(m.seq)<BigInt(rows[0].seq)||rows.some(r=>r.id===m.id));
    paintMessages(first,older);if(!older)void refreshUnread();
    const status=$('#room-live-status');if(status)status.textContent='Updates every 5 seconds';
  }
  function roomMenu() { const r=state.room; modal('Conversation options',`<h3>${E(r.title)}</h3><div class="button-list">${button(r.muted?'Unmute room':'Mute room','mute')}${r.mine?button(r.closed?'Reopen room':'Close room','manage',`data-choice="${r.closed?'reopen':'close'}"`):''}${button('Leave room','confirm-leave','','text-button danger')}</div><p class="privacy-note">Leaving ends your access to messages. Existing messages remain in the conversation. Organisers must close their room before leaving.</p>`); }
  async function members() { const id=state.room?.id,epoch=state.epoch,rows=await rpc('members',{p_room:id});if(epoch!==state.epoch||id!==state.room?.id)return;modal('People in this room',rows.map(m=>`<div class="room-member"><div><strong>${E(m.name||m.username)}</strong><small>@${E(m.username)}${m.owner?' · Organiser':''}${m.me?' · You':''}</small></div>${state.room.mine&&!m.me?button('Remove','confirm-remove',`data-person="${E(m.id)}"`,'text-button danger'):''}</div>`).join('')); }
  async function action(b) {
    const what=b.dataset.chat,epoch=state.epoch,id=state.room?.id;
    switch(what){
      case 'signin':gate();return; case 'account':$('#modal').close();window.CampusShell.go('account');return;
      case 'search':state.searchOpen=!state.searchOpen;$('.chat-search-wrap').hidden=!state.searchOpen;b.setAttribute('aria-expanded',state.searchOpen);if(state.searchOpen)$('#chat-search').focus();return;
      case 'settings':case 'about':settings();return;case 'create':createRoom();return;
      case 'friend':document.querySelector('[data-social="add-friend"]')?.click();return;
      case 'retry':await loadRooms();return;
      case 'topic':state.topic=b.dataset.topic;document.querySelectorAll('.chat-topic').forEach(n=>{const on=n.dataset.topic===state.topic;n.classList.toggle('active',on);n.setAttribute('aria-pressed',on);});$('.room-list-heading h2').textContent=state.topic==='All'?'Find your circle':state.topic+' conversations';if(signed())await loadRooms();return;
      case 'join':await rpc('join',{p_room:id});if(epoch===state.epoch&&id===state.room?.id)await openRoom(id);return;
      case 'older':await loadMessages(true);return;case 'room-menu':roomMenu();return;case 'members':await members();return;
      case 'mute':await rpc('mute',{p_room:id,p_muted:!state.room.muted});if(epoch===state.epoch&&id===state.room?.id){state.room.muted=!state.room.muted;void refreshUnread();$('#modal').close();P.toast(state.room.muted?'Room muted.':'Room unmuted.');}return;
      case 'manage':await rpc('manage',{p_room:id,p_action:b.dataset.choice,p_target:null});if(epoch===state.epoch&&id===state.room?.id){$('#modal').close();await openRoom(id);}return;
      case 'confirm-leave':modal('Leave this room?',`<p>You will lose access to its messages. Existing messages remain in the conversation.</p>${button('Leave room','leave','','primary-button')}`);return;
      case 'leave':await rpc('leave',{p_room:id});if(epoch===state.epoch){$('#modal').close();location.hash='chat/my';}return;
      case 'confirm-remove':modal('Remove this member?',`<p>They will lose access to this room and cannot rejoin.</p>${button('Remove member','remove',`data-person="${E(b.dataset.person)}"`,'primary-button')}`);return;
      case 'remove':await rpc('manage',{p_room:id,p_action:'remove',p_target:b.dataset.person});if(epoch===state.epoch){$('#modal').close();P.toast('Member removed.');}return;
      case 'report':modal('Report a message',`<p class="modal-caption">Tell the site operator what happened. Reports are reviewed manually.</p><form data-chat-form="report"><input type="hidden" name="message" value="${E(b.dataset.id)}">${field('Reason','<textarea name="reason" required minlength="10" maxlength="500" rows="4" placeholder="Describe the issue without sharing private information"></textarea>')}<p class="form-error" role="alert"></p><button class="primary-button" type="submit">Submit report</button></form>`);return;
    }
  }
  document.addEventListener('click',async e=>{const b=e.target.closest('[data-chat]');if(!b||b.disabled)return;b.disabled=true;try{await action(b);}catch(err){const out=$('#modal[open] .room-modal .form-error')||$('#chat-content .form-error');if(out)out.textContent=issue(err);else P.toast(issue(err));}finally{if(b.isConnected)b.disabled=false;}});
  document.addEventListener('input',e=>{if(e.target.id!=='chat-search')return;state.query=e.target.value.slice(0,80);clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(signed())void loadRooms();},250);});
  document.addEventListener('change',e=>{if(e.target.id==='chat-area'){state.area=e.target.value;if(signed())void loadRooms();}if(e.target.matches('[data-chat-form="create"] [name="scope"]')&&e.target.value==='campus')e.target.form.elements.campus.value=campus();});
  document.addEventListener('submit',async e=>{
    const f=e.target;if(!f.matches('[data-chat-form]'))return;e.preventDefault();
    const submit=f.querySelector('[type="submit"]'),out=f.querySelector('.form-error'),data=Object.fromEntries(new FormData(f)),epoch=state.epoch,id=state.room?.id;submit.disabled=true;out.textContent='';
    try{
      if(f.dataset.chatForm==='create'){const created=await rpc('create',{p_scope:data.scope,p_campus:data.campus,p_category:data.category,p_title:data.title,p_description:data.description,p_capacity:Number(data.capacity)});if(epoch===state.epoch){$('#modal').close();location.hash='chat/room/'+created;}}
      else if(f.dataset.chatForm==='send'){const body=String(data.body||'').trim();if(!body)throw Error('Type a message before sending.');await window.CampusReliability.send('cm_room_send',{p_room:id,p_body:body});if(epoch===state.epoch&&id===state.room?.id){if(String(f.elements.body.value).trim()===body)f.reset();await loadMessages();$('#room-message-input')?.focus();}}
      else if(f.dataset.chatForm==='report'){await rpc('report',{p_message:data.message,p_reason:data.reason});if(epoch===state.epoch)modal('Report received','<p>The site operator can review this report. Reporting does not automatically remove the message.</p>');}
    }catch(err){if(epoch===state.epoch&&out.isConnected)out.textContent=issue(err);}finally{if(submit.isConnected)submit.disabled=false;}
  });
  async function pollRooms(){
    if(document.hidden||!signed()||document.body.dataset.page!=='chat'||window.CampusSocialCore.uuid(location.hash.split('/')[1])||pollBusy)return;
    pollBusy=true;const epoch=state.epoch,id=state.room?.id,version=state.viewVersion;
    try{if(id){const room=await rpc('detail',{p_room:id});if(epoch!==state.epoch||version!==state.viewVersion)return;const changed=room.joined!==state.room.joined||room.closed!==state.room.closed;state.room=room;if(changed){state.messages=[];paintThread();}if(room.joined)await loadMessages(false,changed);const n=$('#room-member-count');if(n)n.textContent=`${room.count}/${room.capacity} members${room.closed?' · Room closed':''}`;}else if(!window.CampusSocialCore.uuid(location.hash.split('/')[1]))await loadRooms(true);}
    catch(e){if(epoch===state.epoch&&version===state.viewVersion&&id===state.room?.id){if(e.code==='42501'||/unavailable for your account|Join this room/i.test(e.message||'')){state.messages=[];$('#chat-content').innerHTML=`<a class="room-back" href="#chat/my">${icon('back')} Back to chats</a>${empty('Room access ended',issue(e))}`;state.room=null;}else {const n=$('#room-live-status');if(n)n.textContent='Connection interrupted. Retrying…';}}}finally{pollBusy=false;}
  }
  setInterval(()=>void pollRooms(),5000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void pollRooms();});
  for(const event of ['focus','pageshow','online'])window.addEventListener(event,()=>void pollRooms());
  window.addEventListener('campusmy:account-changed',()=>{if((A.state.user?.id||'')!==state.owner){reset();if(location.hash.startsWith('#chat')&&!window.CampusSocialCore.uuid(location.hash.split('/')[1]))render();}});
  window.CampusChat={render,deactivate(){state.viewVersion++;state.listVersion++;state.room=null;state.messages=[];},updateFriends(rows){state.friends=rows.filter(f=>f.status==='accepted');if(state.tab==='my'&&!state.room)paintList();},unread(){return state.mineUnread;}};
})();
