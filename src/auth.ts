import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import {
    findUserByEmail,
    verifyPassword,
} from '@/lib/auth-users';

if (typeof process !== 'undefined' && !process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    throw new Error(
        'AUTH_SECRET is required for sign-in. Add it to .env.local (run: npx auth secret). Restart the dev server after adding it.'
    );
}

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Credentials({
            credentials: {
                email: { label: 'Email', type: 'email' },
                password: { label: 'Password', type: 'password' },
            },
            authorize: async (credentials) => {
                try {
                    const email = credentials?.email as string | undefined;
                    const password = credentials?.password as string | undefined;
                    if (!email?.trim() || !password) return null;
                    const user = findUserByEmail(email.trim().toLowerCase());
                    if (!user || !(await verifyPassword(password, user.passwordHash))) return null;
                    return {
                        id: user.id,
                        email: user.email,
                        name: user.name ?? null,
                        image: null,
                    };
                } catch (err) {
                    console.error('[auth] Credentials authorize error:', err);
                    return null;
                }
            },
        }),
        ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
            ? [
                  Google({
                      clientId: process.env.AUTH_GOOGLE_ID,
                      clientSecret: process.env.AUTH_GOOGLE_SECRET,
                  }),
              ]
            : []),
    ],
    session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
    pages: {
        signIn: '/',
    },
    callbacks: {
        jwt({ token, user }) {
            if (user?.id != null) token.id = user.id;
            if (user?.email != null) token.email = user.email;
            return token;
        },
        session({ session, token }) {
            if (session.user) {
                if (token.id != null) session.user.id = token.id as string;
                if (token.email != null) session.user.email = token.email as string;
            }
            return session;
        },
    },
});
