/* global io */
'use strict';

(() => {
  // ---------- Tiny helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  /** Build DOM nodes without innerHTML so user text can never inject markup. */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  const TIPS = [
    'Answer fast — speed gives up to +50 bonus points per question.',
    'The final round is worth double. Never give up early.',
    'Press 1–4 on your keyboard to answer instantly.',
    'Chat between rounds: the topic prompt is a great icebreaker.',
    'Beating a higher-rated player gives you more rating.',
    'Leaving mid-match counts as a loss. Don\'t rage quit!',
  ];

  // ---------- State ----------
  const state = {
    signedIn: false,
    profile: null,
    config: { ads: {} },
    pendingQueue: null,
    match: null, // { opponent, ranked, ended }
    question: null, // { qIndex, choices, durationMs, startedAt, answered }
    timerRaf: null,
    countdown: null,
    queueTimer: null,
  };

  const socket = io();

  // ---------- Screens ----------
  function show(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    if (name === 'home' || name === 'leaderboard') stopLocalStream(); // camera light off outside battles
    if (name !== 'match') document.body.classList.remove('camera-match');
    if (name === 'home') refreshLeaderboard();
    if (name === 'leaderboard') refreshLeaderboard(true);
    window.scrollTo({ top: 0 });
  }

  $$('[data-nav]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      if (state.match && !state.match.ended && !confirm('Leave this match? It counts as a loss.')) return;
      leaveMatch();
      show(b.dataset.nav);
    }),
  );
  $$('[data-modal]').forEach((b) => b.addEventListener('click', () => $(`#${b.dataset.modal}`).showModal()));

  // ---------- Ads ----------
  let adsenseLoaded = false;
  function renderAd(container, slotName) {
    container.replaceChildren();
    const { adsenseClient, slots = {} } = state.config.ads || {};
    if (state.profile?.plus) return; // Trivegle+ members see no ads
    if (adsenseClient && slots[slotName]) {
      if (!adsenseLoaded) {
        adsenseLoaded = true;
        document.head.append(el('script', {
          async: true,
          src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(adsenseClient)}`,
          crossorigin: 'anonymous',
        }));
      }
      container.append(el('ins', {
        class: 'adsbygoogle',
        style: 'display:block',
        'data-ad-client': adsenseClient,
        'data-ad-slot': slots[slotName],
        'data-ad-format': 'auto',
        'data-full-width-responsive': 'true',
      }));
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } else {
      // House ad until a network is configured — doubles as an "advertise with us" CTA.
      container.append(el('button', { class: 'house-ad link', onclick: () => $('#advertise-modal').showModal() },
        el('small', {}, 'Advertisement'),
        'Your brand here. Sponsor a trivia round →'));
    }
  }
  function renderStaticAds() {
    $$('.ad-slot[data-ad]').forEach((c) => renderAd(c, c.dataset.ad));
  }

  // ---------- Profile & leaderboard ----------
  // ---------- Ranks ----------
  function rankBadge(rank, big = false) {
    if (!rank) return el('span');
    const b = el('span', { class: `rank-badge${big ? ' big' : ''}`, title: `${rank.name} rank` }, `${rank.icon} ${rank.name}`);
    b.style.setProperty('--rank-color', rank.color);
    return b;
  }

  function renderRanksGuide() {
    const ranks = state.config.ranks || [];
    const current = state.profile?.rank?.name;
    $('#ranks-list').replaceChildren(...ranks.map((r, i) => {
      const next = ranks[i + 1];
      const mix = el('div', { class: 'diff-mix', title: r.mix.map((d) => `${d.pct}% ${d.label}`).join(', ') },
        r.mix.map((d) => {
          const seg = el('span', { class: `diff-${['Easy', 'Medium', 'Hard', 'Expert'].indexOf(d.label) + 1}` });
          seg.style.width = `${d.pct}%`;
          return seg;
        }));
      return el('div', { class: `rank-line${r.name === current ? ' current' : ''}` },
        rankBadge(r), el('span', { class: 'muted' }, next ? `${r.min}+` : `${r.min}+ 🔝`), mix);
    }), el('p', { class: 'muted small-print' },
      el('span', { class: 'diff-pill diff-1' }, 'Easy'), ' ', el('span', { class: 'diff-pill diff-2' }, 'Medium'), ' ',
      el('span', { class: 'diff-pill diff-3' }, 'Hard'), ' ', el('span', { class: 'diff-pill diff-4' }, 'Expert')));
  }
  $$('[data-modal="ranks-modal"]').forEach((b) => b.addEventListener('click', renderRanksGuide));

  function renderProfile(p) {
    if (!p) return;
    state.profile = p;
    if (p.rank) {
      $('#p-rank').replaceWith(Object.assign(rankBadge(p.rank, true), { id: 'p-rank' }));
      $('#p-rank-bar').style.width = `${Math.round(p.rank.progress * 100)}%`;
      $('#p-rank-next').textContent = p.rank.next
        ? `${p.rank.next.at - p.rating} to ${p.rank.next.name} · peak ${p.peakRating}`
        : `Top rank! Peak ${p.peakRating}`;
    }
    $('#p-rating').textContent = p.rating;
    $('#p-record').textContent = `${p.wins}–${p.losses}`;
    $('#p-streak').textContent = p.streak;
    $('#p-acc').textContent = `${p.accuracy}%`;
  }

  async function refreshLeaderboard(full = false) {
    let rows = [];
    try { rows = await (await fetch('/api/leaderboard')).json(); } catch { return; }
    const mini = $('#lb-preview');
    mini.replaceChildren(...(rows.length
      ? rows.slice(0, 8).map((r) => el('li', {},
        el('span', {}, el('span', { class: 'rank-icon', title: r.rank.name }, r.rank.icon), r.name), el('span', {}, r.rating)))
      : [el('li', { class: 'muted' }, 'No ranked games yet — be the first!')]));
    if (full) {
      $('#lb-body').replaceChildren(...rows.map((r) => el('tr', {},
        el('td', {}, r.position), el('td', {}, r.name), el('td', {}, rankBadge(r.rank)), el('td', {}, r.rating),
        el('td', {}, `${r.wins}–${r.losses}–${r.draws}`), el('td', {}, r.bestStreak), el('td', {}, `${r.accuracy}%`))));
    }
  }

  // ---------- Home actions ----------
  const nameInput = $('#name-input');
  const agreeInput = $('#agree-input');
  agreeInput.checked = storage.get('trivegle.agreed') === '1';

  // Text vs camera mode
  const adultInput = $('#adult-input');
  const wantsCamera = () => $('input[name=mode]:checked').value === 'camera';
  function syncModeUi() {
    $('#camera-note').hidden = !wantsCamera();
    $('#adult-row').hidden = !wantsCamera();
  }
  if (storage.get('trivegle.mode') === 'camera') $('input[name=mode][value=camera]').checked = true;
  adultInput.checked = storage.get('trivegle.adult') === '1';
  $$('input[name=mode]').forEach((r) => r.addEventListener('change', () => {
    storage.set('trivegle.mode', wantsCamera() ? 'camera' : 'text');
    syncModeUi();
  }));
  syncModeUi();

  async function startQueue(mode) {
    const err = $('#name-error');
    err.hidden = true;
    const fail = (msg) => {
      err.textContent = msg;
      err.hidden = false;
    };
    if (!agreeInput.checked) {
      err.textContent = 'Please confirm you\'re 13+ and agree to the rules.';
      err.hidden = false;
      return;
    }
    const name = nameInput.value.trim();
    if (name.length < 2) {
      err.textContent = 'Pick a name (2–16 characters).';
      err.hidden = false;
      nameInput.focus();
      return;
    }
    const video = mode === 'ranked' && wantsCamera(); // bots don't have cameras
    if (video) {
      if (!adultInput.checked) return fail('Camera mode is 18+. Confirm your age or switch to Text mode.');
      try {
        await ensureLocalStream();
      } catch {
        return fail('Couldn\'t access your camera. Allow camera access in your browser, or switch to Text mode.');
      }
      storage.set('trivegle.adult', '1');
    }
    storage.set('trivegle.agreed', '1');
    state.pendingQueue = { mode, video, difficulty: $('#difficulty').value };
    socket.emit('hello', { name });
  }

  $('#play-ranked').addEventListener('click', () => startQueue('ranked'));
  $('#play-practice').addEventListener('click', () => startQueue('practice'));
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startQueue('ranked'); });

  // ---------- Queue ----------
  function enterQueueScreen() {
    show('queue');
    const started = Date.now();
    $('#queue-hint').hidden = true;
    $('#queue-tip').textContent = `💡 ${TIPS[Math.floor(Math.random() * TIPS.length)]}`;
    clearInterval(state.queueTimer);
    state.queueTimer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      $('#queue-time').textContent = s;
      if (s >= 15) $('#queue-hint').hidden = false;
    }, 500);
  }
  function exitQueue() {
    clearInterval(state.queueTimer);
  }
  $('#queue-cancel').addEventListener('click', () => {
    socket.emit('leaveQueue');
    exitQueue();
    show('home');
  });
  $('#queue-practice').addEventListener('click', () => {
    exitQueue();
    socket.emit('queue', { mode: 'practice', difficulty: $('#difficulty').value });
  });

  // ---------- Match rendering ----------
  const stage = $('#stage');

  function setScores(scores) {
    if (!scores) return;
    $('#you-score').textContent = scores.you;
    $('#opp-score').textContent = scores.opp;
  }

  function stopTimers() {
    cancelAnimationFrame(state.timerRaf);
    clearInterval(state.countdown);
  }

  function runTimerBar(bar, durationMs, startedAt) {
    cancelAnimationFrame(state.timerRaf);
    const tick = () => {
      const left = Math.max(0, 1 - (Date.now() - startedAt) / durationMs);
      bar.style.width = `${left * 100}%`;
      if (left > 0) state.timerRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  function runCountdown(node, durationMs) {
    clearInterval(state.countdown);
    const end = Date.now() + durationMs;
    const tick = () => { node.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000)); };
    tick();
    state.countdown = setInterval(tick, 250);
  }

  function splash(label, title, sub) {
    stopTimers();
    stage.replaceChildren(el('div', { class: 'stage-card splash' },
      el('div', { class: 'big-label' }, label),
      el('div', { class: 'big-title' }, title),
      sub ? el('p', { class: 'muted' }, sub) : null));
  }

  function addChat(from, text) {
    const log = $('#chat-log');
    const who = from === 'you' ? 'You' : from === 'opp' ? (state.match?.opponent.isBot ? 'Bot' : 'Stranger') : null;
    log.append(el('div', { class: `msg ${from}` }, who ? el('b', {}, who) : null, text));
    log.scrollTop = log.scrollHeight;
  }

  function answer(i) {
    const q = state.question;
    if (!q || q.answered) return;
    q.answered = true;
    socket.emit('answer', { qIndex: q.qIndex, choice: i });
    $$('.choice').forEach((b, idx) => {
      b.disabled = true;
      if (idx === i) b.classList.add('picked');
    });
    $('#q-status').textContent = 'Locked in. Waiting for opponent…';
  }

  document.addEventListener('keydown', (e) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4) answer(n - 1);
  });

  // ---------- Match actions ----------
  // ---------- Camera mode (WebRTC) ----------
  // The server only relays connection messages; audio/video flows directly between the two players.
  const rtc = { pc: null, local: null, pendingIce: [], status: 'idle', revealed: false, hidden: false };
  const remoteTile = $('#remote-video').closest('.video-tile');
  const localTile = $('#local-video').closest('.video-tile');

  async function ensureLocalStream() {
    if (rtc.local) return rtc.local;
    rtc.local = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    rtc.local.getAudioTracks().forEach((t) => { t.enabled = false; }); // mic starts muted
    $('#local-video').srcObject = rtc.local;
    renderControls();
    return rtc.local;
  }

  function stopLocalStream() {
    closePeer();
    rtc.local?.getTracks().forEach((t) => t.stop());
    rtc.local = null;
    $('#local-video').srcObject = null;
  }

  function renderRemote() {
    const connected = rtc.status === 'connected';
    remoteTile.classList.toggle('blurred', !rtc.revealed);
    remoteTile.classList.toggle('cam-off', rtc.hidden || !connected);
    const cover = $('#remote-cover');
    const text = {
      connecting: 'Connecting camera…',
      failed: 'Video couldn\'t connect. Chat still works.',
      left: 'Stranger left.',
      closed: 'Video off.',
    }[rtc.status];
    if (rtc.hidden && connected) {
      $('#remote-status').textContent = 'Stranger\'s video hidden.';
    } else {
      $('#remote-status').textContent = connected ? (rtc.revealed ? '' : 'Video is blurred for your safety.') : text || '';
    }
    $('#reveal-btn').hidden = !(connected && !rtc.revealed && !rtc.hidden);
    cover.hidden = connected && rtc.revealed && !rtc.hidden;
  }

  function renderControls() {
    const cam = rtc.local?.getVideoTracks()[0];
    const mic = rtc.local?.getAudioTracks()[0];
    const camOn = !!cam?.enabled;
    const micOn = !!mic?.enabled;
    $('#cam-btn').classList.toggle('off', !camOn);
    $('#cam-btn').title = camOn ? 'Turn camera off' : 'Turn camera on';
    localTile.classList.toggle('cam-off', !camOn);
    $('#mic-btn').classList.toggle('off', !micOn);
    $('#mic-btn').textContent = micOn ? '🎙️' : '🔇';
    $('#mic-btn').title = micOn ? 'Mute mic' : 'Unmute mic';
    $('#hide-btn').classList.toggle('off', rtc.hidden);
    $('#hide-btn').title = rtc.hidden ? 'Show stranger\'s video' : 'Hide stranger\'s video';
  }

  function setRemoteStatus(status) {
    rtc.status = status;
    renderRemote();
  }

  function closePeer(status = 'closed') {
    if (rtc.pc) {
      rtc.pc.onicecandidate = rtc.pc.ontrack = rtc.pc.onconnectionstatechange = null;
      rtc.pc.close();
      rtc.pc = null;
    }
    $('#remote-video').srcObject = null;
    rtc.pendingIce = [];
    setRemoteStatus(status);
  }

  function setupPeer(initiator) {
    closePeer();
    rtc.revealed = false;
    rtc.hidden = false;
    $('#remote-video').muted = false;
    const pc = new RTCPeerConnection({ iceServers: state.config.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] });
    rtc.pc = pc;
    rtc.local?.getTracks().forEach((t) => pc.addTrack(t, rtc.local));
    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('rtc', { type: 'ice', data: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      $('#remote-video').srcObject = e.streams[0];
      setRemoteStatus('connected');
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') setRemoteStatus('failed');
    };
    setRemoteStatus('connecting');
    renderControls();
    if (initiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => socket.emit('rtc', { type: 'offer', data: pc.localDescription.toJSON() }))
        .catch(() => setRemoteStatus('failed'));
    }
  }

  async function flushIce() {
    const pending = rtc.pendingIce.splice(0);
    for (const c of pending) await rtc.pc?.addIceCandidate(c).catch(() => {});
  }

  socket.on('rtc', async ({ type, data }) => {
    const pc = rtc.pc;
    if (!pc) return;
    try {
      if (type === 'offer') {
        await pc.setRemoteDescription(data);
        await flushIce();
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('rtc', { type: 'answer', data: pc.localDescription.toJSON() });
      } else if (type === 'answer') {
        await pc.setRemoteDescription(data);
        await flushIce();
      } else if (type === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(data);
        else rtc.pendingIce.push(data);
      }
    } catch {
      setRemoteStatus('failed');
    }
  });

  $('#reveal-btn').addEventListener('click', () => {
    rtc.revealed = true;
    renderRemote();
  });
  $('#cam-btn').addEventListener('click', () => {
    const t = rtc.local?.getVideoTracks()[0];
    if (t) t.enabled = !t.enabled;
    renderControls();
  });
  $('#mic-btn').addEventListener('click', () => {
    const t = rtc.local?.getAudioTracks()[0];
    if (t) t.enabled = !t.enabled;
    renderControls();
  });
  $('#hide-btn').addEventListener('click', () => {
    rtc.hidden = !rtc.hidden;
    $('#remote-video').muted = rtc.hidden; // hiding also silences them
    renderRemote();
    renderControls();
  });

  function leaveMatch() {
    closePeer();
    if (state.match) socket.emit('leaveMatch');
    state.match = null;
    state.question = null;
    stopTimers();
  }

  $('#next-btn').addEventListener('click', () => {
    if (state.match && !state.match.ended && !confirm('Skip this stranger? Leaving mid-match counts as a loss.')) return;
    const mode = state.match?.ranked === false ? 'practice' : 'ranked';
    leaveMatch();
    socket.emit('queue', { mode, video: mode === 'ranked' && !!rtc.local && wantsCamera(), difficulty: $('#difficulty').value });
  });
  $('#home-btn').addEventListener('click', () => {
    if (state.match && !state.match.ended && !confirm('Leave this match? It counts as a loss.')) return;
    leaveMatch();
    show('home');
  });

  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat', { text });
    input.value = '';
  });

  $('#block-btn').addEventListener('click', () => {
    if (state.match?.opponent.isBot) return addChat('system', 'You can\'t block a bot. 🤖');
    if (confirm('Block this player? You won\'t be matched again.')) {
      socket.emit('block');
      closePeer();
    }
  });
  $('#report-btn').addEventListener('click', () => {
    if (state.match?.opponent.isBot) return addChat('system', 'Bots can\'t be reported. 🤖');
    $('#report-modal').showModal();
  });
  $('#report-modal').addEventListener('close', () => {
    if ($('#report-modal').returnValue !== 'submit') return;
    const reason = new FormData($('#report-form')).get('reason');
    socket.emit('report', { reason });
    closePeer(); // stop seeing/hearing them immediately
  });

  // ---------- Socket events ----------
  socket.on('connect', () => {
    if (state.signedIn) socket.emit('hello', {});
  });

  socket.on('authRequired', () => {
    state.pendingQueue = null;
    renderAuth({ player: null, providers: state.providers || [], devLogin: state.devLogin });
    show('home');
  });

  socket.on('welcome', ({ profile, needsName }) => {
    renderProfile(profile);
    $('#account-name').textContent = profile.name;
    if (!needsName && !nameInput.value) nameInput.value = profile.name;
    if (state.pendingQueue) {
      socket.emit('queue', state.pendingQueue);
      state.pendingQueue = null;
    }
  });

  socket.on('errorMsg', ({ message }) => {
    state.pendingQueue = null;
    const err = $('#name-error');
    err.textContent = message;
    err.hidden = false;
    show('home');
  });

  socket.on('profile', renderProfile);

  socket.on('stats', ({ online, searching }) => {
    $('#online-count').textContent = online;
    $('#queue-searching').textContent = searching;
  });

  socket.on('queued', enterQueueScreen);

  socket.on('matchFound', (m) => {
    exitQueue();
    state.match = { opponent: m.opponent, ranked: m.ranked, video: m.video, ended: false };
    show('match');
    $('#video-row').hidden = !m.video;
    $('.match-grid').classList.toggle('camera', !!m.video);
    document.body.classList.toggle('camera-match', !!m.video);
    if (m.video) setupPeer(m.rtcInitiator);
    else closePeer();
    $('#chat-log').replaceChildren();
    $('#you-name').replaceChildren(`${m.you.name} (${m.you.rating}) `, rankBadge(m.you.rank));
    $('#opp-name').replaceChildren(rankBadge(m.opponent.rank), ` ${m.opponent.name} (${m.opponent.rating})`);
    $('#opp-label').textContent = m.opponent.isBot ? '🤖 Practice bot' : 'Stranger';
    $('#round-label').textContent = `Round 1/${m.rounds}`;
    $('#mult-label').hidden = true;
    setScores({ you: 0, opp: 0 });
    addChat('system', m.opponent.isBot
      ? `Practice match vs ${m.opponent.name}. Not ranked.`
      : `You're now battling a random stranger${m.video ? ' on camera' : ''}: ${m.opponent.name}. Say hi!`);
    splash(m.ranked ? 'Ranked battle' : 'Practice', `vs ${m.opponent.name}`,
      `Categories: ${m.categories.join(' · ')} · ${m.questionTier.icon} ${m.questionTier.name}-tier questions`);
  });

  socket.on('roundStart', ({ round, totalRounds, category, multiplier, scores }) => {
    setScores(scores);
    $('#round-label').textContent = `Round ${round}/${totalRounds}`;
    $('#mult-label').hidden = multiplier < 2;
    splash(`Round ${round}${round === totalRounds ? ' · FINAL' : ''}`, category, multiplier > 1 ? 'Double points this round!' : null);
  });

  socket.on('question', (q) => {
    stopTimers();
    state.question = { ...q, startedAt: Date.now(), answered: false };
    const bar = el('div');
    stage.replaceChildren(el('div', { class: 'stage-card' },
      el('div', { class: 'q-meta' },
        el('span', {}, `${q.category} · Q${q.number}/${q.of}`),
        el('span', {}, el('span', { class: `diff-pill diff-${q.difficulty}` }, q.difficultyLabel),
          q.multiplier > 1 ? ' · 2× points' : '')),
      el('div', { class: 'timer' }, bar),
      el('div', { class: 'q-text' }, q.text),
      el('div', { class: 'choices' }, q.choices.map((c, i) =>
        el('button', { class: 'choice', onclick: () => answer(i) },
          el('span', { class: 'key' }, `${i + 1}`), c, el('span', { class: 'tags' })))),
      el('div', { class: 'q-status', id: 'q-status' }, '')));
    runTimerBar(bar, q.durationMs, state.question.startedAt);
  });

  socket.on('opponentAnswered', () => {
    const s = $('#q-status');
    if (s && !state.question?.answered) s.textContent = `${state.match?.opponent.isBot ? 'Bot' : 'Stranger'} locked in 🔒 — hurry!`;
  });

  socket.on('reveal', ({ answer: correctIdx, you, opp, scores }) => {
    cancelAnimationFrame(state.timerRaf);
    if (state.question) state.question.answered = true;
    const buttons = $$('.choice');
    buttons.forEach((b, i) => {
      b.disabled = true;
      if (i === correctIdx) b.classList.add('correct');
      else if (i === you.choice) b.classList.add('wrong');
      const tags = b.querySelector('.tags');
      if (i === you.choice) tags.append(el('span', { class: 'tag you' }, 'YOU'));
      if (i === opp.choice) tags.append(el('span', { class: 'tag opp' }, 'OPP'));
    });
    const s = $('#q-status');
    if (s) {
      s.replaceChildren(you.correct
        ? el('span', {}, 'Correct! ', el('span', { class: 'pts' }, `+${you.points}`))
        : el('span', {}, you.choice === null ? 'Too slow! ' : 'Wrong. ',
          opp.correct ? `Opponent got +${opp.points}.` : 'Opponent missed too.'));
    }
    setScores(scores);
  });

  socket.on('break', ({ round, nextCategory, nextIsFinal, topic, durationMs, scores }) => {
    stopTimers();
    setScores(scores);
    const lead = scores.you - scores.opp;
    const count = el('b');
    const readyBtn = el('button', { class: 'btn primary', onclick: () => {
      socket.emit('ready');
      readyBtn.disabled = true;
      readyBtn.textContent = 'Waiting for opponent…';
    } }, 'Ready for next round');
    stage.replaceChildren(el('div', { class: 'stage-card' },
      el('div', { class: 'q-meta' }, el('span', {}, `Round ${round} done`), el('span', {}, 'Chat break · ', count, 's')),
      el('h2', {}, lead > 0 ? `You're up by ${lead} 😤` : lead < 0 ? `Down by ${-lead}. Comeback time.` : 'Dead even.'),
      el('p', { class: 'muted' }, 'Talk it out — here\'s a topic:'),
      el('div', { class: 'break-topic' }, topic),
      el('p', {}, 'Next up: ', el('b', {}, nextCategory), nextIsFinal ? ' — FINAL ROUND, 2× points' : ''),
      el('div', { class: 'cta-row', id: 'break-actions' }, readyBtn)));
    runCountdown(count, durationMs);
    $('#chat-input').focus();
  });

  socket.on('opponentReady', () => {
    const actions = $('#break-actions');
    if (actions) actions.append(el('p', { class: 'muted' }, 'Opponent is ready.'));
  });

  socket.on('chat', ({ from, text }) => addChat(from, text));

  socket.on('matchEnd', ({ outcome, reason, scores, stats, ranked, ratingDelta, rating, rank, rankChange }) => {
    stopTimers();
    if (state.match) state.match.ended = true;
    setScores(scores);
    const oppName = state.match?.opponent.name || 'your opponent';
    const banner = outcome === 'win' ? 'YOU MOGGED 🗿' : outcome === 'loss' ? 'GOT MOGGED 💀' : 'STALEMATE 🤝';
    const why = reason === 'forfeit'
      ? (outcome === 'win' ? `${oppName} left the match. Win by forfeit.` : 'You left the match.')
      : `${scores.you} – ${scores.opp} vs ${oppName}`;
    const adBox = el('div', { class: 'ad-slot' });
    stage.replaceChildren(el('div', { class: 'stage-card splash' },
      el('div', { class: `result-banner ${outcome}` }, banner),
      el('p', { class: 'muted' }, why),
      el('p', {}, `${stats.correct}/${stats.answered} correct`),
      ranked
        ? el('p', { class: `delta ${ratingDelta >= 0 ? 'up' : 'down'}` }, `${ratingDelta >= 0 ? '+' : ''}${ratingDelta} → ${rating} `, rankBadge(rank))
        : el('p', { class: 'muted' }, 'Practice match — rating unchanged.'),
      rankChange === 'up' ? el('p', { class: 'rank-change up' }, `🎉 Promoted to ${rank.icon} ${rank.name}! Harder questions unlocked.`) : null,
      rankChange === 'down' ? el('p', { class: 'rank-change down' }, `Dropped to ${rank.icon} ${rank.name}. Win it back!`) : null,
      el('div', { class: 'cta-row' },
        el('button', { class: 'btn primary', onclick: () => $('#next-btn').click() }, '⏭ Next stranger'),
        el('button', { class: 'btn ghost', onclick: () => {
          leaveMatch();
          socket.emit('queue', { mode: 'practice', difficulty: $('#difficulty').value });
        } }, '🤖 Practice')),
      el('p', { class: 'muted' }, 'Chat stays open — say GG!'),
      adBox));
    renderAd(adBox, 'results');
  });

  socket.on('opponentLeft', () => {
    addChat('system', `${state.match?.opponent.isBot ? 'The bot' : 'Stranger'} has disconnected.`);
    if (state.match?.video) closePeer('left');
  });

  socket.on('disconnect', () => {
    if (state.match && !state.match.ended) addChat('system', 'Connection lost. Reconnecting…');
    state.match = null;
    closePeer();
  });

  // ---------- Sign in ----------
  const PROVIDER_ICONS = {
    google: '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5.1 2.4-8.7 2.4-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z"/></svg>',
    discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9 -.3 13.5.1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1L18 21a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.7-3.7-13.6zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z"/></svg>',
  };

  function renderAuth(me) {
    state.signedIn = !!me.player;
    state.providers = me.providers;
    state.devLogin = me.devLogin;
    $('#signin-panel').hidden = state.signedIn;
    $('#play-panel').hidden = !state.signedIn;
    $('#account').hidden = !state.signedIn;
    $('#profile-card').hidden = !state.signedIn;
    if (state.signedIn) {
      $('#account-name').textContent = me.player.name;
      if (!me.player.needsName) nameInput.value = me.player.name;
      else nameInput.placeholder = 'Pick a nickname (not your real name)';
      return;
    }
    const buttons = me.providers.map(({ key, label }) => {
      const a = el('a', { class: `signin-btn ${key}`, href: `/auth/${key}` });
      a.insertAdjacentHTML('afterbegin', PROVIDER_ICONS[key] || ''); // static, trusted SVG
      a.append(`Continue with ${label}`);
      return a;
    });
    if (me.devLogin) {
      buttons.push(el('button', { class: 'signin-btn dev', onclick: () => {
        const name = prompt('Dev sign-in: pick a nickname');
        if (name) location.href = `/auth/dev?name=${encodeURIComponent(name)}`;
      } }, '🛠 Dev sign-in (local only)'));
    }
    $('#signin-buttons').replaceChildren(...buttons);
    $('#signin-empty').hidden = buttons.length > 0;
  }

  $('#signout-btn').addEventListener('click', async () => {
    leaveMatch();
    await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });

  const authError = new URLSearchParams(location.search).get('auth_error');
  if (authError) {
    const msg = {
      banned: 'This account has been banned for breaking the rules.',
      state: 'Sign-in expired. Please try again.',
    }[authError] || 'Sign-in failed. Please try again.';
    $('#signin-error').textContent = msg;
    $('#signin-error').hidden = false;
    history.replaceState(null, '', '/');
  }

  fetch('/api/me').then((r) => r.json()).then((me) => {
    renderAuth(me);
    if (state.signedIn && socket.connected) socket.emit('hello', {});
  }).catch(() => renderAuth({ player: null, providers: [], devLogin: false }));

  // ---------- Boot ----------
  fetch('/api/config').then((r) => r.json()).then((cfg) => {
    state.config = cfg;
    // Advertise modal: show the contact email once it's configured (CONTACT_EMAIL).
    $$('[data-contact-email]').forEach((n) => {
      n.textContent = cfg.contactEmail || 'us (contact email coming soon)';
    });
    renderStaticAds();
  }).catch(renderStaticAds);
  refreshLeaderboard();
})();
