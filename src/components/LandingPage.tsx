'use client';

import { useActionState, useState, useEffect, useRef, useCallback } from 'react';
import { useFormStatus } from 'react-dom';
import { signInCredentials, signUp, signInGoogle } from '@/app/actions/auth';
import { validateAuthField, type AuthFormState } from '@/lib/auth-validation';

type SignInField = 'email' | 'password';
type SignUpField = 'name' | 'email' | 'password';
type FieldErrors = { email?: string; password?: string; name?: string };

const APP_NAME = 'Mission Control';

function SubmitButton({ label }: { label: string }) {
    const { pending } = useFormStatus();
    return (
        <button
            type="submit"
            className="landing-btn landing-btn-primary"
            disabled={pending}
            aria-busy={pending}
        >
            {pending ? 'Please wait…' : label}
        </button>
    );
}

function FieldError({ id, error }: { id: string; error?: string }) {
    if (!error) return null;
    return (
        <p id={id} className="landing-field-error" role="alert">
            {error}
        </p>
    );
}

function authErrorMessage(code: string | undefined): string | undefined {
    if (!code) return undefined;
    switch (code) {
        case 'CredentialsSignin':
            return 'Invalid email or password.';
        case 'Configuration':
            return 'Server configuration error. Add AUTH_SECRET to .env.local (run: npx auth secret).';
        default:
            return 'Something went wrong. Please try again.';
    }
}

