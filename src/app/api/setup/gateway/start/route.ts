import { NextResponse } from 'next/server';
import os from 'os';
import { spawn } from 'child_process';
import {
    ensureGatewayControlUiConfig,
    getGatewayUrl,
    getOpenClawDir,
    getGatewaySetupState,
    isGatewayReachable,
} from '@/lib/openclaw';

function computeMissionControlOrigins(req: Request): string[] {
    const origins = new Set<string>();
    const configured = process.env.MISSION_CONTROL_ORIGIN?.trim();
    if (configured) origins.add(configured);
    const headerOrigin = req.headers.get('origin')?.trim();
    if (headerOrigin) origins.add(headerOrigin);
    const host = req.headers.get('x-forwarded-host')?.trim() || req.headers.get('host')?.trim();
    const proto = req.headers.get('x-forwarded-proto')?.trim() || 'http';
    if (host) origins.add(`${proto}://${host}`);
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
    return Array.from(origins);
}

/**
 * POST /api/setup/gateway/start
 * Starts the gateway in the background (npx openclaw@latest gateway). Detached so it outlives the request.
 * Returns after starting; client should poll /api/setup/gateway/status until reachable.
 * Security: only runs fixed command, no user input.
 */
export async function POST(req: Request) {
    const stateBefore = await getGatewaySetupState();
    if (stateBefore.state === 'missing') {
        return NextResponse.json(
            {
                ok: false,
                code: 'INSTALL_TOOLING_MISSING',
                step: 'install_openclaw',
                hint: 'OpenClaw is not installed. Run install first from onboarding.',
                stateAfterAttempt: stateBefore,
            },
            { status: 400 }
        );
    }
    if (stateBefore.state === 'installed_not_configured') {
        return NextResponse.json(
            {
                ok: false,
                code: 'START_FAILED',
                step: 'configure_gateway',
                hint: 'OpenClaw is installed but not configured. Run install/configure first.',
                stateAfterAttempt: stateBefore,
            },
            { status: 400 }
        );
    }

    const gatewayUrl = getGatewayUrl();
    if (!gatewayUrl) {
        return NextResponse.json(
            {
                ok: false,
                code: 'START_FAILED',
                step: 'configure_gateway',
                error: 'Gateway not configured. Run install first.',
                hint: 'Run install/configure, then retry start.',
                stateAfterAttempt: stateBefore,
            },
            { status: 400 }
        );
    }

    const healBeforeStart = ensureGatewayControlUiConfig(computeMissionControlOrigins(req));
    if (healBeforeStart.error) {
        return NextResponse.json(
            {
                ok: false,
                code: 'CONFIG_WRITE_FAILED',
                step: 'patch_control_ui',
                hint: 'Mission Control could not update Control UI settings in ~/.openclaw/openclaw.json.',
                error: healBeforeStart.error,
                stateAfterAttempt: stateBefore,
            },
            { status: 500 }
        );
    }

    if (await isGatewayReachable()) {
        const stateAfter = await getGatewaySetupState();
        console.info('[setup.gateway.start]', { state_before: stateBefore.state, action: 'start', state_after: stateAfter.state, error_code: null });
        return NextResponse.json({
            ok: true,
            message: healBeforeStart.changed ? 'Already running (Control UI settings updated)' : 'Already running',
            repairedControlUi: healBeforeStart.changed,
            stateAfterAttempt: stateAfter,
        });
    }

    try {
        const openclawDir = getOpenClawDir();
        const child = spawn('npx', ['openclaw@latest', 'gateway'], {
            stdio: 'ignore',
            detached: true,
            env: { ...process.env, HOME: os.homedir() },
            cwd: openclawDir,
        });
        child.unref();
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Start failed';
        console.warn('[setup.gateway.start]', { state_before: stateBefore.state, action: 'start', state_after: stateBefore.state, error_code: 'START_FAILED' });
        return NextResponse.json(
            {
                ok: false,
                code: 'START_FAILED',
                step: 'start_gateway',
                error: message,
                hint: 'Could not launch gateway process. Verify installation and retry.',
                stateAfterAttempt: stateBefore,
            },
            { status: 500 }
        );
    }

    const stateAfter = await getGatewaySetupState();
    console.info('[setup.gateway.start]', { state_before: stateBefore.state, action: 'start', state_after: stateAfter.state, error_code: null });
    return NextResponse.json({ ok: true, message: 'Started', stateAfterAttempt: stateAfter });
}
