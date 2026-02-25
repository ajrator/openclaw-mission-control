import { NextResponse } from 'next/server';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { getOpenClawDir, getOpenClawConfigPath, getGatewayUrl } from '@/lib/openclaw';

/**
 * POST /api/setup/gateway/install
 * Ensures ~/.openclaw exists and openclaw.json has gateway config. Runs npx openclaw@latest doctor
 * to initialize if needed; if config still missing, writes minimal secure defaults.
 * Security: only runs fixed command (npx openclaw@latest doctor), no user input.
 */
export async function POST() {
    const openclawDir = getOpenClawDir();
    const configPath = getOpenClawConfigPath();

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
            return NextResponse.json({ ok: true, message: 'Already configured' });
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
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    if (fs.existsSync(configPath) && getGatewayUrl()) {
        return NextResponse.json({ ok: true });
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
    fs.writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2) + '\n', 'utf-8');
    try {
        fs.chmodSync(configPath, 0o600);
    } catch {
        /* ignore */
    }
    return NextResponse.json({ ok: true });
}
