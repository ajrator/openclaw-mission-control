import { NextResponse } from 'next/server';
import os from 'os';
import { spawn } from 'child_process';
import { getGatewayUrl, getOpenClawDir, isGatewayReachable } from '@/lib/openclaw';

/**
 * POST /api/setup/gateway/start
 * Starts the gateway in the background (npx openclaw@latest gateway). Detached so it outlives the request.
 * Returns after starting; client should poll /api/setup/gateway/status until reachable.
 * Security: only runs fixed command, no user input.
 */
export async function POST() {
    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
        return NextResponse.json(
            { ok: false, error: 'Gateway not configured. Run install first.' },
            { status: 400 }
        );
    }

    if (await isGatewayReachable()) {
        return NextResponse.json({ ok: true, message: 'Already running' });
    }

    const openclawDir = getOpenClawDir();
    const child = spawn('npx', ['openclaw@latest', 'gateway'], {
        stdio: 'ignore',
        detached: true,
        env: { ...process.env, HOME: os.homedir() },
        cwd: openclawDir,
    });
    child.unref();

    return NextResponse.json({ ok: true, message: 'Started' });
}
