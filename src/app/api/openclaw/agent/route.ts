import { NextResponse } from 'next/server';
import { createAgent } from '@/lib/openclaw';
import { addAgentSelectOption } from '@/lib/notion';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, model, fallbacks } = body;

        if (!name || !model) {
            return NextResponse.json({ error: 'Missing name or model' }, { status: 400 });
        }

        const { id } = createAgent(name, model, fallbacks);

        try {
            await addAgentSelectOption(name);
        } catch (e) {
            console.warn('Could not add agent to Notion Agent select:', (e as Error).message);
        }

        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        if (error.message === 'openclaw.json not found') {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        if (error.message === 'Agent ID already exists') {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
