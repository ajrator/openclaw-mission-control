import { NextResponse } from 'next/server';
import { getOpenClawData } from '@/lib/openclaw';

export async function GET() {
    const data = getOpenClawData();
    return NextResponse.json(data);
}
