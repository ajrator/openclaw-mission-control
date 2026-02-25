'use server';

import { signIn, signOut } from '@/auth';
import { createUser, findUserByEmail } from '@/lib/auth-users';
import {
    signInSchema,
    signUpSchema,
    type AuthFormState,
    getAuthFormStateFromZodError,
} from '@/lib/auth-validation';
function credentialsSignInMessage(err: unknown): string {
    if (err instanceof Error) {
        if (err.name === 'CredentialsSignin' || err.message.includes('CredentialsSignin')) {
            return 'Invalid email or password.';
        }
        if (err.message.includes('NEXT_REDIRECT')) throw err;
        return err.message;
    }
    return 'Sign in failed. Please try again.';
}

export async function signInCredentials(
    prevState: AuthFormState,
    formData: FormData
): Promise<AuthFormState> {
    const raw = {
        email: formData.get('email'),
        password: formData.get('password'),
    };
    const parsed = signInSchema.safeParse({
        email: typeof raw.email === 'string' ? raw.email : '',
        password: typeof raw.password === 'string' ? raw.password : '',
    });
    if (!parsed.success) {
        return getAuthFormStateFromZodError(parsed.error);
    }
    const { email, password } = parsed.data;
    try {
        await signIn('credentials', {
            email,
            password,
            redirectTo: '/',
        });
    } catch (err) {
        return { message: credentialsSignInMessage(err) };
    }
    return null;
}

export async function signInGoogle() {
    await signIn('google', { redirectTo: '/' });
}

/** Sign out and redirect to login/sign-up page. No confirmation. */
export async function signOutAction() {
    await signOut({ redirectTo: '/' });
}

export async function signUp(prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
    const raw = {
        name: formData.get('name'),
        email: formData.get('email'),
        password: formData.get('password'),
    };
    const parsed = signUpSchema.safeParse({
        name: typeof raw.name === 'string' ? raw.name : '',
        email: typeof raw.email === 'string' ? raw.email : '',
        password: typeof raw.password === 'string' ? raw.password : '',
    });
    if (!parsed.success) {
        return getAuthFormStateFromZodError(parsed.error);
    }
    const { name, email, password } = parsed.data;
    if (findUserByEmail(email)) {
        return { errors: { email: 'An account with this email already exists.' } };
    }
    try {
        await createUser(email, password, name);
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Sign up failed. Please try again.';
        return { message };
    }
    try {
        await signIn('credentials', { email, password, redirectTo: '/' });
    } catch (err) {
        return { message: credentialsSignInMessage(err) };
    }
    return null;
}
