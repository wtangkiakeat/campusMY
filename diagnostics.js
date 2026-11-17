'use strict';
(() => {
  const areas=new Set(['auth','friends','sharing','dm','rooms','moderation','app','csp']),seen=new Map();
  let owner=window.CampusAccount.state.user?.id||'';
  function record(area,error){
    if(!areas.has(area))return;
    // Never send error text, stack, URLs, identifiers, tokens, content or email addresses.
    const kind=area==='csp'?'csp':error?.code==='42501'?'access':/^PGRST20[25]$|^42P01$/.test(error?.code||'')?'schema':/fetch|network|connection|offline/i.test(error?.message||'')?'connection':'unexpected';
    const key=area+':'+kind,now=Date.now();if(now-(seen.get(key)||0)<60000)return;seen.set(key,now);
    if(seen.size>40)seen.delete(seen.keys().next().value);
    const A=window.CampusAccount;if(!A.state.user?.email_confirmed_at)return;
    void A.rpc('cm_record_health',{p_area:area,p_kind:kind,p_version:window.CAMPUS_CONFIG.version}).catch(()=>{});
  }
  window.CampusDiagnostics={record};
  window.addEventListener('campusmy:account-changed',()=>{const id=window.CampusAccount.state.user?.id||'';if(id!==owner){owner=id;seen.clear();}});
  window.addEventListener('error',()=>record('app',{}));
  window.addEventListener('unhandledrejection',()=>record('app',{}));
  document.addEventListener('securitypolicyviolation',()=>record('csp',{}));
})();
