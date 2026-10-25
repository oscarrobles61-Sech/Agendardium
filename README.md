# Agendardium · Agenda semanal Centro Finochietto

Réplica en **Next.js** de la agenda semanal del Centro Finochietto (turnos de kinesiología y consultorios,
pacientes, registro/facturación, equipo, noticias del día y copias de seguridad), con los datos guardados en
**Neon Postgres** y lista para publicar en **Vercel**.

## Cómo está armada

- `public/agenda/app.js` y `app/agenda.css`: la aplicación original, con el mismo diseño y las mismas reglas.
  Lo único distinto es el ingreso: cada persona entra con su **DNI** (ver "Ingreso con DNI").
- `public/agenda/neon-db.js`: cliente que reemplaza la base del HTML original y habla con las rutas `/api/db/*`.
  Revisa cambios cada 2,5 s, así que lo que carga una persona aparece solo en las pantallas de las demás.
- `app/api/db/*`: rutas de Next.js que leen y escriben en Neon (`DATABASE_URL`).
- `lib/docmap.ts` y `lib/store.ts`: traducen lo que guarda la app a **tablas relacionales** y de vuelta.
- `prisma/`: esquema y migraciones de la base con **Prisma**. Prisma se usa solo para migrar; la app consulta con el driver de Neon.

### Tablas

Basadas en el `schema.sql` de referencia:

| Tabla | Contenido |
|---|---|
| `app_config`, `holidays` | Configuración general y feriados cargados a mano |
| `users`, `user_schedules` | Perfiles (con su `dni` en texto plano) y horario por día |
| `patients`, `patient_professionals`, `patient_notes` | Pacientes, sus profesionales y notas tipo historia clínica |
| `treatment_plans`, `plan_day_patterns` | Tratamientos y su patrón de días/horas |
| `agenda_weeks`, `sessions`, `agenda_blocks` | Semanas de agenda por profesional, cada turno y los bloqueos de "Cancelar agenda" |
| `billing_months`, `billing_patients` | Registro mensual de facturado y liquidado |
| `news` | Noticias de Inicio |
| `docs`, `doc_versions` | Copias de seguridad automáticas y el contador de cambios para refrescar pantallas |

Cada tabla tiene una columna `extra` (jsonb) donde va cualquier dato de la app que no tenga columna propia,
para que nada se pierda. No hay contraseñas ni hashes guardados.

Si `DATABASE_URL` no está definida, la agenda funciona en **modo local** (datos solo en ese navegador), igual que el HTML original.

## Puesta en marcha

### 1. Crear la base en Neon
1. Entrá a <https://console.neon.tech> y creá un proyecto (región sugerida: la más cercana a tus usuarios, p. ej. São Paulo).
2. En el panel del proyecto tocá **Connect**, elegí **Pooled connection** y copiá la cadena que empieza con `postgresql://…`.
3. Copiá también la conexión directa (con **Pooled connection** apagado, sin `-pooler` en el host): es la que conviene usar para migrar.

### 2. Publicar en Vercel
1. Entrá a <https://vercel.com/new>, importá el repo `oscarrobles61-Sech/Agendardium` (framework: Next.js, sin cambiar nada más).
2. Antes de **Deploy**, en **Environment Variables** agregá:
   - `DATABASE_URL` = la cadena *pooled* de Neon.
   - `DATABASE_URL_UNPOOLED` = la cadena directa (opcional; si no está, las migraciones usan `DATABASE_URL`).
3. Tocá **Deploy**. Cada build corre `prisma migrate deploy` antes de `next build` (script `vercel-build`),
   así que la base queda siempre al día con las migraciones del repo. Si la base está vacía, la primera pantalla pide crear la cuenta de secretaría (nombre y DNI).

> Alternativa: en Vercel → tu proyecto → **Storage** → **Neon** podés crear la base desde Vercel; ahí `DATABASE_URL` se carga sola.

Si cambiás una variable de entorno después, hacé **Redeploy** para que se aplique.

> Si la base ya tenía las tablas porque la abriste con una versión anterior de la app, la primera migración
> la "adopta" sola (ver `scripts/migrate.mjs`): no se pierde ningún dato.

### 3. Desarrollo local
```bash
cp .env.example .env.local   # completá DATABASE_URL
npm install
npm run db:migrate           # aplica las migraciones de prisma/migrations
npm run dev                  # http://localhost:3000
```

### Migraciones con Prisma
- Cambiá `prisma/schema.prisma` y corré `npm run db:migrate:new -- --name descripcion` contra una base de
  desarrollo (por ejemplo una *branch* de Neon). Eso genera una carpeta nueva en `prisma/migrations`.
- Subí esa carpeta al repo: el próximo deploy de Vercel la aplica en producción.
- `npm run db:status` muestra qué migraciones faltan aplicar.

## Ingreso con DNI

- Cada perfil entra escribiendo su DNI (se guarda en texto plano en `users.dni` y se compara sin puntos ni espacios).
- La secretaría carga o cambia el DNI de cada integrante en **Equipo**. No se permiten dos perfiles con el mismo DNI.
- Si hay perfiles pero ninguno tiene DNI (por ejemplo, después de importar datos), la pantalla de ingreso pide
  elegir el perfil de secretaría y cargar su DNI. Desde ahí se cargan los del resto.
- También se puede cargar a mano en Neon → SQL Editor: `UPDATE users SET dni = '12345678' WHERE name = 'Pamela';`

> El sitio no tiene contraseña ni usuario aparte: cualquiera que conozca la URL puede usar la API y ver los datos,
> incluidos los DNI. Si más adelante se quiere cerrar, Vercel tiene **Deployment Protection** (Settings → Deployment Protection).

## Importar datos

`datos-agenda.json` (export de la agenda HTML) **no** está en el repo porque tiene datos personales. Dos formas de cargarlo:

- **Desde Neon**: pegá el archivo `importar-datos.sql` en Neon → SQL Editor y tocá **Run** (después del primer deploy, que crea las tablas). No pisa nada que ya exista.
- **Por la API**: `npm run db:import -- ruta/a/datos-agenda.json https://tu-agenda.vercel.app`. También acepta una copia descargada desde Ajustes.

Después de importar, cargá los DNI (ver arriba).
