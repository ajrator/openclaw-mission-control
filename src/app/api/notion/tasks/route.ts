import { NextResponse } from 'next/server';
import { queryTasksFromNotion, createTask, isNotionConfigured } from '@/lib/notion';
import type { TaskStatus } from '@/lib/notion';

export async function GET(request: Request) {
    if (!isNotionConfigured()) {
        return NextResponse.json({ error: 'Notion is not configured' }, { status: 503 });
    }
    try {
        const { searchParams } = new URL(request.url);
        const forceRefresh = searchParams.get('fresh') === '1' || searchParams.get('refresh') === '1';
        const tasks = await queryTasksFromNotion({ forceRefresh });
        return NextResponse.json({ tasks });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    if (!isNotionConfigured()) {
        return NextResponse.json({ error: 'Notion is not configured' }, { status: 503 });
    }
    try {
        const body = await request.json().catch(() => ({}));
        const { title, status, agent, description, dueDate, important, urgent, recurring, cron, cronJobId, recurUnit, recurInterval, recurTime, recurEnd, recurEndCount, recurEndDate } = body;
        if (!title || typeof title !== 'string' || !agent || typeof agent !== 'string') {
            return NextResponse.json(
                { error: 'Missing or invalid title or agent' },
                { status: 400 }
            );
        }
        const descriptionVal = typeof description === 'string' ? description.trim() : '';
        if (!descriptionVal) {
            return NextResponse.json(
                { error: 'Description is required' },
                { status: 400 }
            );
        }
        const task = await createTask({
            title: title.trim(),
            status: ['To Do', 'Doing', 'Done'].includes(status) ? (status as TaskStatus) : undefined,
            agent: agent.trim(),
            description: descriptionVal,
            dueDate: dueDate !== undefined ? (dueDate == null || typeof dueDate === 'string' ? dueDate : null) : undefined,
            important: typeof important === 'boolean' ? important : undefined,
            urgent: typeof urgent === 'boolean' ? urgent : undefined,
            recurring: typeof recurring === 'boolean' ? recurring : undefined,
            cron: typeof cron === 'string' ? cron.trim() || undefined : undefined,
            cronJobId: typeof cronJobId === 'string' ? cronJobId.trim() || undefined : undefined,
            recurUnit: recurUnit != null && typeof recurUnit === 'string' ? recurUnit.trim() || undefined : undefined,
            recurInterval: typeof recurInterval === 'number' ? recurInterval : undefined,
            recurTime: recurTime != null && typeof recurTime === 'string' ? recurTime.trim() || undefined : undefined,
            recurEnd: recurEnd != null && typeof recurEnd === 'string' ? recurEnd.trim() || undefined : undefined,
            recurEndCount: typeof recurEndCount === 'number' ? recurEndCount : undefined,
            recurEndDate: recurEndDate != null && typeof recurEndDate === 'string' ? recurEndDate.trim() || undefined : undefined,
        });
        return NextResponse.json({ task });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
