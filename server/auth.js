'use strict';

const crypto = require('crypto');
const { cleanName } = require('./moderation');

/**
 * Sign-in with OAuth providers (Google, Facebook, Discord) plus a dev-only login.
 *
 * Each provider is enabled by setting its CLIENT_ID and CLIENT_SECRET env vars. Adding
 * another OAuth 2.0 provider means adding one entry to PROVIDERS.
 */
const PROVIDERS = {
  google: {
    label: 'Google',
    env: 'GOOGLE',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid',
    async fetchUser(accessToken) {
      const u = await getJson('https://openidconnect.googleapis.com/v1/userinfo', accessToken);
      return { id: u.sub };
    },
  },
  facebook: {
    label: 'Facebook',
    env: 'FACEBOOK',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scope: 'public_profile',
    async fetchUser(accessToken) {
      const u = await getJson('https://graph.facebook.com/me?fields=id', accessToken);
      return { id: u.id };
    },
  },
  discord: {
    label: 'Discord',
    env: 'DISCORD',
    authorizeUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify',
    async fetchUser(accessToken) {
      const u = await getJson('https://discord.com/api/users/@me', accessToken);
      return { id: u.id };
    },
  },
};

const SESSION_COOKIE = 'trivegle_session';
const STATE_COOKIE = 'trivegle_oauth';
const SESSION_DAYS = 30;

async function getJson(url, accessToken) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Profile request failed (${res.status})`);
  return res.json();
}

function providersFromEnv(env = process.env) {
  const enabled = {};
  for (const [key, p] of Object.entries(PROVIDERS)) {
    const clientId = env[`${p.env}_CLIENT_ID`];
    const clientSecret = env[`${p.env}_CLIENT_SECRET`];
    if (clientId && clientSecret) enabled[key] = { ...p, clientId, clientSecret };
  }
  return enabled;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSigner(secret) {
  const mac = (value) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
  return {
    sign(value) {
      return `${value}.${mac(value)}`;
    },
    verify(signed) {
      if (typeof signed !== 'string') return null;
      const i = signed.lastIndexOf('.');
      if (i === -1) return null;
      const value = signed.slice(0, i);
      const a = Buffer.from(signed.slice(i + 1));
      const b = Buffer.from(mac(value));
      return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
    },
  };
}

/**
 * Registers /auth/* routes on the Express app and returns helpers for reading the
 * signed-in player from an HTTP request or a Socket.IO handshake.
 */
function setupAuth(app, { store, providers, devLogin, secret, publicUrl }) {
  const signer = createSigner(secret);
  const secureCookies = (publicUrl || '').startsWith('https://');

  function cookie(res, name, value, maxAgeSec) {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (secureCookies) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  function playerFromCookieHeader(header) {
    const raw = signer.verify(parseCookies(header)[SESSION_COOKIE]);
    if (!raw) return null;
    const [playerId, expires] = raw.split('|');
    if (!playerId || Number(expires) < Date.now()) return null;
    const player = store.get(playerId);
    return player && !player.banned ? player : null;
  }

  function startSession(res, player) {
    const expires = Date.now() + SESSION_DAYS * 864e5;
    cookie(res, SESSION_COOKIE, signer.sign(`${player.id}|${expires}`), SESSION_DAYS * 86400);
  }

  const baseUrl = (req) => publicUrl || `${req.protocol}://${req.get('host')}`;
  const callbackUrl = (req, key) => `${baseUrl(req)}/auth/${key}/callback`;

  app.get('/api/me', (req, res) => {
    const player = playerFromCookieHeader(req.headers.cookie);
    res.json({
      player: player ? { name: player.name, needsName: !!player.needsName } : null,
      providers: Object.entries(providers).map(([key, p]) => ({ key, label: p.label })),
      devLogin,
    });
  });

  const clearSession = (res) => cookie(res, SESSION_COOKIE, '', 0);

  app.post('/auth/logout', (_req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });

  if (devLogin) {
    // Local development only: sign in as any name without an OAuth provider.
    app.get('/auth/dev', (req, res) => {
      const name = cleanName(String(req.query.name || 'DevPlayer')) || 'DevPlayer';
      const player = store.findOrCreateByAccount('dev', name.toLowerCase(), name);
      startSession(res, player);
      res.redirect('/');
    });
  }

  for (const [key, p] of Object.entries(providers)) {
    app.get(`/auth/${key}`, (req, res) => {
      const state = crypto.randomBytes(16).toString('base64url');
      cookie(res, STATE_COOKIE, signer.sign(`${key}|${state}`), 600);
      const url = new URL(p.authorizeUrl);
      url.search = new URLSearchParams({
        client_id: p.clientId,
        redirect_uri: callbackUrl(req, key),
        response_type: 'code',
        scope: p.scope,
        state,
      });
      res.redirect(url.toString());
    });

    app.get(`/auth/${key}/callback`, async (req, res) => {
      const expected = signer.verify(parseCookies(req.headers.cookie)[STATE_COOKIE]);
      cookie(res, STATE_COOKIE, '', 0);
      if (!expected || expected !== `${key}|${req.query.state}` || !req.query.code) {
        return res.redirect('/?auth_error=state');
      }
      try {
        const tokenRes = await fetch(p.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({
            client_id: p.clientId,
            client_secret: p.clientSecret,
            code: String(req.query.code),
            grant_type: 'authorization_code',
            redirect_uri: callbackUrl(req, key),
          }),
        });
        const token = await tokenRes.json();
        if (!tokenRes.ok || !token.access_token) throw new Error('Token exchange failed');
        const user = await p.fetchUser(token.access_token);
        // Only the provider's account id is stored: no real name, email or photo. Players pick a nickname.
        const player = store.findOrCreateByAccount(key, String(user.id));
        if (player.banned) return res.redirect('/?auth_error=banned');
        startSession(res, player);
        res.redirect('/');
      } catch (err) {
        console.error(`[auth] ${key} sign-in failed:`, err.message);
        res.redirect('/?auth_error=provider');
      }
    });
  }

  return { playerFromCookieHeader, clearSession };
}

module.exports = { PROVIDERS, providersFromEnv, setupAuth, parseCookies, createSigner, SESSION_COOKIE };
