import { NextResponse } from 'next/server';
import {
    getTaskDetails,
    appendPageContent,
    replacePageContent,
    isNotionConfigured,
    invalidateTasksCache,
} from '@/lib/notion';

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    if (!isNotionConfigured()) {
        return NextResponse.json({ error: 'Notion is not configured' }, { status: 503 });
    }
    try {
        const { pageId } = await params;
        if (!pageId) {
            return NextResponse.json({ error: 'Missing pageId' }, { status: 400 });
        }
        const details = await getTaskDetails(pageId);
        return NextResponse.json(details);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ pageId: string }> }
) {
    if (!isNotionConfigured()) {
        return NextResponse.json({ error: 'Notion is not configured' }, { status: 503 });
    }
    try {
        const { pageId } = await params;
        const body = await request.json().catch(() => ({}));
        if (!pageId) {
            return NextResponse.json({ error: 'Missing pageId' }, { status: 400 });
        }
        const content = typeof body.content === 'string' ? body.content : undefined;
        const append = typeof body.append === 'string' ? body.append : undefined;
        if (content !== undefined) {
            await replacePageContent(pageId, content);
            invalidateTasksCache();
            return NextResponse.json({ success: true });
        }
        if (append !== undefined) {
            await appendPageContent(pageId, append);
            invalidateTasksCache();
            return NextResponse.json({ success: true });
        }
        return NextResponse.json(
            { error: 'Provide content (replace entire page body) or append (add to page)' },
            { status: 400 }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
