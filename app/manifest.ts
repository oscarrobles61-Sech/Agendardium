import type { MetadataRoute } from 'next';

// Permite instalar la agenda como app (requisito de iPhone para recibir avisos push).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Agenda · Centro Finochietto',
    short_name: 'Agenda',
    description: 'Agenda semanal de rehabilitación, kinesiología y consultorios.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#FFFFFF',
    theme_color: '#0A5CA8',
    lang: 'es-AR',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
