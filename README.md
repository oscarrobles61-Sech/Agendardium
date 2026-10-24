# Agendardium · Agenda semanal Centro Finochietto

Réplica en **Next.js** de la agenda semanal del Centro Finochietto (turnos de kinesiología y consultorios,
pacientes, registro/facturación, equipo, noticias del día y copias de seguridad), con los datos guardados en
**Neon Postgres** y lista para publicar en **Vercel**.

## Cómo está armada

- `public/agenda/app.js` y `app/agenda.css`: la aplicación original, sin cambios de comportamiento ni de diseño.
- `public/agenda/neon-db.js`: cliente que reemplaza la base del HTML original y habla con las rutas `/api/db/*`.
  Revisa cambios cada 2,5 s, así que lo que carga una persona aparece solo en las pantallas de las demás.
- `app/api/db/*`: rutas de Next.js que leen y escriben en Neon (`DATABASE_URL`).
- `db/schema.sql`: dos tablas (`docs` con cada documento en JSONB y `doc_versions` para detectar cambios).
  La app las crea sola la primera vez que se conecta.
- `proxy.ts`: contraseña opcional para todo el sitio (ver más abajo).

Si `DATABASE_URL` no está definida, la agenda funciona en **modo local** (datos solo en ese navegador), igual que el HTML original.

## Puesta en marcha

### 1. Crear la base en Neon
1. Entrá a <https://console.neon.tech> y creá un proyecto (región sugerida: la más cercana a tus usuarios, p. ej. São Paulo).
2. En el panel del proyecto tocá **Connect**, elegí **Pooled connection** y copiá la cadena que empieza con `postgresql://…`.
3. (Opcional) Para crear las tablas a mano: abrí el **SQL Editor** y pegá el contenido de `db/schema.sql`. Si no, se crean solas.

### 2. Publicar en Vercel
1. Entrá a <https://vercel.com/new>, importá el repo `oscarrobles61-Sech/Agendardium` (framework: Next.js, sin cambiar nada más).
2. Antes de **Deploy**, en **Environment Variables** agregá:
   - `DATABASE_URL` = la cadena de Neon del paso anterior.
   - Recomendado: `BASIC_AUTH_USER` y `BASIC_AUTH_PASSWORD` (ver "Seguridad").
3. Tocá **Deploy**. Al abrir la URL, la primera pantalla pide crear la cuenta de secretaría.

> Alternativa: en Vercel → tu proyecto → **Storage** → **Neon** podés crear la base desde Vercel; ahí `DATABASE_URL` se carga sola.

Si cambiás una variable de entorno después, hacé **Redeploy** para que se aplique.

### 3. Desarrollo local
```bash
cp .env.example .env.local   # completá DATABASE_URL
npm install
npm run db:setup             # opcional, crea las tablas
npm run dev                  # http://localhost:3000
```

## Seguridad

La agenda guarda datos de pacientes. Igual que en el HTML original, cada perfil entra con su PIN, pero la API no
distingue usuarios: cualquiera que conozca la URL podría consultarla. Por eso conviene activar una de estas dos opciones:

- **Usuario y contraseña del sitio**: definí `BASIC_AUTH_USER` y `BASIC_AUTH_PASSWORD` en Vercel. El navegador los pide una vez y después se entra con el PIN de siempre.
- **Vercel Deployment Protection** (Settings → Deployment Protection), si el equipo tiene cuentas de Vercel.

## Pasar datos desde el HTML original

En el HTML original, en **Ajustes → Copias de seguridad → Descargar copia actual**, bajá el archivo `.json`.
En la app nueva, creá la cuenta de secretaría, andá a **Ajustes → Copias de seguridad → Restaurar desde archivo** y elegí ese archivo.
Se reemplazan los datos (perfiles, pacientes, agenda, facturación y noticias) por los de la copia; los PIN siguen siendo los mismos.
