'use strict';

// Starter blocklist. Expand this (or swap in a moderation API) before launch.
const BLOCKED_WORDS = [
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'bastard',
  'slut', 'whore', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'kys',
];

const blockedPattern = new RegExp(`(${BLOCKED_WORDS.join('|')})`, 'gi');
// Links and contact handles are a common vector for spam and for moving minors off-platform.
const linkPattern = /\b(https?:\/\/|www\.)\S+|\b\S+\.(com|net|org|gg|io|ly|me|tv)\b\S*/gi;
const handlePattern = /(snap(chat)?|insta(gram)?|discord|telegram|whatsapp|kik)\s*[:@-]?\s*\S+/gi;

const MAX_CHAT_LENGTH = 200;
const MAX_NAME_LENGTH = 16;

function containsBlocked(text) {
  blockedPattern.lastIndex = 0;
  return blockedPattern.test(text);
}

function cleanChat(raw) {
  if (typeof raw !== 'string') return '';
  let text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT_LENGTH);
  text = text.replace(blockedPattern, (m) => '*'.repeat(m.length));
  text = text.replace(handlePattern, '[contact removed]');
  text = text.replace(linkPattern, '[link removed]');
  return text;
}

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[^\p{L}\p{N}_ .-]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  if (name.length < 2 || containsBlocked(name)) return null;
  return name;
}

/** Simple per-key token bucket: allows `burst` events, refilling one every `intervalMs`. */
function createRateLimiter({ burst = 4, intervalMs = 1000 } = {}) {
  const buckets = new Map();
  function allow(key, now = Date.now()) {
    const b = buckets.get(key) || { tokens: burst, last: now };
    b.tokens = Math.min(burst, b.tokens + (now - b.last) / intervalMs);
    b.last = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    buckets.set(key, b);
    return true;
  }
  return { allow, forget: (key) => buckets.delete(key) };
}

module.exports = { MAX_CHAT_LENGTH, MAX_NAME_LENGTH, cleanChat, cleanName, containsBlocked, createRateLimiter };
