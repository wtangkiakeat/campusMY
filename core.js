(function(root,factory){const value=factory();if(typeof module==='object'&&module.exports)module.exports=value;else root.CampusCore=value;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const types={L:'Lecture',T:'Tutorial',P:'Practical'};
  const time=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
  function weeksOverlap(a,b){return !a?.length||!b?.length||a.some(v=>b.includes(v));}
  function overlaps(a,b){return a.day===b.day&&a.start<b.end&&b.start<a.end&&weeksOverlap(a.weekNumbers,b.weekNumbers);}
  function conflicts(incoming,existing){const hits=[];for(const a of incoming)for(const b of existing)if(overlaps(a,b))hits.push({a,b});return hits;}
  function inTime(meetings,cells){if(!cells.length)return true;const selected=new Set(cells);return meetings.length>0&&meetings.every(m=>{for(let h=Math.floor(m.start/60);h<Math.ceil(m.end/60);h++)if(!selected.has(`${m.day}:${h}`))return false;return true;});}
  function creditKey(n){return n==null?'unknown':n>=4?'4+':String(n);}
  function yearKey(s){const n=String(s||'').match(/(?:year|grade)\s*(\d)/i);return n?(+n[1]>4?'other':n[1]):String(s||'').toLowerCase().includes('foundation')?'other':'unknown';}
  function filterRows(rows,f,sectionMap,view){const kw=f.keyword.trim().toLowerCase();return rows.filter(o=>{
    if(o.campus!==f.campus||f.faculty!=='all'&&o.faculty!==f.faculty)return false;
    if(view==='classes'&&o.term!==f.term)return false;
    const ss=view==='classes'?o.sectionIds.map(id=>sectionMap.get(id)):[];
    const value=f.keywordMode==='code'?o.code:f.keywordMode==='prof'?o.lecturer:o.name;
    if(kw&&!String(value||'').toLowerCase().includes(kw))return false;
    if(!f.credits.includes(creditKey(o.credits)))return false;
    const years=view==='classes'?o.years.map(String):[yearKey(o.year)];
    if(!(years.length?years:['unknown']).some(y=>f.years.includes(y)))return false;
    if(view==='classes'&&(!ss.some(s=>f.types.includes(s.type)&&inTime(s.meetings,f.times))))return false;
    return true;
  }).sort((a,b)=>f.sort==='Code'?String(a.code||'').localeCompare(b.code||'')||a.name.localeCompare(b.name):f.sort==='Name'?a.name.localeCompare(b.name):0);}
  return{days,types,time,weeksOverlap,overlaps,conflicts,inTime,creditKey,yearKey,filterRows};
});
