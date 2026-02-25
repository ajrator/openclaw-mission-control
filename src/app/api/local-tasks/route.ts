import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { getAllLocalTasks, createLocalTask } from '@/lib/local-tasks';
import type { TaskStatus } from '@/lib/notion';

export async function GET() {
    try {
        const tasks = getAllLocalTasks();
        return NextResponse.json({ tasks });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { title, status, agent, description, important, urgent, dueDate, recurring, cron, cronJobId, recurUnit, recurInterval, recurTime, recurEnd, recurEndCount, recurEndDate } = body;
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
        const task = createLocalTask({
            title: title.trim(),
            status: ['To Do', 'Doing', 'Done'].includes(status) ? (status as TaskStatus) : 'To Do',
            agent: agent.trim(),
            description: descriptionVal,
            important: typeof important === 'boolean' ? important : undefined,
            urgent: typeof urgent === 'boolean' ? urgent : undefined,
            dueDate: dueDate != null ? (typeof dueDate === 'string' ? dueDate : null) : undefined,
            recurring: typeof recurring === 'boolean' ? recurring : undefined,
            cron: typeof cron === 'string' ? cron.trim() || null : undefined,
            cronJobId: typeof cronJobId === 'string' ? cronJobId.trim() || null : undefined,
            recurUnit: recurUnit != null && typeof recurUnit === 'string' ? recurUnit.trim() || null : undefined,
            recurInterval: typeof recurInterval === 'number' ? recurInterval : undefined,
            recurTime: recurTime != null && typeof recurTime === 'string' ? recurTime.trim() || null : undefined,
            recurEnd: recurEnd != null && typeof recurEnd === 'string' ? recurEnd.trim() || null : undefined,
            recurEndCount: typeof recurEndCount === 'number' ? recurEndCount : undefined,
            recurEndDate: recurEndDate != null && typeof recurEndDate === 'string' ? recurEndDate.trim() || null : undefined,
        });
        revalidateTag('tasks', 'max');
        return NextResponse.json(task);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
