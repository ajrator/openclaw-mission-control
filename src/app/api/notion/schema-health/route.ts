import { NextResponse } from 'next/server';
import {
    ensureTaskDatabaseProperties,
    getTaskDatabaseSchemaHealth,
    isNotionConfigured,
} from '@/lib/notion';

export async function GET() {
    if (!isNotionConfigured()) {
        return NextResponse.json({ error: 'Notion is not configured' }, { status: 503 });
    }
    try {
        const health = await getTaskDatabaseSchemaHealth();
        return NextResponse.json(health);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST() {
    if (!isNotionConfigured()) {
        return NextResponse.json({ error: 'Notion is not configured' }, { status: 503 });
    }
    try {
        await ensureTaskDatabaseProperties();
        const health = await getTaskDatabaseSchemaHealth();
        return NextResponse.json({ repaired: true, health });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

