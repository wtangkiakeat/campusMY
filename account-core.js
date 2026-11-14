(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CampusAccountCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function username(value){return /^[a-zA-Z][a-zA-Z0-9_]{2,23}$/.test(value);}
  function password(value){return typeof value==='string'&&value.length>=12&&value.length<=128;}
  function publicKey(value){if(typeof value!=='string')return false;if(value.startsWith('sb_publishable_'))return true;try{const s=value.split('.')[1];return JSON.parse(atob(s.replace(/-/g,'+').replace(/_/g,'/'))).role==='anon';}catch{return false;}}
  function config(url,key){try{const u=new URL(url);return u.protocol==='https:'&&u.hostname.endsWith('.supabase.co')&&publicKey(key);}catch{return false;}}
  return{username,password,publicKey,config};
});
