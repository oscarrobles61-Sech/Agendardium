# Agendardium · Agenda semanal Centro Finochietto

Réplica en **Next.js** de la agenda semanal del Centro Finochietto (turnos de kinesiología y consultorios,
pacientes, registro/facturación, equipo, noticias del día y copias de seguridad), con los datos guardados en
**Neon Postgres** y lista para publicar en **Vercel**.

## Cómo está armada

- `public/agenda/app.js` y `app/agenda.css`: la aplicación original, con el mismo diseño y las mismas reglas.
  Lo distinto: cada persona entra con su **DNI y PIN** (ver "Ingreso con DNI y PIN"), cada profesional tiene su agenda
  independiente (ver "Perfiles y permisos") y toda la app usa la hora de **Buenos Aires** (`America/Argentina/Buenos_Aires`),
  sin importar la zona horaria de la computadora o del servidor.
- `public/agenda/neon-db.js`: cliente que reemplaza la base del HTML original y habla con las rutas `/api/db/*`.
  Revisa cambios cada 2,5 s, así que lo que carga una persona aparece solo en las pantallas de las demás.
- `app/api/db/*`: rutas de Next.js que leen y escriben en Neon (`DATABASE_URL`). Todas piden sesión.
- `app/api/auth/*`, `lib/auth.ts`, `lib/pin.ts`: ingreso con DNI + PIN, límite de intentos y sesión en una cookie firmada.
- `lib/access.ts`: qué puede ver y modificar cada perfil. Se controla en el servidor, no solo en pantalla.
- `lib/docmap.ts` y `lib/store.ts`: traducen lo que guarda la app a **tablas relacionales** y de vuelta.
- `prisma/`: esquema y migraciones de la base con **Prisma**. Prisma se usa solo para migrar; la app consulta con el driver de Neon.

### Tablas

Basadas en el `schema.sql` de referencia:

| Tabla | Contenido |
|---|---|
| `app_config`, `holidays` | Configuración general y feriados cargados a mano |
| `users`, `user_schedules` | Integrantes (con su `dni` en texto plano y sus `profiles`) y horario por día, con 2ª franja opcional (`from_hour2`/`to_hour2`) y los tipos de sesión que admite cada franja (`session_types`/`session_types2`; vacío = todos) |
| `patients`, `patient_professionals`, `patient_notes` | Pacientes, sus profesionales y notas tipo historia clínica |
| `treatment_plans`, `plan_day_patterns` | Tratamientos (con su tipo de sesión) y su patrón de días/horas |
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
   - `SESSION_SECRET` = un texto largo al azar (recomendado). Firma la cookie de sesión; si no está, se deriva de `DATABASE_URL`. Cargarlo o cambiarlo cierra las sesiones abiertas una vez.
     Si lo cambiás, todos tienen que volver a ingresar.
3. Tocá **Deploy**. Cada build corre `prisma migrate deploy` antes de `next build` (script `vercel-build`),
   así que la base queda siempre al día con las migraciones del repo. Si la base está vacía, la primera pantalla pide crear la cuenta de secretaría (nombre, DNI y PIN).

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

## Perfiles y permisos

Cada integrante puede tener **uno o más perfiles** (por ejemplo Kinesiología y Administración); los permisos se suman.

| Perfil | Qué puede hacer |
|---|---|
| Kinesiología, Médico/a, Profesor/a de educación física, Fonoaudiología, Terapia ocupacional, Nutrición, Psicología | Tiene **su propia agenda y sus horarios**. Ve y modifica solo sus turnos, sus cancelaciones, su registro mensual y sus pacientes. De un paciente que también atiende otro profesional, ve solo sus tratamientos y sus notas (más las de administración). |
| Secretaría, Administración | Ve y edita todo: todas las agendas, pacientes, equipo, ajustes y copias de seguridad. |
| Coordinación | Publica noticias de Inicio. |

Un profesional no puede leer ni escribir la agenda de otro aunque llame a la API a mano: el servidor lo rechaza (403).

## Tipos de sesión

Cada profesional tiene sus **especialidades** (en Equipo). El tipo de sesión sale de la especialidad:

| Tipo | Especialidades |
|---|---|
| **Rehabilitación** | Miembro Superior, Miembro Inferior, Columna, Piso Pélvico, Neuro, Terapia Ocupacional, Psicología, Fonoaudiología |
| **Entrenamiento** | Gimnasio, Pilates, Terapia Cardiorrespiratoria |
| **Práctica diferenciada** | Osteopatía, Vestibular, Nutrición, Evaluación Funcional, Piso Pélvico, ATM, RPG |

Al agendar un tratamiento nuevo solo aparecen las especialidades de ese profesional (si no tiene ninguna cargada,
se usan las de su profesión: por ejemplo Fonoaudiología o Nutrición; si tampoco hay, todas).

