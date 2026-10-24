import type { Metadata, Viewport } from 'next';
import './agenda.css';

export const metadata: Metadata = {
  title: 'Agenda semanal · Centro Finochietto',
  description: 'Agenda semanal de rehabilitación, kinesiología y consultorios.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // El script de la agenda cambia data-theme en <html>, por eso se suprime la advertencia.
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
