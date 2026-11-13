import Link from 'next/link';
import {PageHeader} from './ui';
export type InformationSection={title:string;paragraphs:string[];items?:string[]};
export function InformationPage({title,description,sections}:{title:string;description:string;sections:InformationSection[]}){return <><PageHeader eyebrow="CampusMY / Information" title={title} description={description}/><div className="prose-page">{sections.map(s=><section key={s.title}><h2>{s.title}</h2>{s.paragraphs.map(p=><p key={p}>{p}</p>)}{s.items&&<ul>{s.items.map(x=><li key={x}>{x}</li>)}</ul>}</section>)}<section><h2>Related information</h2><p><Link href="/guidelines">Community guidelines</Link> · <Link href="/privacy">Privacy notice</Link> · <Link href="/terms">Terms</Link> · <Link href="/help">Help</Link></p></section></div></>;}
