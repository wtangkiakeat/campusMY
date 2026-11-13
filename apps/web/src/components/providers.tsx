'use client';
import {createContext,useCallback,useContext,useEffect,useState} from 'react';
import type {Me,Plan,PlanEntry} from '@/lib/types';
import {api,message} from '@/lib/api';
import {getSupabase} from '@/lib/supabase';
import {makePlan,readPlans,savePlans,STORAGE_KEY} from '@/lib/planner';
type AppState={me:Me|null;authLoading:boolean;refreshMe:()=>Promise<void>;plans:Plan[];plan:Plan|null;setPlan:(p:Plan)=>void;replacePlan:(id:string,p:Plan)=>void;deletePlan:(id:string)=>void;selectPlan:(id:string)=>void;addEntry:(e:PlanEntry,campus:string,term:string)=>void;removeEntry:(id:string)=>void;notice:(text:string)=>void;reloadPlans:()=>void;newPlan:()=>void};
const Context=createContext<AppState|null>(null);
export function Providers({children}:{children:React.ReactNode}) {
 const [me,setMe]=useState<Me|null>(null),[authLoading,setAuthLoading]=useState(true),[plans,setPlans]=useState<Plan[]>([]),[active,setActive]=useState(''),[toast,setToast]=useState('');
 const notice=useCallback((text:string)=>setToast(text),[]);
 const refreshMe=useCallback(async()=>{const sb=getSupabase();if(!sb){setMe(null);setAuthLoading(false);return;}try{const {data}=await sb.auth.getSession();setMe(data.session?await api<Me>('/me'):null);}catch(e){notice(message(e));setMe(null);}finally{setAuthLoading(false);}},[notice]);
 useEffect(()=>{void refreshMe();const {data}=getSupabase()?.auth.onAuthStateChange(()=>{setTimeout(()=>void refreshMe(),0);})||{};return()=>data?.subscription.unsubscribe();},[refreshMe]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),5500);return()=>clearTimeout(id);},[toast]);
 const storageKey=me?`${STORAGE_KEY}:${me.id}`:STORAGE_KEY;
 useEffect(()=>{let list=readPlans(storageKey);if(!list.length){list=[makePlan()];try{savePlans(list,storageKey);}catch{}}setPlans(list);let selected='';try{selected=localStorage.getItem(`${storageKey}:active`)||'';}catch{}setActive(list.some(p=>p.id===selected)?selected:list[0].id);},[storageKey]);
 const choose=(id:string)=>{setActive(id);try{localStorage.setItem(`${storageKey}:active`,id);}catch{}};
 const persist=(next:Plan[])=>{setPlans(next);try{savePlans(next,storageKey);}catch{notice('Device storage is unavailable. Export your timetable to keep a copy.');}};
 const plan=plans.find(p=>p.id===active)||plans[0]||null;
 const setPlan=(p:Plan)=>{if(!plans.some(x=>x.id===p.id)&&plans.length>=30){notice('You can keep up to 30 timetables on this device. Export a backup before clearing unused plans.');return;}persist(plans.some(x=>x.id===p.id)?plans.map(x=>x.id===p.id?p:x):[...plans,p]);choose(p.id);};
 const addEntry=(e:PlanEntry,campus:string,term:string)=>{let target=plan;if(!target||target.campus!==campus||target.term!==term)target=plans.find(p=>p.campus===campus&&p.term===term)||makePlan(campus,term);if(target.entries.some(x=>x.offering&&x.offering===e.offering)){notice('This course is already in that timetable. Remove it before changing groups.');return;}setPlan({...target,entries:[...target.entries,e]});notice(`${e.code||e.name} added to ${target.name}.`);};
 return <Context.Provider value={{me,authLoading,refreshMe,plans,plan,setPlan,replacePlan:(id,p)=>{persist(plans.map(x=>x.id===id?p:x).filter((x,i,all)=>all.findIndex(y=>y.id===x.id)===i));choose(p.id);},deletePlan:id=>{let next=plans.filter(p=>p.id!==id);if(!next.length)next=[makePlan()];persist(next);choose(next[0].id);},selectPlan:choose,addEntry,removeEntry:id=>{if(plan)setPlan({...plan,entries:plan.entries.filter(e=>e.id!==id)});},notice,reloadPlans:()=>{const p=readPlans(storageKey);setPlans(p);if(p.length){let selected='';try{selected=localStorage.getItem(`${storageKey}:active`)||'';}catch{}choose(p.some(x=>x.id===selected)?selected:p[0].id);};},newPlan:()=>setPlan({...makePlan(),name:`Timetable ${plans.length+1}`})}}>{children}{toast&&<div className="toast" role="status"><span>{toast}</span><button aria-label="Dismiss notification" onClick={()=>setToast('')}>×</button></div>}</Context.Provider>;
}
export function useApp(){const ctx=useContext(Context);if(!ctx)throw Error('Application context is missing');return ctx;}
