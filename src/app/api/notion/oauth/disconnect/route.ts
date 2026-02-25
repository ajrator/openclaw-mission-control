import { NextResponse } from 'next/server';
import { deleteNotionIntegrationFile } from '@/lib/notion';

export async function POST() {
    deleteNotionIntegrationFile();
    return NextResponse.json({ success: true });
}
