'use strict';

// Shared by the Privacy Policy and Terms pages: fills in the contact email
// (set with the CONTACT_EMAIL env var) and powers the "Delete my account" button.
(() => {
  fetch('/api/config')
    .then((r) => r.json())
    .then(({ contactEmail }) => {
      document.querySelectorAll('[data-contact-email]').forEach((node) => {
        if (contactEmail) {
          const a = document.createElement('a');
          a.href = `mailto:${contactEmail}`;
          a.textContent = contactEmail;
          node.replaceChildren(a);
        } else {
          node.textContent = 'our contact email (coming soon).';
        }
      });
    })
    .catch(() => {});

  const btn = document.getElementById('delete-account-btn');
  const note = document.getElementById('delete-account-note');
  if (!btn) return;

  fetch('/api/me')
    .then((r) => r.json())
    .then((me) => {
      if (!me.player) {
        note.textContent = 'Sign in on the home page first, then come back here to delete your account.';
        return;
      }
      btn.hidden = false;
      note.textContent = `Signed in as ${me.player.name}.`;
    })
    .catch(() => { note.textContent = 'Could not check your sign-in status. Try reloading.'; });

  btn.addEventListener('click', async () => {
    if (!confirm('Permanently delete your Trivegle account, rating and stats? This cannot be undone.')) return;
    btn.disabled = true;
    const res = await fetch('/api/account/delete', { method: 'POST' }).catch(() => null);
    if (res && res.ok) {
      btn.hidden = true;
      note.textContent = 'Your account has been deleted.';
    } else {
      btn.disabled = false;
      note.textContent = 'Something went wrong. Please try again or email us.';
    }
  });
})();
