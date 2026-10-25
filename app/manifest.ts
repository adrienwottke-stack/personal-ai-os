import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Nexara · Personal AI OS',
    short_name: 'Nexara',
    description: 'Dein Arbeitsraum für Projektchancen, Projekte und AI Engineering.',
    lang: 'de',
    start_url: '/?view=personal',
    scope: '/',
    display: 'standalone',
    background_color: '#f5f8fb',
    theme_color: '#17283b',
    prefer_related_applications: false,
    icons: [
      { src: '/icons/app-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/app-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/app-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Tag', short_name: 'Tag', description: 'Termine, Aufgaben und schnelle Erfassung öffnen', url: '/?view=personal' },
      { name: 'Chancen', short_name: 'Chancen', description: 'Projektchancen prüfen', url: '/?view=acquisition' },
      { name: 'Arbeit', short_name: 'Arbeit', description: 'Projekte und Arbeitsbelege öffnen', url: '/?view=projects' },
      { name: 'Lernen', short_name: 'Lernen', description: 'Deine Lerneinheit öffnen', url: '/?view=learning' },
    ],
  };
}
