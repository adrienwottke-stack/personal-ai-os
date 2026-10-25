import Link from 'next/link';
import { db } from '@/lib/db';
import { config } from '@/lib/config';
import { object } from '@/lib/util';
export const dynamic='force-dynamic';
export default async function Portfolio(){const publications=config().demo?[]:await (await db()).publication.findMany({where:{active:true},orderBy:{approvedAt:'desc'},select:{slug:true,snapshot:true}});return <div className="public-page"><header><span className="eyebrow">NEXARA / AI ENGINEERING</span><h1>Projekte mit nachvollziehbaren Ergebnissen.</h1><p>Problem, eigener Beitrag, technische Umsetzung und geprüfte Grenzen.</p></header><div className="project-grid">{publications.map(p=>{const c=object<Record<string,string>>(p.snapshot);return <Link className="panel" key={p.slug} href={`/portfolio/${p.slug}`}><h2>{c.title}</h2><p>{c.summary}</p><span>Case Study ansehen →</span></Link>;})}</div>{!publications.length&&<div className="empty"><h2>Noch keine freigegebenen Case Studies.</h2><p>Öffentliche Fassungen erscheinen nach der Prüfung ihrer Inhalte und Verwendungsrechte.</p></div>}</div>;}
