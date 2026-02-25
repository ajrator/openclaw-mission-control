import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getHeartbeatModel, getModelsWithProviders } from '@/lib/openclaw';

const getConfigPath = () => path.join(os.homedir(), '.openclaw', 'openclaw.json');

export async function GET() {
    try {
        const model = getHeartbeatModel();
        const models = getModelsWithProviders();
        return NextResponse.json({ model, models });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const configPath = getConfigPath();
        if (!fs.existsSync(configPath)) {
            return NextResponse.json({ error: 'openclaw.json not found' }, { status: 404 });
        }

        const body = await request.json().catch(() => ({}));
        const rawModel = body.model;
        const modelId = typeof rawModel === 'string' ? rawModel.trim() : rawModel === null ? '' : undefined;
        if (modelId === undefined) {
            return NextResponse.json(
                { error: 'Missing or invalid body.model (string or null to clear)' },
                { status: 400 }
            );
        }

        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw) as Record<string, unknown>;
        if (!config.agents || typeof config.agents !== 'object') {
            return NextResponse.json({ error: 'Invalid config' }, { status: 500 });
        }

        const agents = config.agents as Record<string, unknown>;
        let defaults = agents.defaults as Record<string, unknown> | undefined;
        if (!defaults) {
            defaults = {};
            agents.defaults = defaults;
        }
        let heartbeat = defaults.heartbeat as Record<string, unknown> | undefined;
        if (modelId === '') {
            if (heartbeat && 'model' in heartbeat) {
                delete heartbeat.model;
                if (Object.keys(heartbeat).length === 0 && defaults.heartbeat) {
                    delete defaults.heartbeat;
                }
            }
        } else {
            if (!heartbeat) {
                heartbeat = {};
                defaults.heartbeat = heartbeat;
            }
            heartbeat.model = modelId;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
        return NextResponse.json({ model: modelId || null });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
