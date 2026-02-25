import { NextResponse } from 'next/server';
import { removeOpenAICodexProfile } from '@/lib/openai-oauth';

export async function POST() {
    removeOpenAICodexProfile();
    return NextResponse.json({ success: true });
}
