import { NextResponse } from 'next/server';
import { readNotionIntegrationFile, writeNotionIntegrationFile, invalidateSchemaCache } from '@/lib/notion';

export async function POST(request: Request) {
    const body = await request.json().catch(() => ({}));
    const databaseId = typeof body.databaseId === 'string' ? body.databaseId.trim() : '';
    if (!databaseId) {
        return NextResponse.json({ error: 'Missing databaseId' }, { status: 400 });
    }

    const oauth = readNotionIntegrationFile();
    if (!oauth?.accessToken?.trim()) {
        return NextResponse.json(
            { error: 'Not connected. Complete Notion OAuth first.' },
            { status: 401 }
        );
    }

    writeNotionIntegrationFile({ databaseId });
    invalidateSchemaCache();
    return NextResponse.json({ success: true });
}
