import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
    writeOpenAICodexProfile,
} from '@/lib/openai-oauth';

const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const STATE_COOKIE = 'openai_oauth_state';
const CODE_VERIFIER_COOKIE = 'openai_oauth_code_verifier';
const RETURN_TO_COOKIE = 'openai_oauth_return_to';
const INTEGRATIONS_PATH = '/integrations';

/** Decode JWT payload without verifying (we trust the token endpoint). Extract accountId from https://api.openai.com/auth claim. */
function decodeAccountIdFromAccessToken(accessToken: string): string {
    try {
        const parts = accessToken.split('.');
        if (parts.length !== 3) return '';
        const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf-8')
        ) as Record<string, unknown>;
        const auth = payload['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
        const accountId = auth?.chatgpt_account_id;
        return typeof accountId === 'string' ? accountId : '';
    } catch {
        return '';
    }
}

export async function GET(request: Request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errorParam = url.searchParams.get('error');

    if (errorParam) {
        const dest = new URL(INTEGRATIONS_PATH, url.origin);
        dest.searchParams.set('openai', 'denied');
        return NextResponse.redirect(dest);
    }

    if (!code || !state) {
        const dest = new URL(INTEGRATIONS_PATH, url.origin);
        dest.searchParams.set('openai', 'error');
        return NextResponse.redirect(dest);
    }

    const cookieStore = await cookies();
    const savedState = cookieStore.get(STATE_COOKIE)?.value;
    const codeVerifier = cookieStore.get(CODE_VERIFIER_COOKIE)?.value;
    cookieStore.delete(STATE_COOKIE);
    cookieStore.delete(CODE_VERIFIER_COOKIE);

    if (!savedState || savedState !== state || !codeVerifier) {
        const dest = new URL(INTEGRATIONS_PATH, url.origin);
        dest.searchParams.set('openai', 'error');
        return NextResponse.redirect(dest);
    }

    const clientId = process.env.OPENAI_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.OPENAI_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
        const dest = new URL(INTEGRATIONS_PATH, url.origin);
        dest.searchParams.set('openai', 'error');
        return NextResponse.redirect(dest);
    }

    let redirectUri = process.env.OPENAI_OAUTH_REDIRECT_URI?.trim();
    if (!redirectUri) {
        redirectUri = `${url.origin}/api/openai/oauth/callback`;
    }

    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
    });

    const res = await fetch(OPENAI_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!res.ok) {
        const err = await res.text();
        console.warn('OpenAI OAuth token exchange failed:', res.status, err);
        const dest = new URL(INTEGRATIONS_PATH, url.origin);
        dest.searchParams.set('openai', 'error');
        return NextResponse.redirect(dest);
    }

    const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
    };
    const accessToken = data.access_token?.trim();
    const refreshToken = data.refresh_token?.trim();
    if (!accessToken || !refreshToken) {
        const dest = new URL(INTEGRATIONS_PATH, url.origin);
        dest.searchParams.set('openai', 'error');
        return NextResponse.redirect(dest);
    }

    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    const expires = Date.now() + expiresIn * 1000;
    const accountId = decodeAccountIdFromAccessToken(accessToken);

    writeOpenAICodexProfile({
        access: accessToken,
        refresh: refreshToken,
        expires,
        accountId,
    });

    const rawReturn = cookieStore.get(RETURN_TO_COOKIE)?.value ?? '';
    cookieStore.delete(RETURN_TO_COOKIE);
    const basePath =
        rawReturn.startsWith('/') && /^\/[a-z0-9-_/]*$/i.test(rawReturn)
            ? rawReturn
            : INTEGRATIONS_PATH;
    const dest = new URL(basePath, url.origin);
    dest.searchParams.set('openai', 'connected');
    return NextResponse.redirect(dest);
}
