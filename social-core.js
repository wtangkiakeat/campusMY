'use strict';
((root)=>{
const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||'');
function inviteToken(value,origin){try{const u=new URL(value);if(u.origin!==new URL(origin).origin)return null;const m=u.hash.match(/^#invite\/([0-9a-f-]+)$/i);return m&&uuid(m[1])?m[1]:null;}catch{return null;}}
function snapshot(current,includeManual=false){return {name:current.plan.name,campus:current.campus,term:current.term,entries:current.entries.filter(e=>includeManual||!e.manual).map(e=>({name:e.name,code:e.code||'',groups:e.groups||'',meetings:e.meetings.map(m=>({day:m.day,start:m.start,end:m.end,room:m.room||'',lecturer:m.lecturer||'',weekNumbers:m.weekNumbers||[]}))}))};}
function agenda(plan){return plan.entries.flatMap(e=>e.meetings.map(m=>({...m,name:e.name,code:e.code,groups:e.groups}))).sort((a,b)=>days.indexOf(a.day)-days.indexOf(b.day)||a.start-b.start);}
const api={esc,uuid,inviteToken,snapshot,agenda,days};root.CampusSocialCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
