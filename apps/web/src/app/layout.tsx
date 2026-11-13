import type {Metadata} from 'next';
import './globals.css';
import {Providers} from '@/components/providers';
import {Shell} from '@/components/shell';
export const metadata:Metadata={title:{default:'CampusMY — Life between classes',template:'%s · CampusMY'},description:'Plan your UTAR trimester, discover courses, and learn from your campus community.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><Providers><Shell>{children}</Shell></Providers></body></html>;}
