'use strict';
(() => {
  const A=window.CampusAccount,P=window.CampusPlanner,E=window.CampusSocialCore.esc,$=s=>document.querySelector(s);
  let generation=0,owner=A.state.user?.id||'',status='open',open=false,loading=false;
  const current=(id,v)=>id===A.state.user?.id&&v===generation;
  function clear(){generation++;open=false;loading=false;$('#moderation-entry')?.remove();$('#posting-status')?.remove();if($('#moderation-panel')){$('#moderation-panel').remove();$('#modal').close();}}
  function denied(){clear();P.toast('Staff access ended.');}
  async function mount(){
    if(open)return;
    const id=A.state.user?.id,v=++generation;$('#moderation-entry')?.remove();
    if(!id||!A.state.user.email_confirmed_at||document.body.dataset.page!=='account')return;
    try{const pause=await A.rpc('cm_posting_status');if(!current(id,v))return;if(pause){const n=document.createElement('p');n.id='posting-status';n.className='warning-box';n.textContent='Community posting paused until '+new Date(pause.until).toLocaleString()+'. Reason: '+pause.reason+'. Your account, private planner and privacy controls remain available.';$('#posting-status')?.remove();$('#account-page').prepend(n);}else $('#posting-status')?.remove();if(!await A.rpc('cm_is_staff')||!current(id,v))return;
      const host=$('#account-page .account-layout>div:last-child');if(!host)return;
      const section=document.createElement('section');section.id='moderation-entry';section.className='settings-group';
      section.innerHTML='<h2>Site operations</h2><button class="setting-row" data-moderation="open"><span>Reports & decisions</span><span>Staff only →</span></button>';host.prepend(section);
    }catch{/* Older deployments do not expose staff tools. */}
  }
  const shell=()=>'<div id="moderation-panel" class="modal-body moderation-panel"><div class="moderation-tools"><label>Report status <select id="moderation-filter"><option value="open">Open</option><option value="actioned">Actioned</option><option value="dismissed">Dismissed</option></select></label><button class="outline-button" data-moderation="refresh">Refresh</button></div><p class="privacy-note">Review only the context needed for a decision. Reporter identities are withheld. Decisions are recorded. Posting pauses affect community rooms, reviews and study listings; account access and privacy controls stay available.</p><p id="moderation-error" role="alert"></p><div id="moderation-queue" aria-live="polite">Checking staff permission…</div><details><summary>Recent decisions</summary><div id="moderation-log"></div></details><details><summary>Operational counters</summary><p class="privacy-note">Hourly totals only. These counters may include client-reported events and are not a security audit log.</p><div id="moderation-health"></div></details></div>';
  async function load(){
    if(!open||loading||document.hidden)return;loading=true;
    const id=A.state.user?.id,v=++generation;
    try{
      const [rows,log]=await Promise.all([A.rpc('cm_mod_queue',{p_status:status,p_limit:50}),A.rpc('cm_mod_log',{p_limit:50})]);
      if(!current(id,v)||!open||!$('#moderation-panel'))return;
      $('#moderation-queue').innerHTML=rows.length?rows.map(r=>{
        const c=r.context,context=c.room?`${c.room.title} · ${c.room.scope} · ${c.room.campus}`:`${c.course.key} · ${c.course.term} · ${c.course.lecturer||'Course review'}`;
        return `<article class="moderation-report"><small>${E(r.type==='review'?'Course review':'Room message')} · ${Number(r.reports)} report(s) · ${c.hidden?'Hidden':'Visible'}</small><h3>${E(context)}</h3><p>By ${E(c.author)}</p><blockquote>${E(c.body)}</blockquote>${c.advice?`<p>${E(c.advice)}</p>`:''}<h4>Report reasons</h4><ul>${r.reasons.map(x=>`<li>${E(x)}</li>`).join('')}</ul><form data-moderation-form data-type="${E(r.type)}" data-id="${E(r.id)}"><label class="form-field">Decision reason<textarea name="reason" minlength="3" maxlength="500" required rows="2"></textarea></label><div class="moderation-actions"><button type="submit" name="action" value="${c.hidden?'restore':'hide'}" class="primary-button">${c.hidden?'Restore content':'Hide content'}</button><label>Community posting <select name="days"><option value="7">Pause for 7 days</option><option value="1">Pause for 1 day</option><option value="30">Pause for 30 days</option><option value="0">Resume posting</option></select></label><button type="submit" name="action" value="posting" class="outline-button">Apply posting decision</button>${status==='open'?'<button type="submit" name="action" value="dismiss" class="outline-button">Dismiss reports</button>':''}</div><p class="form-error" role="alert"></p></form></article>`;
      }).join(''):'<p>No reports in this queue.</p>';
      $('#moderation-log').innerHTML=log.length?log.map(l=>`<p><strong>${E(l.action)}</strong> · ${E(l.type)} · ${E(l.actor)}<br>${E(l.reason)}<br><small>${E(new Date(l.at).toLocaleString())}</small></p>`).join(''):'<p>No decisions recorded.</p>';
      try{const health=await A.rpc('cm_health_summary');if(current(id,v)&&open&&$('#moderation-health'))$('#moderation-health').innerHTML=health.length?health.map(h=>`<p>${E(new Date(h.hour).toLocaleString())} · ${E(h.area)} / ${E(h.kind)} · v${E(h.version)} · ${Number(h.count)}</p>`).join(''):'<p>No recent counters.</p>';}
      catch(e){if(current(id,v)&&$('#moderation-health'))$('#moderation-health').textContent='Operational counters are not connected.';}
    }catch(e){if(current(id,v)){if(e.code==='42501')denied();else if($('#moderation-error'))$('#moderation-error').textContent='Could not load reports. Please retry.';}}
    finally{if(current(id,v))loading=false;}
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-moderation]');if(!b)return;if(b.dataset.moderation==='open'){P.show(P.header('Reports & decisions')+shell(),'social-dialog moderation-dialog');open=true;status='open';}void load();});
  document.addEventListener('change',e=>{if(e.target.id==='moderation-filter'){status=e.target.value;void load();}});
  document.addEventListener('submit',async e=>{
    const f=e.target;if(!f.matches('[data-moderation-form]'))return;e.preventDefault();
    const action=e.submitter?.value;if(!['hide','restore','dismiss','posting'].includes(action)||f.dataset.busy)return;
    f.dataset.busy='1';const id=A.state.user?.id,v=generation,buttons=[...f.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{if(action==='posting')await A.rpc('cm_mod_posting',{p_type:f.dataset.type,p_id:f.dataset.id,p_days:Number(f.elements.days.value),p_reason:f.elements.reason.value});else await A.rpc('cm_mod_action',{p_type:f.dataset.type,p_id:f.dataset.id,p_action:action,p_reason:f.elements.reason.value});if(current(id,v)&&open){P.toast('Decision recorded.');await load();}}
    catch(err){if(current(id,v)){if(err.code==='42501')denied();else if(f.isConnected)f.querySelector('.form-error').textContent=err.message||'Decision could not be saved.';}}
    finally{delete f.dataset.busy;buttons.forEach(b=>b.disabled=false);}
  });
  $('#modal').addEventListener('close',()=>{if(!$('#modal').open){open=false;generation++;loading=false;$('#moderation-panel')?.remove();}});
  window.addEventListener('campusmy:account-changed',()=>{const id=A.state.user?.id||'';if(id!==owner){owner=id;clear();}if(document.body.dataset.page==='account'&&!open)void mount();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&open){generation++;loading=false;$('#moderation-queue').textContent='Paused. Refresh to recheck staff permission.';$('#moderation-log').textContent='';$('#moderation-health').textContent='';}else if(open)void load();});
  setInterval(()=>{if(open)void load();},15000);
  async function postingStatus(){
    if(!A.state.user?.email_confirmed_at){window.CampusShell.go('account');P.toast('Sign in with a confirmed email to view your posting status.');return;}
    const id=A.state.user.id;
    P.show(P.header('Community posting status')+'<div id="posting-status-dialog" class="modal-body">Checking your account…</div>','social-dialog');
    try{const pause=await A.rpc('cm_posting_status');if(id!==A.state.user?.id||!$('#posting-status-dialog'))return;$('#posting-status-dialog').innerHTML=pause?`<p>Community posting is paused until ${E(new Date(pause.until).toLocaleString())}.</p><p>${E(pause.reason)}</p><p>Your account, private planner, accepted-friend messages and privacy controls remain available.</p>`:'<p>No active community posting pause.</p>';}
    catch(e){if(id===A.state.user?.id&&$('#posting-status-dialog'))$('#posting-status-dialog').textContent='Your posting status is temporarily unavailable. Please try again.';}
  }
  window.CampusModeration={mount,status:postingStatus};if(document.body.dataset.page==='account')void mount();
})();
