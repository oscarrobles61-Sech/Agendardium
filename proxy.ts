import { NextResponse, type NextRequest } from 'next/server';

// Protección opcional con usuario y contraseña (HTTP Basic Auth) para todo el sitio.
// Se activa definiendo BASIC_AUTH_USER y BASIC_AUTH_PASSWORD en Vercel.
export function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const [u, ...rest] = atob(header.slice(6)).split(':');
      if (u === user && rest.join(':') === pass) return NextResponse.next();
    } catch {}
  }
  return new NextResponse('Acceso restringido', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Agenda", charset="UTF-8"' }
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