export function LandingPage({ hasGoogle = false, authError }: { hasGoogle?: boolean; authError?: string }) {
    const [mode, setMode] = useState<'in' | 'up'>('in');
    const [signInState, signInAction] = useActionState<AuthFormState, FormData>(signInCredentials, null);
    const [signUpState, signUpAction] = useActionState<AuthFormState, FormData>(signUp, null);
    const state = mode === 'in' ? signInState : signUpState;
    const serverErrors = state?.errors;
    const message = state?.message;
    const urlErrorMessage = authErrorMessage(authError);

    const [clientErrors, setClientErrors] = useState<FieldErrors>({});
    const [clientValidatedFields, setClientValidatedFields] = useState<Set<string>>(new Set());
    const hasFieldErrors = (errors: FieldErrors | undefined) =>
        errors && Object.keys(errors).length > 0;
    const showTopMessage = (message && !hasFieldErrors(serverErrors)) || urlErrorMessage;
    const topMessageText = urlErrorMessage ?? message;

    const form = mode === 'in' ? 'signIn' : 'signUp';
    const handleBlur = useCallback(
        (field: SignInField | SignUpField, value: string) => {
            const error = validateAuthField(form, field, value);
            setClientValidatedFields((prev) => new Set(prev).add(field));
            setClientErrors((prev) => ({ ...prev, [field]: error }));
        },
        [form]
    );

    const displayedErrors: FieldErrors = {};
    const fields = mode === 'up' ? (['name', 'email', 'password'] as const) : (['email', 'password'] as const);
    for (const field of fields) {
        displayedErrors[field] = clientValidatedFields.has(field)
            ? clientErrors[field]
            : serverErrors?.[field];
    }
    const errors = displayedErrors;
    const prevStateRef = useRef<AuthFormState | null>(null);

    useEffect(() => {
        if (state === prevStateRef.current) return;
        prevStateRef.current = state;
        if (state != null) {
            setClientValidatedFields(new Set());
            setClientErrors({});
        }
    }, [state]);

    useEffect(() => {
        setClientValidatedFields(new Set());
        setClientErrors({});
    }, [mode]);

    useEffect(() => {
        if (!serverErrors || Object.keys(serverErrors).length === 0) return;
        const order = mode === 'up' ? (['name', 'email', 'password'] as const) : (['email', 'password'] as const);
        for (const field of order) {
            if (serverErrors[field]) {
                const id = mode === 'up' ? `signup-${field}-error` : `signin-${field}-error`;
                const el = document.getElementById(id);
                const input = el?.previousElementSibling ?? el?.closest('label')?.querySelector('input');
                if (input instanceof HTMLInputElement) {
                    input.focus();
                }
                break;
            }
        }
    }, [serverErrors, mode]);

    return (
        <div className="landing">
            <div className="landing-bg" />
            <div className="landing-content">
                <div className="landing-card">
                    <div className="landing-brand">
                        <div className="landing-logo" />
                        <h1 className="landing-title">{APP_NAME}</h1>
                        <p className="landing-tagline">
                            Your workspace for agents, tasks, and chat
                        </p>
                    </div>

                    <div className="landing-tabs">
                        <button
                            type="button"
                            className={`landing-tab ${mode === 'in' ? 'active' : ''}`}
                            onClick={() => setMode('in')}
                        >
                            Sign in
                        </button>
                        <button
                            type="button"
                            className={`landing-tab ${mode === 'up' ? 'active' : ''}`}
                            onClick={() => setMode('up')}
                        >
                            Sign up
                        </button>
                    </div>

                    {hasGoogle && (
                        <>
                            <form action={signInGoogle} className="landing-google-form">
                                <button type="submit" className="landing-btn landing-btn-google">
                                    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                                        <path
                                            fill="#4285F4"
                                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                        />
                                        <path
                                            fill="#34A853"
                                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                        />
                                        <path
                                            fill="#FBBC05"
                                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                        />
                                        <path
                                            fill="#EA4335"
                                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                        />
                                    </svg>
                                    Continue with Google
                                </button>
                            </form>
                            <div className="landing-divider">
                                <span>or</span>
                            </div>
                        </>
                    )}

                    {mode === 'in' ? (
                        <form action={signInAction} className="landing-form" noValidate>
                            {showTopMessage && topMessageText && (
                                <p className="landing-error" role="alert" aria-live="polite">
                                    {topMessageText}
                                </p>
                            )}
                            <label className="landing-label">
                                Email
                                <input
                                    type="email"
                                    name="email"
                                    className="landing-input"
                                    placeholder="you@example.com"
                                    autoComplete="email"
                                    required
                                    aria-invalid={Boolean(errors?.email)}
                                    aria-describedby={errors?.email ? 'signin-email-error' : undefined}
                                    onBlur={(e) => handleBlur('email', e.currentTarget.value)}
                                />
                                <FieldError id="signin-email-error" error={errors?.email} />
                            </label>
                            <label className="landing-label">
                                Password
                                <input
                                    type="password"
                                    name="password"
                                    className="landing-input"
                                    placeholder="••••••••"
                                    autoComplete="current-password"
                                    required
                                    aria-invalid={Boolean(errors?.password)}
                                    aria-describedby={errors?.password ? 'signin-password-error' : undefined}
                                    onBlur={(e) => handleBlur('password', e.currentTarget.value)}
                                />
                                <FieldError id="signin-password-error" error={errors?.password} />
                            </label>
                            <SubmitButton label="Sign in" />
                        </form>
                    ) : (
                        <form action={signUpAction} className="landing-form" noValidate>
                            {showTopMessage && topMessageText && (
                                <p className="landing-error" role="alert" aria-live="polite">
                                    {topMessageText}
                                </p>
                            )}
                            <label className="landing-label">
                                Name <span className="landing-optional">(optional)</span>
                                <input
                                    type="text"
                                    name="name"
                                    className="landing-input"
                                    placeholder="Your name"
                                    autoComplete="name"
                                    aria-invalid={Boolean(errors?.name)}
                                    aria-describedby={errors?.name ? 'signup-name-error' : undefined}
                                    maxLength={100}
                                    onBlur={(e) => handleBlur('name', e.currentTarget.value)}
                                />
                                <FieldError id="signup-name-error" error={errors?.name} />
                            </label>
                            <label className="landing-label">
                                Email
                                <input
                                    type="email"
                                    name="email"
                                    className="landing-input"
                                    placeholder="you@example.com"
                                    autoComplete="email"
                                    required
                                    aria-invalid={Boolean(errors?.email)}
                                    aria-describedby={errors?.email ? 'signup-email-error' : undefined}
                                    onBlur={(e) => handleBlur('email', e.currentTarget.value)}
                                />
                                <FieldError id="signup-email-error" error={errors?.email} />
                            </label>
                            <label className="landing-label">
                                Password
                                <input
                                    type="password"
                                    name="password"
                                    className="landing-input"
                                    placeholder="At least 8 characters"
                                    autoComplete="new-password"
                                    minLength={8}
                                    maxLength={72}
                                    required
                                    aria-invalid={Boolean(errors?.password)}
                                    aria-describedby={errors?.password ? 'signup-password-error' : undefined}
                                    onBlur={(e) => handleBlur('password', e.currentTarget.value)}
                                />
                                <FieldError id="signup-password-error" error={errors?.password} />
                            </label>
                            <SubmitButton label="Create account" />
                        </form>
                    )}
                </div>
                <p className="landing-footer">
                    By continuing, you agree to use this app responsibly.
                </p>
            </div>
        </div>
    );
}
