import { z } from 'zod';

const emailSchema = z
    .string()
    .min(1, 'Email is required')
    .max(255, 'Email is too long')
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.string().email('Please enter a valid email address'));

const passwordSignInSchema = z
    .string()
    .min(1, 'Password is required');

const passwordSignUpSchema = z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password is too long');

const nameSchema = z
    .string()
    .max(100, 'Name is too long')
    .transform((s) => s.trim() || undefined)
    .optional();

export const signInSchema = z.object({
    email: emailSchema,
    password: passwordSignInSchema,
});

export const signUpSchema = z.object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSignUpSchema,
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;

/** Form state: field-level errors (shown under inputs) and optional form-level message (e.g. "Invalid email or password"). */
export type AuthFormState = {
    errors?: {
        email?: string;
        password?: string;
        name?: string;
    };
    /** Shown only when there are no field errors (auth failure, server error). Never use for validation. */
    message?: string;
} | null;

/** Map Zod validation errors to field-only state. No top-level message so errors appear only under the right field. */
export function getAuthFormStateFromZodError(err: z.ZodError): NonNullable<AuthFormState> {
    const errors: NonNullable<NonNullable<AuthFormState>['errors']> = {};
    for (const issue of err.issues) {
        const path = issue.path[0] as string | undefined;
        if (path && (path === 'email' || path === 'password' || path === 'name')) {
            if (!errors[path]) errors[path] = issue.message;
        }
    }
    return { errors: Object.keys(errors).length ? errors : undefined };
}

type SignInField = 'email' | 'password';
type SignUpField = 'name' | 'email' | 'password';

/** Validate a single field on the client (e.g. on blur). Returns error message or undefined if valid. */
export function validateAuthField(
    form: 'signIn' | 'signUp',
    field: SignInField | SignUpField,
    value: string
): string | undefined {
    const str = typeof value === 'string' ? value : '';
    if (form === 'signIn') {
        if (field !== 'email' && field !== 'password') return undefined;
        const result = signInSchema.pick({ [field]: true } as { email: true } | { password: true }).safeParse({ [field]: str });
        if (result.success) return undefined;
        const first = result.error.issues[0];
        return first?.message;
    }
    if (field !== 'name' && field !== 'email' && field !== 'password') return undefined;
    const result = signUpSchema.pick({ [field]: true } as { name: true } | { email: true } | { password: true }).safeParse({ [field]: str });
    if (result.success) return undefined;
    const first = result.error.issues[0];
    return first?.message;
}
