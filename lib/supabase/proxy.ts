import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/lib/logger';

const log = logger('proxy');
const PUBLIC_PREFIXES = ['/login', '/api'];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    const ctx = { pathname: request.nextUrl.pathname, message: error.message };
    // An absent session is normal (e.g. first visit, signed out) and surfaces as
    // AuthSessionMissingError; anything else is worth a closer look.
    if (error.name === 'AuthSessionMissingError') log.debug('no session', ctx);
    else log.warn('getUser failed', ctx);
  }
  const isPublic = PUBLIC_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return response;
}
