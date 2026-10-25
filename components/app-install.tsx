'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, WifiOff } from 'lucide-react';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};
type InstallContextValue = {
  installed: boolean;
  requestInstall: () => Promise<boolean>;
};
const InstallContext = createContext<InstallContextValue | null>(null);

export function AppInstallProvider({ children }: { children: React.ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [online, setOnline] = useState(true);
  const prompt = useRef<InstallEvent | null>(null);

  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const updateDisplay = () => setInstalled(display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const updateNetwork = () => setOnline(navigator.onLine);
    const capturePrompt = (event: Event) => { event.preventDefault(); prompt.current = event as InstallEvent; };
    const finishInstallation = () => { prompt.current = null; setInstalled(true); };
    updateDisplay();
    updateNetwork();
    display.addEventListener('change', updateDisplay);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', finishInstallation);
    if ('serviceWorker' in navigator && window.isSecureContext) {
      // This worker caches only the public offline notice, never account data.
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    }
    return () => {
      display.removeEventListener('change', updateDisplay);
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', finishInstallation);
    };
  }, []);

  async function requestInstall() {
    const event = prompt.current;
    if (!event) return false;
    prompt.current = null;
    try {
      await event.prompt();
      await event.userChoice;
      return true;
    } catch {
      return false;
    }
  }

  return <InstallContext.Provider value={{ installed, requestInstall }}>
    {!online && <div className="connection-banner" role="status"><WifiOff size={17} /><span>Keine Internetverbindung. Dein Arbeitsraum benötigt eine Verbindung.</span></div>}
    {children}
  </InstallContext.Provider>;
}

export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const context = useContext(InstallContext);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  if (!context || context.installed) return compact ? null : <span className="app-installed"><CheckCircle2 size={18} /> Im App-Fenster geöffnet</span>;

  async function install() {
    if (!context) return;
    setBusy(true);
    try {
      if (!await context.requestInstall()) {
        if (window.location.pathname !== '/install') window.location.assign('/install');
        else setHelp(true);
      }
    } finally { setBusy(false); }
  }

  return <>
    <button className={`btn ${compact ? 'app-install-compact' : 'primary'}`} onClick={() => void install()} disabled={busy} aria-label="App installieren" title="Auf Handy oder Laptop installieren">
      <ArrowDownToLine size={17} /><span>{busy ? 'Bitte warten …' : 'App installieren'}</span>
    </button>
    {help && <p className="install-help-message" role="status">Öffne das Chrome-Menü ⋮ und wähle „App installieren“ beziehungsweise „Zum Startbildschirm hinzufügen“. Auf dem Laptop findest du „Nexara installieren“ auch in der Adressleiste.</p>}
  </>;
}
