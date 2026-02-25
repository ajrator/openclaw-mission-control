import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { isNotionTasksEnabled, writeMissionControlPrefs } from '@/lib/mission-control-prefs';

export async function GET() {
    const enabled = isNotionTasksEnabled();
    return NextResponse.json({ enabled });
}

export async function POST(request: Request) {
    let body: { enabled?: boolean };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof body.enabled !== 'boolean') {
        return NextResponse.json({ error: 'Missing or invalid enabled (boolean)' }, { status: 400 });
    }
    writeMissionControlPrefs({ notionTasksEnabled: body.enabled });
revalidateTag('notion-tasks', 'max');
    revalidateTag('tasks', 'max');
    return NextResponse.json({ enabled: body.enabled });
}
