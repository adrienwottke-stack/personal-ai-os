import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, Laptop, Smartphone } from 'lucide-react';
import { InstallAppButton } from '@/components/app-install';

export const metadata: Metadata = { title: 'Nexara auf Handy und Laptop' };

export default function InstallPage() {
  return <main className="install-page">
    <Link className="install-brand" href="/?view=today"><img src="/icons/app-192.png" width="56" height="56" alt="" /><span>NEXARA<small>Personal AI OS</small></span></Link>
    <header className="install-heading"><div className="eyebrow">DEIN ARBEITSRAUM. AUF BEIDEN GERÄTEN.</div><h1>Ein Tippen. Du bist drin.</h1><p>Installiere Nexara auf deinem Android-Handy und Windows-Laptop. Projektchancen, Aufgaben und Lernen sind überall auf demselben Stand.</p><div className="button-row"><InstallAppButton /><Link className="btn" href="/?view=today">Arbeitsraum öffnen <ArrowRight size={17} /></Link></div></header>
    <div className="install-grid" id="installationsschritte">
      <section className="panel install-device"><Smartphone size={26} /><h2>Auf deinem Android-Handy</h2><ol><li>Öffne diese Seite in <strong>Chrome</strong>.</li><li>Tippe auf <strong>App installieren</strong>. Falls nötig: Chrome-Menü <strong>⋮ → Zum Startbildschirm hinzufügen → Installieren</strong>.</li><li>Öffne <strong>Nexara</strong> über das neue App-Symbol und melde dich mit deinem freigegebenen Google-Konto an.</li></ol><p className="muted">Wenn du diese Seite auf dem Laptop siehst: Scanne den QR-Code mit deinem Handy.</p><div className="install-qr"><img src="/install-qr.svg" width="176" height="176" alt="QR-Code zum Öffnen des Personal AI OS auf deinem Handy" /><span>Direkt zum Arbeitsraum<small>ai-os.127.0.0.1.sslip.io</small></span></div></section>
      <section className="panel install-device"><Laptop size={26} /><h2>Auf deinem Windows-Laptop</h2><ol><li>Öffne Nexara in <strong>Chrome</strong>.</li><li>Klicke auf <strong>App installieren</strong> oder das Installationssymbol rechts in der Adressleiste.</li><li>Bestätige <strong>Installieren</strong>. Nexara öffnet sich in einem eigenen Fenster und ist über das Startmenü erreichbar.</li><li>Für einen Klick: Rechtsklick auf das Nexara-Symbol in der Taskleiste → <strong>An Taskleiste anheften</strong>.</li></ol><p className="muted">Alternative im Chrome-Menü: „Streamen, speichern und teilen“ → „Seite als App installieren“.</p></section>
    </div>
    <section className="install-details"><div><CheckCircle2 size={20} /><span>Ein gemeinsamer Arbeitsstand<small>Du nutzt dieselbe Live-Anwendung und dasselbe freigegebene Konto.</small></span></div><div><CheckCircle2 size={20} /><span>Aktualisierungen kommen automatisch<small>Deine App lädt die aktuelle Fassung vom Server.</small></span></div><div><CheckCircle2 size={20} /><span>Für deinen Alltag online<small>Projektchancen, Bewerbungen und KI-Aufträge benötigen Internet.</small></span></div></section>
    <footer className="install-footer">Ein Konto. Eigene Daten. Sichtbare Entscheidungen.</footer>
  </main>;
}
