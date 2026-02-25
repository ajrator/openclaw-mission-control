import { NextResponse } from 'next/server';
import { getDatabaseSchema, isNotionConfigured } from '@/lib/notion';

export async function GET(request: Request) {
    if (!isNotionConfigured()) {
        return NextResponse.json({ error: 'Notion is not configured' }, { status: 503 });
    }
    try {
        const { searchParams } = new URL(request.url);
        const forceRefresh = searchParams.get('fresh') === 'true' || searchParams.get('fresh') === '1';
        const schema = await getDatabaseSchema({ forceRefresh });
        return NextResponse.json(schema);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
