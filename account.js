'use strict';
(() => {
const config=window.CAMPUS_CONFIG,valid=window.CampusAccountCore;
const configured=valid.config(config?.supabaseUrl,config?.supabaseKey)&&!!window.supabase?.createClient;
const client=configured?window.supabase.createClient(config.supabaseUrl,config.supabaseKey,{auth:{storageKey:'campusmy-supabase-auth',flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}}):null;
let state={ready:false,user:null,profile:null,todos:[],problem:'',recovery:false},generation=0;
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const key=name=>'campusmy-'+name+':'+(state.user?.id||'guest');
const write=(name,value)=>localStorage.setItem(key(name),JSON.stringify(value));
const emit=()=>window.dispatchEvent(new Event('campusmy:account-changed'));
const redirect=()=>location.origin+location.pathname;
const schemaMessage='Your Supabase tables are not ready. Run CampusMY-supabase-setup.sql in the project’s SQL Editor.';
function dbError(error){if(!error)return;if(['PGRST205','42P01','PGRST202'].includes(error.code))throw Error(schemaMessage);throw Error(error.message||'Supabase could not complete this request.');}
function stillOwner(user){if(state.user?.id!==user.id)throw Error('Your account changed. Please try again.');}
function requireUser(){if(!client)throw Error('Supabase is not configured.');if(!state.user)throw Error('Sign in first.');return state.user;}
function preferences(){const p={theme:'dark',notifications:true,defaultBoard:'General',keywords:[],...(state.profile?.preferences||read(key('preferences'),{}))};return {...p,theme:['dark','light','system'].includes(p.theme)?p.theme:'dark',keywords:Array.isArray(p.keywords)?p.keywords.filter(x=>typeof x==='string').slice(0,20):[]};}
function inbox(){const value=read(key('inbox'),[]);return Array.isArray(value)?value.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string').slice(0,50):[];}
function notify(title,message=''){if(!preferences().notifications)return;const value=inbox();value.unshift({id:crypto.randomUUID(),title,message,date:new Date().toISOString(),read:false});write('inbox',value.slice(0,50));emit();}
async function refresh(){const version=++generation;state.problem='';
 try{
  const {data:{user},error}=await client.auth.getUser();if(error){const {data:{session}}=await client.auth.getSession();if(session)throw error;}
  if(version!==generation)return;
  const changed=state.user?.id!==user?.id;state.user=user||null;state.profile=null;state.todos=[];
  if(changed){cloudVersion=null;window.CampusPlanner.setIdentity(user?.id||null);}
  if(user){
    const result=await client.from('campusmy_profiles').select('*').eq('user_id',user.id).maybeSingle();dbError(result.error);
    if(version!==generation)return;
    let profile=result.data;
    if(!profile){const candidate=user.user_metadata?.username;const result=await client.from('campusmy_profiles').insert({user_id:user.id,username:valid.username(candidate)?candidate:'user_'+user.id.slice(0,8)}).select().single();dbError(result.error);profile=result.data;}
    const todos=await client.from('campusmy_todos').select('*').eq('user_id',user.id).order('created_at',{ascending:false});dbError(todos.error);
    if(version!==generation)return;state.profile=profile;state.todos=todos.data||[];
  }else{const local=read(key('todos'),[]);state.todos=Array.isArray(local)?local:[];}
 }catch(error){if(version===generation)state.problem=error.message||'Account connection failed.';}
 if(version===generation){state.ready=true;emit();}
}
async function saveProfile(values){const user=requireUser();if(!valid.username(values.username))throw Error('Use 3–24 letters, numbers or underscores, starting with a letter.');if(!['Kampar','Sungai Long'].includes(values.campus))throw Error('Choose a campus.');const result=await client.from('campusmy_profiles').upsert({user_id:user.id,username:values.username,display_name:String(values.display_name||'').trim().slice(0,80),campus:values.campus,preferences:preferences(),updated_at:new Date().toISOString()}).select().single();if(result.error?.code==='23505')throw Error('That user ID is already taken. Choose another.');dbError(result.error);stillOwner(user);state.profile=result.data;notify('Profile updated','Your account details have been saved.');emit();}
async function savePreferences(values){const next={...preferences(),...values};write('preferences',next);emit();if(state.user){const user=state.user;const result=await client.from('campusmy_profiles').update({preferences:next,updated_at:new Date().toISOString()}).eq('user_id',state.user.id).select().single();dbError(result.error);stillOwner(user);state.profile=result.data;emit();}}
async function addTodo(title,due){title=title.trim();if(!title||title.length>160)throw Error('Enter a task with 1–160 characters.');if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))throw Error('Choose a valid due date.');const task={id:crypto.randomUUID(),title,completed:false,due_date:due||null,created_at:new Date().toISOString()};if(state.user){const user=state.user;const {data,error}=await client.from('campusmy_todos').insert({...task,user_id:state.user.id}).select().single();dbError(error);stillOwner(user);state.todos.unshift(data);}else{state.todos.unshift(task);write('todos',state.todos);}emit();}
async function todoAction(id,remove=false){const task=state.todos.find(t=>t.id===id);if(!task)return;if(state.user){const user=state.user;const q=remove?client.from('campusmy_todos').delete():client.from('campusmy_todos').update({completed:!task.completed});const {error}=await q.eq('id',id).eq('user_id',state.user.id);dbError(error);stillOwner(user);}if(remove)state.todos=state.todos.filter(t=>t.id!==id);else task.completed=!task.completed;if(!state.user)write('todos',state.todos);emit();}
let cloudVersion=null,pendingCloudVersion=null;
window.CampusAccount={get state(){return state;},configured,preferences,inbox,notify,refresh,
 async rpc(name,args={}){const user=requireUser();if(!user.email_confirmed_at)throw Error("Confirm your email before using friends, chat or reviews.");const {data:{session}}=await client.auth.getSession();stillOwner(user);if(session?.user.id!==user.id)throw Error("Please sign in again.");const {data,error}=await client.rpc(name,args).setHeader("Authorization","Bearer "+session.access_token);dbError(error);stillOwner(user);return data;},saveProfile,savePreferences,addTodo,todoAction,
 async signIn(email,password){if(!client)throw Error('Supabase is not configured.');const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error;await refresh();notify('Signed in','Welcome back to CampusMY.');},
 async signUp(email,password,username){if(!client)throw Error('Supabase is not configured.');if(!valid.username(username))throw Error('User ID: 3–24 letters, numbers or underscores; start with a letter.');if(!valid.password(password))throw Error('Use a password between 12 and 128 characters.');const {data,error}=await client.auth.signUp({email,password,options:{data:{username},emailRedirectTo:redirect()}});if(error)throw error;if(data.session)await refresh();return !!data.session;},
 async signOut(){if(client){const {error}=await client.auth.signOut();if(error)throw error;}generation++;state={ready:true,user:null,profile:null,todos:read('campusmy-todos:guest',[]),problem:'',recovery:false};cloudVersion=null;window.CampusPlanner.setIdentity(null);emit();},
 async resetPassword(email){if(!client)throw Error('Supabase is not configured.');const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:redirect()});if(error)throw error;},
 async resend(email){if(!client)throw Error('Supabase is not configured.');const address=email||state.user?.email;if(!address)throw Error('Enter the email address used to create your account.');const {error}=await client.auth.resend({type:'signup',email:address,options:{emailRedirectTo:redirect()}});if(error)throw error;},
 async changePassword(current,password){const user=requireUser();if(!valid.password(password))throw Error('Use a password between 12 and 128 characters.');if(!state.recovery){const {error}=await client.auth.signInWithPassword({email:user.email,password:current});if(error)throw Error('Your current password was not accepted.');}const {error}=await client.auth.updateUser({password});if(error)throw error;state.recovery=false;notify('Password changed','Your new password is now active.');emit();},
 async changeEmail(current,email){const user=requireUser();const {error:reauth}=await client.auth.signInWithPassword({email:user.email,password:current});if(reauth)throw Error('Your current password was not accepted.');const {error}=await client.auth.updateUser({email},{emailRedirectTo:redirect()});if(error)throw error;notify('Email change requested','Check both your current and new inboxes for confirmation.');},
 markRead(){write('inbox',inbox().map(n=>({...n,read:true})));emit();},
 async loadOnline(){const user=requireUser();const {data,error}=await client.from('campusmy_planners').select('payload,version').eq('user_id',user.id).maybeSingle();dbError(error);stillOwner(user);pendingCloudVersion=data?{owner:user.id,version:data.version}:null;return data?.payload||null;},
 confirmOnlineLoaded(){const user=requireUser();if(pendingCloudVersion?.owner!==user.id)throw Error('Load your account’s online copy again.');cloudVersion=pendingCloudVersion.version;pendingCloudVersion=null;},
 async saveOnline(){const user=requireUser();if(cloudVersion===null){const {data,error}=await client.from('campusmy_planners').select('version').eq('user_id',user.id).maybeSingle();dbError(error);stillOwner(user);if(data)throw Error('An online copy already exists. Load it first to avoid replacing newer work.');cloudVersion=0;}const {data:{session}}=await client.auth.getSession();stillOwner(user);if(session?.user.id!==user.id)throw Error('Please sign in again.');const {data,error}=await client.rpc('campusmy_save_planner',{p_payload:window.CampusPlanner.getSaved(),p_expected_version:cloudVersion}).setHeader('Authorization','Bearer '+session.access_token);dbError(error);stillOwner(user);cloudVersion=data;notify('Timetable saved online','Your private plan is saved to your Supabase account.');}
};
if(client){client.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY'){state.recovery=true;window.dispatchEvent(new Event('campusmy:recovery'));}if(event==='SIGNED_OUT'){generation++;state.recovery=false;state.user=null;state.profile=null;state.todos=read('campusmy-todos:guest',[]);cloudVersion=null;window.CampusPlanner.setIdentity(null);emit();}else if(event!=='INITIAL_SESSION')setTimeout(()=>void refresh(),0);});client.auth.getSession().then(({data:{session},error})=>{if(error){state.problem=error.message;state.ready=true;emit();}else if(session)void refresh();else{state.ready=true;state.todos=read('campusmy-todos:guest',[]);emit();}}).catch(error=>{state.problem=error.message;state.ready=true;emit();});}
else{state.ready=true;state.todos=read('campusmy-todos:guest',[]);}
})();
