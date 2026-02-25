import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

type ListEntry = { id: string; [key: string]: unknown };

export async function PATCH(request: Request) {
    try {
        const body = await request.json();
        const { agentIds } = body;

        if (!Array.isArray(agentIds) || agentIds.some((id: unknown) => typeof id !== 'string')) {
            return NextResponse.json(
                { error: 'Body must be { agentIds: string[] }' },
                { status: 400 }
            );
        }

        const openclawDir = path.join(os.homedir(), '.openclaw');
        const configPath = path.join(openclawDir, 'openclaw.json');

        if (!fs.existsSync(configPath)) {
            return NextResponse.json({ error: 'openclaw.json not found' }, { status: 404 });
        }

        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw) as { agents?: { list?: ListEntry[] } };

        if (!config.agents || typeof config.agents !== 'object') {
            (config as any).agents = {};
        }
        const agents = config.agents!;
        if (!Array.isArray(agents.list)) {
            agents.list = [];
        }

        const listById = new Map(agents.list.map((e) => [e.id, e]));
        const ordered: ListEntry[] = [];
        for (const id of agentIds) {
            const entry = listById.get(id);
            if (entry) {
                ordered.push(entry);
                listById.delete(id);
            }
        }
        for (const entry of listById.values()) {
            ordered.push(entry);
        }
        agents.list = ordered;

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
