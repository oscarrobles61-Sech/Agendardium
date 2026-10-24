'use client';

import { useEffect } from 'react';

// La agenda es la misma aplicación del HTML original (public/agenda/app.js), que maneja el DOM
// por su cuenta. Se cargan los scripts en orden y una sola vez: primero el cliente de Neon.
const SCRIPTS = ['/agenda/neon-db.js', '/agenda/app.js'];

let started = false;

function load(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar ' + src));
    document.body.appendChild(s);
  });
}

export default function AgendaLoader() {
  useEffect(() => {
    if (started) return;
    started = true;
    (async () => {
      for (const src of SCRIPTS) await load(src);
    })().catch(err => {
      console.error(err);
      const app = document.getElementById('app');
      if (app) app.innerHTML = '<div class="empty"><h2>No se pudo cargar la agenda. Recargá la página.</h2></div>';
    });
  }, []);
  return null;
}
