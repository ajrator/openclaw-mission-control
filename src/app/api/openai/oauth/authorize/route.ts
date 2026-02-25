import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
    isOpenAIOAuthEnvSet,
    generateCodeVerifier,
    computeCodeChallenge,
} from '@/lib/openai-oauth';

const OPENAI_AUTH_URL = 'https://auth.openai.com/oauth/authorize';
const STATE_COOKIE = 'openai_oauth_state';
const CODE_VERIFIER_COOKIE = 'openai_oauth_code_verifier';
const RETURN_TO_COOKIE = 'openai_oauth_return_to';
const STATE_MAX_AGE = 600; // 10 min

/** Allow same-origin path only. */
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
    if (!isOpenAIOAuthEnvSet()) {
        const returnTo = safeReturnTo(url.searchParams.get('return_to'), url.origin);
        const basePath = returnTo || '/integrations';
        const redirect = new URL(basePath, url.origin);
        redirect.searchParams.set('openai', 'setup_required');
        return NextResponse.redirect(redirect);
    }

    const clientId = process.env.OPENAI_OAUTH_CLIENT_ID!.trim();
    let redirectUri = process.env.OPENAI_OAUTH_REDIRECT_URI?.trim();
    if (!redirectUri) {
        redirectUri = `${url.origin}/api/openai/oauth/callback`;
    }

    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = computeCodeChallenge(codeVerifier);

    const cookieStore = await cookies();
    const cookieOpts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        maxAge: STATE_MAX_AGE,
        path: '/',
    };
    cookieStore.set(STATE_COOKIE, state, cookieOpts);
    cookieStore.set(CODE_VERIFIER_COOKIE, codeVerifier, cookieOpts);
    const returnTo = safeReturnTo(url.searchParams.get('return_to'), url.origin);
    if (returnTo) {
        cookieStore.set(RETURN_TO_COOKIE, returnTo, cookieOpts);
    }

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid profile email offline_access',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });
    const authUrl = `${OPENAI_AUTH_URL}?${params.toString()}`;
    return NextResponse.redirect(authUrl);
}
