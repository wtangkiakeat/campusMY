'use strict';
(() => {
  const A=window.CampusAccount, pending=new Map(), legacy=new Map();
  let owner=A.state.user?.id||'';
  const same=id=>id===(A.state.user?.id||'');
  // Only a missing signature permits fallback. A network failure may have committed a send.
  async function compatible(name,args,oldArgs){
    const id=A.state.user?.id||'',until=legacy.get(name)||0;
    if(until>Date.now())return A.rpc(name,oldArgs);
    try{return await A.rpc(name,args);}catch(e){
      if(e.code!=='PGRST202'||!same(id))throw e;
      legacy.set(name,Date.now()+60000);
      return A.rpc(name,oldArgs);
    }
  }
  async function send(name,args){
    const id=A.state.user?.id||'',scope=name+':'+(args.p_friendship||args.p_room);
    let item=pending.get(scope);
    if(!item||item.body!==args.p_body){item={body:args.p_body,key:crypto.randomUUID()};pending.set(scope,item);}
    const result=await compatible(name,{...args,p_client_id:item.key},args);
    if(same(id)&&pending.get(scope)===item)pending.delete(scope);
    return result;
  }
  function compare(a,b){return a.seq&&b.seq?(BigInt(a.seq)<BigInt(b.seq)?-1:BigInt(a.seq)>BigInt(b.seq)?1:0):a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id);}
  const denied=e=>e?.code==='42501'||/accepted friends only|Join this room|unavailable for your account|not found|friend request/i.test(e?.message||'');
  window.addEventListener('campusmy:account-changed',()=>{const id=A.state.user?.id||'';if(id!==owner){owner=id;pending.clear();legacy.clear();}});
  window.CampusReliability={send,compare,denied,
    messages(id,before){return compatible('cm_messages',{p_friendship:id,p_before:null,p_before_seq:before?.seq||null},{p_friendship:id,p_before:before?.created_at||null});}
  };
})();
