/**
 * File-based user store for email/password auth.
 * Stored under ~/.openclaw/mission-control-data/users.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import bcrypt from 'bcryptjs';

const DATA_DIR = path.join(os.homedir(), '.openclaw', 'mission-control-data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const SALT_ROUNDS = 10;

export interface StoredUser {
    id: string;
    email: string;
    passwordHash: string;
    name?: string;
    createdAt: string;
}

function ensureDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        try {
            fs.chmodSync(DATA_DIR, 0o700);
        } catch {
            /* ignore */
        }
    }
}

function readUsers(): StoredUser[] {
    ensureDir();
    if (!fs.existsSync(USERS_FILE)) return [];
    try {
        const raw = fs.readFileSync(USERS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function writeUsers(users: StoredUser[]): void {
    ensureDir();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + '\n', 'utf-8');
    try {
        fs.chmodSync(USERS_FILE, 0o600);
    } catch {
        /* ignore */
    }
}

export function findUserByEmail(email: string): StoredUser | null {
    const normalized = email.trim().toLowerCase();
    return readUsers().find((u) => u.email.toLowerCase() === normalized) ?? null;
}

export function findUserById(id: string): StoredUser | null {
    return readUsers().find((u) => u.id === id) ?? null;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
}

export async function createUser(email: string, password: string, name?: string): Promise<StoredUser> {
    const normalized = email.trim().toLowerCase();
    const users = readUsers();
    if (users.some((u) => u.email.toLowerCase() === normalized)) {
        throw new Error('An account with this email already exists.');
    }
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const user: StoredUser = {
        id,
        email: normalized,
        passwordHash,
        name: name?.trim() || undefined,
        createdAt: new Date().toISOString(),
    };
    users.push(user);
    writeUsers(users);
    return user;
}
