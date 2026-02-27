import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import {
    getOpenClawDir,
    getOpenClawConfigPath,
    getGatewayUrl,
    getGatewaySetupPreflight,
    getGatewaySetupState,
    mapSetupErrorCode,
} from '@/lib/openclaw';

/**
 * POST /api/setup/gateway/install
 * Ensures ~/.openclaw exists and openclaw.json has gateway config. Runs npx openclaw@latest doctor
 * to initialize if needed; if config still missing, writes minimal secure defaults.
 * Security: only runs fixed command (npx openclaw@latest doctor), no user input.
 */
export async function POST() {
    const stateBefore = await getGatewaySetupState();
    const openclawDir = getOpenClawDir();
    const configPath = getOpenClawConfigPath();

    const preflight = await getGatewaySetupPreflight();
    if (!preflight.ok) {
        const code = 'INSTALL_TOOLING_MISSING';
        return NextResponse.json(
            {
                ok: false,
                code,
                step: 'preflight',
                hint: preflight.message ?? 'Install requires Node.js, npx, and writable home directory.',
                preflight,
            },
            { status: 400 }
        );
    }

    if (!fs.existsSync(openclawDir)) {
        fs.mkdirSync(openclawDir, { recursive: true });
        try {
            fs.chmodSync(openclawDir, 0o700);
        } catch {
            /* ignore */
        }
    }

    if (fs.existsSync(configPath)) {
        const gatewayUrl = getGatewayUrl();
        if (gatewayUrl) {
            const stateAfter = await getGatewaySetupState();
            console.info('[setup.gateway.install]', { state_before: stateBefore.state, action: 'install', state_after: stateAfter.state, error_code: null });
            return NextResponse.json({ ok: true, message: 'Already configured', stateAfterAttempt: stateAfter });
        }
    }

    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn('npx', ['openclaw@latest', 'doctor'], {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, HOME: os.homedir() },
                cwd: openclawDir,
            });
            let stderr = '';
            child.stderr?.on('data', (d) => { stderr += d.toString(); });
            child.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(stderr || `exit ${code}`));
            });
            child.on('error', reject);
            setTimeout(() => {
                child.kill('SIGTERM');
                reject(new Error('Install timed out'));
            }, 60000);
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Install failed';
        const code = mapSetupErrorCode(message);
        console.warn('[setup.gateway.install]', { state_before: stateBefore.state, action: 'install', state_after: stateBefore.state, error_code: code });
        return NextResponse.json(
            {
                ok: false,
                error: message,
                code,
                step: 'install_openclaw',
                hint: code === 'INSTALL_NETWORK_ERROR'
                    ? 'Check internet access and retry.'
                    : code === 'INSTALL_TIMEOUT'
                        ? 'Install timed out. Retry once connectivity is stable.'
                        : 'Install requires Node.js and npx in PATH.',
            },
            { status: 500 }
        );
    }

    if (fs.existsSync(configPath) && getGatewayUrl()) {
        const stateAfter = await getGatewaySetupState();
        console.info('[setup.gateway.install]', { state_before: stateBefore.state, action: 'install', state_after: stateAfter.state, error_code: null });
        return NextResponse.json({ ok: true, stateAfterAttempt: stateAfter });
    }

    const port = 18789;
    const token = crypto.randomBytes(24).toString('hex');
    const origin = process.env.MISSION_CONTROL_ORIGIN || 'http://localhost:3000';
    const minimalConfig = {
        gateway: {
            port,
            mode: 'local',
            bind: 'loopback',
            auth: { mode: 'token', token },
            controlUi: {
                allowedOrigins: [origin],
                dangerouslyDisableDeviceAuth: true,
            },
        },
    };
    try {
        fs.writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2) + '\n', 'utf-8');
        try {
            fs.chmodSync(configPath, 0o600);
        } catch {
            /* ignore */
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not write openclaw.json';
        console.warn('[setup.gateway.install]', { state_before: stateBefore.state, action: 'install', state_after: stateBefore.state, error_code: 'CONFIG_WRITE_FAILED' });
        return NextResponse.json(
            {
                ok: false,
                error: message,
                code: 'CONFIG_WRITE_FAILED',
                step: 'write_config',
                hint: 'Mission Control could not write ~/.openclaw/openclaw.json. Check file permissions and retry.',
            },
            { status: 500 }
        );
    }
    const stateAfter = await getGatewaySetupState();
    console.info('[setup.gateway.install]', { state_before: stateBefore.state, action: 'install', state_after: stateAfter.state, error_code: null });
    return NextResponse.json({ ok: true, usedFallbackConfig: true, stateAfterAttempt: stateAfter });
}
