import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { writeNotionIntegrationFile } from '@/lib/notion';

const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';
const NOTION_VERSION = '2022-06-28';
const STATE_COOKIE = 'notion_oauth_state';
const RETURN_TO_COOKIE = 'notion_oauth_return_to';
const TASKS_PATH = '/tasks';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errorParam = url.searchParams.get('error');

    if (errorParam) {
        return NextResponse.redirect(new URL(`${TASKS_PATH}?notion=denied`, url.origin));
    }

    if (!code || !state) {
        return NextResponse.redirect(new URL(`${TASKS_PATH}?notion=error`, url.origin));
    }

    const cookieStore = await cookies();
    const savedState = cookieStore.get(STATE_COOKIE)?.value;
    cookieStore.delete(STATE_COOKIE);

    if (!savedState || savedState !== state) {
        return NextResponse.redirect(new URL(`${TASKS_PATH}?notion=error`, url.origin));
    }

    const clientId = process.env.NOTION_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
        return NextResponse.redirect(new URL(`${TASKS_PATH}?notion=error`, url.origin));
    }

    let redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI?.trim();
    if (!redirectUri) {
        redirectUri = `${url.origin}/api/notion/oauth/callback`;
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`, 'utf-8').toString('base64');
    const res = await fetch(NOTION_TOKEN_URL, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Notion-Version': NOTION_VERSION,
            Authorization: `Basic ${basicAuth}`,
        },
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        console.warn('Notion OAuth token exchange failed:', res.status, err);
        return NextResponse.redirect(new URL(`${TASKS_PATH}?notion=error`, url.origin));
    }

    const data = (await res.json()) as {
        access_token?: string;
        workspace_id?: string;
        workspace_name?: string;
    };
    const accessToken = data.access_token?.trim();
    if (!accessToken) {
        return NextResponse.redirect(new URL(`${TASKS_PATH}?notion=error`, url.origin));
    }

    writeNotionIntegrationFile({
        accessToken,
        workspaceId: data.workspace_id,
        workspaceName: data.workspace_name ?? undefined,
    });

    const rawReturn = cookieStore.get(RETURN_TO_COOKIE)?.value ?? '';
    cookieStore.delete(RETURN_TO_COOKIE);
    const basePath = rawReturn.startsWith('/') && /^\/[a-z0-9-_/]*$/i.test(rawReturn) ? rawReturn : TASKS_PATH;
    const dest = new URL(basePath, url.origin);
    dest.searchParams.set('step', 'select-database');
    return NextResponse.redirect(dest);
}
