import { NextResponse } from 'next/server';
import { getUnifiedTasks } from '@/lib/unified-tasks';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const forceRefresh = searchParams.get('fresh') === '1' || searchParams.get('refresh') === '1';
        const recurringOnly = searchParams.get('recurring') === '1';
        const { tasks, agentOptions } = await getUnifiedTasks(forceRefresh, recurringOnly);
        return NextResponse.json({ tasks, agentOptions });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
