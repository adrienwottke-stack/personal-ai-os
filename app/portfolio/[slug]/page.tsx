import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { config } from '@/lib/config';
import { object } from '@/lib/util';
export const dynamic='force-dynamic';
export default async function CaseStudy({params}:{params:Promise<{slug:string}>}){if(config().demo)notFound();const p=await (await db()).publication.findUnique({where:{slug:(await params).slug},select:{active:true,snapshot:true,approvedAt:true}});if(!p?.active)notFound();const c=object<Record<string,string>>(p.snapshot);return <article className="public-page case-study"><Link href="/portfolio">← Alle Projekte</Link><header><div className="eyebrow">GEPRÜFTE CASE STUDY</div><h1>{c.title}</h1><p className="lead">{c.summary}</p></header>{Object.entries({problem:'Problem',ownContribution:'Mein Beitrag',implementation:'Technische Umsetzung',aiSupport:'KI-Unterstützung',result:'Überprüftes Ergebnis',limitations:'Grenzen'}).map(([key,title])=><section key={key}><h2>{title}</h2><p>{c[key]}</p></section>)}<footer>Diese Fassung wurde am {p.approvedAt.toLocaleDateString('de-DE')} freigegeben.</footer></article>;}