- **Entrenamiento**: se elige la frecuencia (1, 2 o 3 veces por semana, o pase libre) y los días. Se cargan solas
  todas las sesiones de un mes desde el día de inicio: si empieza el 28/10, hasta el 27/11 inclusive (el 28/11 arranca
  el mes siguiente). Se saltean feriados, días cerrados, bloqueos y turnos completos.
- **Práctica diferenciada**: cantidad de sesiones libre (hasta 999).

Se guarda en `treatment_plans` (`session_type`, `specialty`, `training_frequency`, `practice`, `until_date`).

### Tipos de sesión por franja

En su horario, cada profesional marca qué tipos de sesión admite cada franja (por ejemplo, martes y jueves de 8 a 12
solo Entrenamiento y de 14 a 20 solo Rehabilitación). Sin ninguno marcado, la franja admite todos (así quedan los
horarios cargados antes de este cambio).

- Con el filtro **Rol** de la secretaría, las franjas que no admiten el tipo de ese rol se ven grisadas con
  "Solo …" y no se pueden tomar; el filtro **Hora** tampoco las cuenta como libres.
- Al agendar, el tipo de sesión se propone según la franja tocada y solo se habilitan los días cuya franja lo admite.
  Las continuaciones y las sesiones restantes respetan el tipo del tratamiento.
- **Limpiar filtros** vacía Rol y Hora de una vez.

### Borrar copias de seguridad

En Ajustes → Copias de seguridad, cada copia tiene **Borrar**, y **Borrar las viejas** deja solo las 3 más recientes
(pide confirmación; lo borrado no se recupera).

## Primera sesión, restantes y continuación

- En el alta de un paciente, **Agendar solo la primera sesión** carga únicamente ese turno; el tratamiento queda con la
  cantidad prevista. Al tocar la sesión en la agenda aparece **Agendar las N restantes** (mismos días, horario,
  feriados y cupos de siempre).
- La **última sesión** del tratamiento (la que llega al total, aunque sea un recupero) se pinta de verde con la marca FIN. Al tocarla aparece
  **Agendar continuación**: se elige la cantidad y los días, y se crea un tratamiento nuevo enlazado al anterior
  (en entrenamiento, el mes siguiente del pase).

## Borradores de turnos

Lo que se escribe en el formulario de un turno se guarda solo como **borrador** en ese navegador (por persona,
profesional y horario). Aparece en gris en la grilla con la etiqueta "borrador": no ocupa lugar ni lo ven los demás.
Al volver a tocar ese horario se recuperan los datos; al confirmar, el formulario se cierra y el borrador se borra.
Los borradores de días pasados se descartan solos.

## Avisos entre secretaría y profesionales (notificaciones push)

- Pestaña **Avisos**: secretaría le manda un aviso a un profesional y cada profesional se lo manda a toda la secretaría.
  Se elige un mensaje predefinido u "Otro (texto libre)"; si el mensaje pide paciente, se abre un buscador con los
  pacientes agendados hoy (un profesional ve solo los suyos). Respuestas rápidas **Recibido** / **En eso**.
- Los mensajes predefinidos de las dos listas se editan en **Ajustes** (solo secretaría) y se guardan en la configuración.
- Cada dispositivo activa los avisos desde la pestaña: llegan a la barra de notificaciones aunque la agenda esté cerrada
  (Web Push con service worker `public/sw.js` y `app/manifest.ts`). En iPhone hace falta iOS 16.4+ y la agenda
  agregada a la pantalla de inicio desde Safari. En la pantalla bloqueada se ven solo las iniciales del paciente.
