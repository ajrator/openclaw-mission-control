import { NextResponse } from 'next/server';
import { readNotionIntegrationFile } from '@/lib/notion';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionDatabaseOption {
    id: string;
    title: string;
}

export async function GET() {
    const oauth = readNotionIntegrationFile();
    const accessToken = oauth?.accessToken?.trim();
    if (!accessToken) {
        return NextResponse.json(
            { error: 'Not connected. Complete Notion OAuth first.' },
            { status: 401 }
        );
    }

    const res = await fetch(`${NOTION_API}/search`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            filter: { property: 'object', value: 'data_source' },
            page_size: 100,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        console.warn('Notion search failed:', res.status, err);
        return NextResponse.json(
            { error: 'Failed to list databases from Notion' },
            { status: res.status === 401 ? 401 : 502 }
        );
    }

    const data = (await res.json()) as {
        results?: Array<{
            id?: string;
            object?: string;
            title?: Array<{ plain_text?: string }>;
        }>;
    };

    const list: NotionDatabaseOption[] = (data.results ?? [])
        .filter((r) => (r.object === 'database' || r.object === 'data_source') && r.id)
        .map((r) => {
            const titleArr = (r.title ?? []) as Array<{ plain_text?: string; text?: { content?: string } }>;
            const title = titleArr.map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim() || 'Untitled';
            return { id: r.id!, title };
        });

    return NextResponse.json({ databases: list });
}
