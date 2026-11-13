import { getSupabase } from './supabase';
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1').replace(/\/$/,'');
export class ApiError extends Error { constructor(public status:number, message:string) { super(message); this.name='ApiError'; } }
export async function api<T>(path:string, init:RequestInit = {}):Promise<T> {
  const supabase = getSupabase();
  const { data } = supabase ? await supabase.auth.getSession() : {data:{session:null}};
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type','application/json');
  if(data.session?.access_token) headers.set('Authorization',`Bearer ${data.session.access_token}`);
  let response:Response;
  try { response = await fetch(`${API_URL}${path}`, {...init,headers,cache:'no-store'}); }
  catch { throw new ApiError(0,'The course service could not be reached. Please try again shortly.'); }
  if(!response.ok) {
    const payload = await response.json().catch(()=>null);
    let message = typeof payload?.detail === 'string' ? payload.detail : typeof payload?.error?.message === 'string' ? payload.error.message : '';
    if(!message) message = response.status===401?'Sign in to continue.':response.status===403?'UTAR verification is required for this action.':response.status===409?'This changed on another device. Refresh and try again.':response.status===422?'Please check the form fields.':response.status===429?'You have made too many requests. Please wait and try again.':'Something went wrong. Please try again.';
    throw new ApiError(response.status,message);
  }
  if(response.status===204) return undefined as T;
  return normalizeDates(await response.json()) as T;
}
export const json = (body:unknown) => JSON.stringify(body);
export function message(error:unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }

function normalizeDates(value:unknown):unknown { if(Array.isArray(value))return value.map(normalizeDates);if(value&&typeof value==='object'){return Object.fromEntries(Object.entries(value).map(([key,item])=>{if(/(?:created|updated|expires|verified|published|fetched|checked|generated)_at$/.test(key)&&typeof item==='number'&&Number.isFinite(item)){const date=new Date(Math.abs(item)<1e11?item*1000:item);if(!Number.isNaN(date.getTime()))return [key,date.toISOString()];}return [key,normalizeDates(item)];}));}return value;}
