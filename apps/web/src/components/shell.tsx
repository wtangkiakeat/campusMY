'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {CalendarDays,UserRound,HelpCircle,ChevronRight,Bell,ShieldCheck} from 'lucide-react';
import {useApp} from './providers';

export function Mark(){return <svg viewBox="0 0 32 32" width="34" height="34" fill="none" aria-hidden="true"><path d="M5 7h10v18H5zM17 7h10v18H17z" stroke="currentColor" strokeWidth="2"/><path d="M5 12h22M10 3v8M22 3v8M10 17h5M17 21h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;}

export function Shell({children}:{children:React.ReactNode}){
 const path=usePathname(),{me,plan}=useApp();
 const operator=['admin','moderator'].includes(me?.role||'');
 const isPlanner=path.startsWith('/timetable');
 const links=[{href:'/courses',label:'Courses'},{href:'/timetable',label:'Timetable'},{href:'/notifications',label:'Notifications'},{href:'/verify-university',label:'Verification'},...(operator?[{href:'/admin',label:'Moderation'}]:[])];
 return <div className="app-frame">
   <a className="skip-link" href="#main-content">Skip to content</a>
   <header className="site-header"><div className="header-inner">
     <Link className="site-brand" href="/courses" aria-label="CampusMY — UTAR"><Mark/><span><strong>CampusMY</strong><b>UTAR</b></span></Link>
     <nav className="site-nav" aria-label="Main navigation">{links.map(({href,label})=><Link key={href} href={href} aria-current={path.startsWith(href)?'page':undefined} className={path.startsWith(href)?'active':''}>{label}</Link>)}</nav>
     <div className="header-account"><Link className="header-help" href="/help" aria-label="Help and information"><HelpCircle size={20}/></Link><Link className="button header-login" href={me?'/account':'/login'}><UserRound size={16}/>{me?'My account':'Sign in'}</Link></div>
   </div></header>
   <div className="site-context"><div><span>Universiti Tunku Abdul Rahman</span><span className="context-campus">{plan?.campus||'Kampar'} campus</span><Link href="/guidelines">Community guidelines <ChevronRight size={13}/></Link></div></div>
   <div className={`site-workspace ${isPlanner?'planner-workspace':''}`}>
     {!isPlanner&&<aside className="sidebar" aria-label="Your campus account">
       <section className="profile-panel"><span className="profile-avatar"><UserRound size={31} strokeWidth={1.4}/></span><h2>{me?'My account':'Welcome to CampusMY'}</h2><p>{me?(me.membership?.verified?'UTAR email verified':'University verification needed'):'Your UTAR timetable and student community.'}</p><Link className={`button ${me?'':'primary'} full`} href={me?'/account':'/login'}>{me?'Account settings':'Sign in'}</Link>{!me&&<Link className="profile-verify" href="/verify-university">About student verification</Link>}</section>
       <section className="sidebar-menu"><h2>My campus</h2><Link href="/timetable"><CalendarDays size={15}/><span>My timetable</span><ChevronRight size={12}/></Link><Link href="/notifications"><Bell size={15}/><span>Notifications</span><ChevronRight size={12}/></Link><Link href="/verify-university"><ShieldCheck size={15}/><span>Verify UTAR email</span><ChevronRight size={12}/></Link></section>
       <section className="sidebar-info"><h2>Before registration</h2><p>Confirm class times and eligibility with the official UTAR source.</p><Link href="/help">Help & information <ChevronRight size={12}/></Link></section>
     </aside>}
     <main id="main-content" className="main-sheet"><div className="page-container">{children}<footer className="footer"><span>CampusMY · Independent UTAR student platform</span><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/help">Help</Link></div></footer></div></main>
   </div>
 </div>;
}
