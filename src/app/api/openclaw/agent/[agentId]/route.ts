import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { removeAgentSelectOption } from '@/lib/notion';

const MAIN_AGENT_ID = 'main';

/** OpenClaw uses ~/.openclaw/workspace-<agentId> for non-default agents. Only delete if it lives under openclawDir. */
function deleteAgentWorkspaceIfExists(openclawDir: string, agentId: string): void {
    const workspaceDir = path.join(openclawDir, `workspace-${agentId}`);
    if (!fs.existsSync(workspaceDir)) return;
    try {
        const real = fs.realpathSync(workspaceDir);
        const openclawReal = fs.realpathSync(openclawDir);
        if (!real.startsWith(openclawReal + path.sep) && real !== openclawReal) return;
    } catch {
        return;
    }
    if (fs.statSync(workspaceDir).isDirectory()) {
        fs.rmSync(workspaceDir, { recursive: true });
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ agentId: string }> }
) {
    try {
        const { agentId } = await params;

        if (!agentId) {
            return NextResponse.json({ error: 'Missing agent ID' }, { status: 400 });
        }

        if (agentId === MAIN_AGENT_ID) {
            return NextResponse.json(
                { error: 'The main agent (Jarvis) cannot be deleted' },
                { status: 403 }
            );
        }

        const openclawDir = path.join(os.homedir(), '.openclaw');
        const configPath = path.join(openclawDir, 'openclaw.json');
        const agentDir = path.join(openclawDir, 'agents', agentId);

        if (!fs.existsSync(configPath)) {
            return NextResponse.json({ error: 'openclaw.json not found' }, { status: 404 });
        }

        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw);

        if (!config.agents?.list || !Array.isArray(config.agents.list)) {
            return NextResponse.json({ error: 'Agent not found in config' }, { status: 404 });
        }

        const index = config.agents.list.findIndex((a: { id: string }) => a.id === agentId);
        if (index === -1) {
            return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
        }

        const agentEntry = config.agents.list[index] as { id: string; identity?: { name?: string } } | undefined;
        const agentName = agentEntry?.identity?.name ?? agentId;

        config.agents.list.splice(index, 1);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

        if (fs.existsSync(agentDir)) {
            fs.rmSync(agentDir, { recursive: true });
        }

        deleteAgentWorkspaceIfExists(openclawDir, agentId);

        try {
            await removeAgentSelectOption(agentName);
        } catch (e) {
            console.warn('Could not remove agent from Notion Agent select:', (e as Error).message);
        }

        return NextResponse.json({ success: true, id: agentId });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
