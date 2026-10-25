type JobRow={id:string;kind:string;status:string;profileId?:string|null;input:unknown;result:unknown;createdAt:Date|string};
type OpportunityRow={id:string;analysisId:string|null;contentHash:string;title:string;content:string};
type AnalysisRow={id:string;profileId:string;contentHash:string;result:unknown};
export function currentAnalysis(op:OpportunityRow,analyses:AnalysisRow[],profileId?:string|null){
  const row=analyses.find(a=>a.id===op.analysisId);
  return row&&row.profileId===profileId&&row.contentHash===op.contentHash?row:null;
}
export function actionableJobs(jobs:JobRow[],opportunities:OpportunityRow[],analyses:AnalysisRow[],profileId?:string|null){
  return jobs.filter(j=>{
    const input=j.input as any;
    if(!['failed','stale','interrupted'].includes(j.status)||input?.validationOnly)return false;
    if(j.profileId&&j.profileId!==profileId)return false;
    const op=opportunities.find(o=>o.id===input?.opportunity?.id);
    if(op&&input.opportunity.contentHash!==op.contentHash)return false;
    if(j.kind==='analyze'&&op&&currentAnalysis(op,analyses,profileId))return false;
    return !jobs.some(next=>next.id!==j.id&&next.kind===j.kind&&new Date(next.createdAt)>new Date(j.createdAt)&&
      ['queued','running','completed'].includes(next.status)&&
      (op?(next.input as any)?.opportunity?.id===op.id&&next.profileId===j.profileId:JSON.stringify(next.input)===JSON.stringify(j.input)));
  });
}
// A conservative preselection, never a claim about the person's competency.
export function acquisitionScreen(title:string,content:string,availability?:string|null){
  const reasons:string[]=[];
  if(/\b(senior|lead|architect|architekt)\b/i.test(title))reasons.push('Ausdrücklich erfahrene Gesamtrolle');
  if(/pilotkunden gesucht/i.test(title))reasons.push('Anbieter sucht Kunden, keinen Umsetzungsauftrag');
  if(/vertriebspartner|provisionsbasiert|erfolgsbasiert/i.test(title))reasons.push('Vertrieb statt technischer Umsetzung');
  if(/(?:mindestens|minimum|at least)\s+(?:[3-9]|\d{2})\s+(?:jahre|years)/i.test(content))reasons.push('Mehrjährige Erfahrung ausdrücklich erforderlich');
  const supportsFullWeek=!!availability&&/\b40\s*(?:h|stunden)/i.test(availability);
  if(!supportsFullWeek&&/(?:auslastung|umfang|zeitumfang)\s*:?\s*(?:100\s*%|vollzeit)|\b40\s*(?:h|stunden)\s*(?:\/|pro)\s*woche/i.test(content))reasons.push('Voller Wochenumfang: Verfügbarkeit zuerst klären');
  return {automatic:reasons.length===0,reasons,description:reasons.length?'Vorfilter: manuell prüfen':'Vorauswahl offen; Erfahrung, Zeit, Ort und Lieferumfang prüfen'};
}
export const acquisitionGuidance={availability:'Werkstudent: 20 Stunden/Woche ab 01.12.2026. Freelance: bis 40 Stunden/Woche nach Absprache; Kapazität vor Zusage klären. Dresden/remote, gelegentliche Auswärtstermine nach Vereinbarung.',sources:[
  {label:'TU Dresden · Stellen und studentische Arbeit',url:'https://tu-dresden.de/karriere'},
  {label:'Bundesagentur für Arbeit · Jobsuche',url:'https://www.arbeitsagentur.de/jobsuche/'},
  {label:'freelancermap · gezielt kleine Teilpakete prüfen',url:'https://www.freelancermap.de/'}
]};
export function visibleDraftText(form:HTMLFormElement|null,fallback:string){return form?String(new FormData(form).get('body')||''):fallback;}
