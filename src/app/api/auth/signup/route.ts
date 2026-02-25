import { NextResponse } from 'next/server';
import { createUser, findUserByEmail } from '@/lib/auth-users';
import { signUpSchema } from '@/lib/auth-validation';

export async function POST(request: Request) {
    let body: { email?: string; password?: string; name?: string };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const parsed = signUpSchema.safeParse({
        name: typeof body.name === 'string' ? body.name : '',
        email: typeof body.email === 'string' ? body.email : '',
        password: typeof body.password === 'string' ? body.password : '',
    });
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        const message = first?.message ?? 'Validation failed';
        return NextResponse.json({ error: message }, { status: 400 });
    }
    const { name, email, password } = parsed.data;
    if (findUserByEmail(email)) {
        return NextResponse.json(
            { error: 'An account with this email already exists' },
            { status: 409 }
        );
    }
    try {
        await createUser(email, password, name);
        return NextResponse.json({ ok: true });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Sign up failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
