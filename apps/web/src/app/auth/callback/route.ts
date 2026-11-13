import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
export async function GET(request:Request){const url=new URL(request.url),code=url.searchParams.get('code');const sbUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(code&&sbUrl&&key){const store=await cookies();const client=createServerClient(sbUrl,key,{cookies:{getAll:()=>store.getAll(),setAll:values=>values.forEach(({name,value,options})=>store.set(name,value,options))}});const {error}=await client.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL('/account',url.origin));}return NextResponse.redirect(new URL('/login?error=callback',url.origin));}
