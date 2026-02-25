import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { updateLocalTask } from '@/lib/local-tasks';

type RouteParams = { params: Promise<{ id: string }> };

/** Mark a local task as Done and clean up session. Used by agent completion instruction. */
export async function POST(request: Request, { params }: RouteParams) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing task id' }, { status: 400 });
    const task = updateLocalTask(id, { status: 'Done' });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    revalidateTag('tasks', 'max');
    return NextResponse.json(task);
}
