import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { removeAgentSelectOption } from '@/lib/notion';
import { withGatewayWs } from '@/lib/gateway-client';
import {
    getDefaultSessionKey,
    getGatewayAuth,
    getGatewayControlUiOrigin,
    getGatewayUrl,
} from '@/lib/openclaw';

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

function getAgentSessionKeys(agentDir: string, agentId: string): string[] {
    const keys = new Set<string>();
    keys.add(getDefaultSessionKey(agentId));
    const sessionsPath = path.join(agentDir, 'sessions', 'sessions.json');
    if (!fs.existsSync(sessionsPath)) return [...keys];
    try {
        const raw = fs.readFileSync(sessionsPath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const k of Object.keys(parsed ?? {})) {
            if (typeof k === 'string' && k.startsWith(`agent:${agentId}:`)) {
                keys.add(k);
            }
        }
    } catch {
        // Ignore malformed session metadata; local dir deletion is still authoritative.
    }
    return [...keys];
}

async function deleteGatewaySessionsForAgent(agentDir: string, agentId: string): Promise<void> {
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) return;
    const sessionKeys = getAgentSessionKeys(agentDir, agentId);
    if (sessionKeys.length === 0) return;

    const auth = getGatewayAuth();
    const origin = getGatewayControlUiOrigin();
    await withGatewayWs(gatewayUrl, { auth, origin }, async (_ws, sendReq) => {
        for (const key of sessionKeys) {
            try {
                await sendReq('sessions.delete', { key, deleteTranscript: true });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (!/not found|session not found|404/i.test(msg)) {
                    throw err instanceof Error ? err : new Error(msg);
                }
            }
        }
    });
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

        try {
            await deleteGatewaySessionsForAgent(agentDir, agentId);
        } catch (e) {
            console.warn('Could not delete gateway sessions for agent:', (e as Error).message);
        }

        if (fs.existsSync(agentDir)) {
            fs.rmSync(agentDir, { recursive: true });
        }

        deleteAgentWorkspaceIfExists(openclawDir, agentId);

        try {
            await removeAgentSelectOption(agentName);
        } catch (e) {
            console.warn('Could not remove agent from Notion Agent select:', (e as Error).message);
        }
        if (agentName !== agentId) {
            try {
                await removeAgentSelectOption(agentId);
            } catch (e) {
                console.warn('Could not remove agent ID from Notion Agent select:', (e as Error).message);
            }
        }

        return NextResponse.json({ success: true, id: agentId });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
