import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
const STATE_COOKIE = 'notion_oauth_state';
const RETURN_TO_COOKIE = 'notion_oauth_return_to';
const STATE_MAX_AGE = 600; // 10 min

/** Allow same-origin path only (e.g. /integrations or /tasks) */
function safeReturnTo(value: string | null, origin: string): string | null {
    if (!value || !value.startsWith('/')) return null;
    try {
        const u = new URL(value, origin);
        if (u.origin !== origin) return null;
        return u.pathname || null;
    } catch {
        return null;
    }
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
        const returnTo = safeReturnTo(url.searchParams.get('return_to'), url.origin);
        const basePath = returnTo || '/integrations';
        const redirect = new URL(basePath, url.origin);
        redirect.searchParams.set('notion', 'setup_required');
        return NextResponse.redirect(redirect);
    }

    let redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI?.trim();
    if (!redirectUri) {
        redirectUri = `${url.origin}/api/notion/oauth/callback`;
    }

    const state = crypto.randomUUID();
    const cookieStore = await cookies();
    cookieStore.set(STATE_COOKIE, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: STATE_MAX_AGE,
        path: '/',
    });
    const returnTo = safeReturnTo(url.searchParams.get('return_to'), url.origin);
    if (returnTo) {
        cookieStore.set(RETURN_TO_COOKIE, returnTo, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: STATE_MAX_AGE,
            path: '/',
        });
    }

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        owner: 'user',
        state,
    });
    const authUrl = `${NOTION_AUTH_URL}?${params.toString()}`;
    return NextResponse.redirect(authUrl);
}