- Tablas: `notifications`, `notification_recipients`, `push_subscriptions` y `push_keys` (migración `20261102000000_avisos_push`).
- Claves VAPID: la app las genera la primera vez y las guarda en `push_keys`, no hay que configurar nada. Opcionalmente
  se pueden definir `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`mailto:...`) en Vercel; si se cambian las
  claves, cada persona tiene que volver a tocar "Activar" en sus dispositivos.
- Rutas: `/api/avisos` (listar y mandar), `/api/avisos/hoy`, `/api/avisos/leido`, `/api/avisos/responder`,
  `/api/avisos/pendientes`, `/api/push` (suscribir y dar de baja) y `/api/push/prueba`.

## Ingreso con DNI y PIN

- Cada perfil entra con su **DNI y un PIN de 6 a 8 números**. El DNI se guarda en `users.dni`; el PIN solo como
  hash scrypt con sal propia en `user_pins` (nunca el PIN en sí). Se rechazan PIN muy fáciles (111111, 123456, parte del DNI).
- La sesión es una cookie firmada que dura 12 horas y lleva la versión del PIN: si alguien cambia su PIN o la
  secretaría se lo restablece, se cierran sus sesiones abiertas en otros dispositivos.
- **Límite de intentos**: 5 PIN equivocados seguidos con un DNI lo bloquean 15 minutos (30 min, 1 h… en los bloqueos
  siguientes, hasta 24 h). 30 errores en 15 minutos desde una misma IP la bloquean 15 minutos. La secretaría
  desbloquea desde **Equipo**.
- **Paso a PIN sin dejar a nadie afuera**: quien todavía no tiene PIN entra con el DNI (dejando el PIN vacío) y la
  app le pide crearlo en ese momento. En **Equipo** se ve quién ya lo creó. Cuando estén todos, la secretaría tilda
  **Exigir PIN a todos**: desde ahí nadie entra solo con el DNI.
- **Olvidé mi PIN**: en **Equipo → Restablecer PIN** la secretaría genera un PIN temporal (se muestra una sola vez).
  Con ese PIN se entra una vez y se elige uno propio. Cada uno puede cambiar su PIN en **Mi perfil**.
- La secretaría carga o cambia el DNI de cada integrante en **Equipo**. No se permiten dos perfiles con el mismo DNI.
- Si hay perfiles pero ninguno tiene DNI (por ejemplo, después de importar datos), la pantalla de ingreso pide
  elegir un perfil de secretaría o administración y cargar su DNI y PIN. Desde ahí se cargan los del resto.
- Rutas: `/api/auth/login`, `/api/auth/pin` (crear o cambiar el propio) y `/api/auth/pins` (solo administración).

> Además conviene: `SESSION_SECRET` cargado en Vercel (si no, la firma se deriva de `DATABASE_URL`) y
> **Deployment Protection** activado para que las URL de prueba (previews) no queden públicas.

## Turnos guardados a la vez

Cada semana de agenda tiene un número de revisión (`doc_revs`). Al guardar, la app manda la revisión que leyó; si otra
persona guardó esa misma semana en el medio, el servidor rechaza el cambio (409) en vez de pisar sus turnos, la vista
se actualiza y aparece el aviso "Otra persona cambió esta agenda al mismo tiempo". Se vuelve a intentar y listo.

## Usuarios en línea

Arriba a la derecha se ve **cuántas personas más tienen la agenda abierta**; tocándolo aparece la lista con qué está
haciendo cada una (mirando una agenda, en otra sección, inactiva o **agendando un turno**). Sirve para no encimarse:

- El turno que otra persona tiene abierto se marca en **naranja** en la grilla («Laura está agendando…»).
- Si abrís un turno que otra persona está cargando en ese mismo horario, el turno muestra un **aviso**.
- Un profesional ve en qué sección están los demás, pero de las agendas solo ve lo que pasa en la suya.

Viaja con el mismo sondeo de cambios que la agenda ya hace cada pocos segundos (`POST /api/db/versions`), así que no
suma pedidos a Vercel ni horas de cómputo a Neon. Se guarda en la tabla `presence` (una fila por persona, sin datos
de pacientes). Quien cierra la pestaña deja de figurar enseguida; si bloquea el teléfono, en 90 segundos como mucho.
Más de 10 minutos sin tocar la pantalla: figura como inactivo/a.

## Límites de Vercel y Neon

- La agenda consulta cambios cada 6 s mientras se usa, cada 20 s tras 2 minutos sin tocarla, cada 60 s tras 10
  minutos, y nada con la pestaña oculta (antes era cada 2,5 s siempre). Así gasta menos pedidos de Vercel y horas de Neon.
- **Ajustes → Uso de la base** muestra el espacio usado frente al límite de Neon y, si están `NEON_API_KEY` y
  `NEON_PROJECT_ID`, las horas de cómputo y la transferencia del mes. Al entrar, administración ve un aviso si algo pasa el 80%.
  Si cambiás de plan: `NEON_STORAGE_MB`, `NEON_CU_HOURS`, `NEON_TRANSFER_GB`.
- Vercel (plan Hobby) avisa por mail cuando te acercás a sus límites; el uso se ve en el panel → **Usage**.

## Importar datos

`datos-agenda.json` (export de la agenda HTML) **no** está en el repo porque tiene datos personales. Dos formas de cargarlo:

- **Desde Neon**: pegá el archivo `importar-datos.sql` en Neon → SQL Editor y tocá **Run** (después del primer deploy, que crea las tablas). No pisa nada que ya exista.
- **Por la API**: `npm run db:import -- ruta/a/datos-agenda.json https://tu-agenda.vercel.app <DNI de administración> <PIN>`. También acepta una copia descargada desde Ajustes. Conserva los DNI y perfiles ya cargados.

Después de importar, cargá los DNI (ver arriba).
