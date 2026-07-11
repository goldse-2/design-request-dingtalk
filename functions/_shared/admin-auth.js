const COOKIE_NAME = 'admin_session';
const SESSION_SECONDS = 12 * 60 * 60;

export async function createAdminSession(env) {
    if (!env.ADMIN_SESSION_SECRET) throw new Error('ADMIN_SESSION_SECRET not configured');
    const expiresAt = Date.now() + SESSION_SECONDS * 1000;
    const payload = `${expiresAt}.${crypto.randomUUID()}`;
    const signature = await sign(payload, env.ADMIN_SESSION_SECRET);
    return `${payload}.${signature}`;
}

export async function isAdminAuthenticated(request, env) {
    if (!env.ADMIN_SESSION_SECRET) return false;
    const token = readCookie(request.headers.get('Cookie') || '', COOKIE_NAME);
    if (!token) return false;

    const lastDot = token.lastIndexOf('.');
    if (lastDot <= 0) return false;
    const payload = token.slice(0, lastDot);
    const signature = token.slice(lastDot + 1);
    const expiresAt = Number(payload.split('.')[0]);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

    const expected = await sign(payload, env.ADMIN_SESSION_SECRET);
    return timingSafeEqual(signature, expected);
}

export function adminSessionCookie(token) {
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
}

export function clearAdminSessionCookie() {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function passwordsMatch(actual, expected) {
    if (!actual || !expected) return false;
    const [actualHash, expectedHash] = await Promise.all([digest(actual), digest(expected)]);
    return timingSafeEqual(actualHash, expectedHash);
}

async function sign(payload, secret) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return toBase64Url(new Uint8Array(bytes));
}

async function digest(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return toBase64Url(new Uint8Array(bytes));
}

function timingSafeEqual(left, right) {
    if (left.length !== right.length) return false;
    let result = 0;
    for (let i = 0; i < left.length; i++) result |= left.charCodeAt(i) ^ right.charCodeAt(i);
    return result === 0;
}

function readCookie(header, name) {
    for (const part of header.split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return rest.join('=');
    }
    return '';
}

function toBase64Url(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
