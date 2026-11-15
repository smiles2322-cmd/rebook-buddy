/* Rebook Buddy by Smiles 2322. No accounts, no tracking. State lives in localStorage. */
(function () {
  'use strict';
  const KEY = 'rebookBuddy.v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const { AIRLINES, AIRPORTS } = RB.data;
  const DEFAULT_PACE = 55; // seconds per person when nothing observed yet
  const ITEMS = ['flight', 'hotel', 'voucher', 'notify', 'calendar'];

  const fresh = () => ({
    v: 1, view: 'setup', toured: false,
    flight: { airline: '', number: '', date: '', from: '', to: '', dep: '', status: 'scheduled' },
    line: { total: 0, pos: 0, served: 0, history: [], auto: false, speed: 3 },
    done: {}, pick: null, contact: { name: '', phone: '', msg: '', edited: false },
    hotelCity: '', phone: '', hold: { start: null, acc: 0 }, chat: [], alarm: { time: '', firedOn: '' },
    settings: { large: false, reduce: false, vibe: true }
  });
  let S;
  try { S = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || 'null') || {}); } catch (e) { S = fresh(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full or blocked */ } };

  /* ---------- helpers ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const code = s => String(s || '').trim().toUpperCase();
  const city = c => AIRPORTS[code(c).slice(0, 3)] || String(c || '').trim() || 'your city';
  const airline = () => AIRLINES.find(a => a.name.toLowerCase() === (S.flight.airline || '').toLowerCase());
  function fmtWait(sec) {
    if (sec < 60) return 'under a minute';
    const m = Math.round(sec / 60), h = Math.floor(m / 60), mm = m % 60;
    return h ? `${h} h ${mm} min` : `${m} min`;
  }
  const fmtClock = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`; };
  const fmtTime = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDay = iso => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : 'today';
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  const vibe = p => { if (S.settings.vibe && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { } } };
  let actx;
  function beep(times = 3) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.35;
        o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
        o.start(t0); o.stop(t0 + 0.3);
      }
    } catch (e) { }
  }

  /* ---------- settings ---------- */
  function applySettings() {
    document.documentElement.classList.toggle('large', !!S.settings.large);
    document.documentElement.classList.toggle('reduce', !!S.settings.reduce);
    $('#optLarge').checked = !!S.settings.large; $('#optMotion').checked = !!S.settings.reduce; $('#optVibe').checked = !!S.settings.vibe;
  }

  /* ---------- views ---------- */
  function show(view, focus) {
    S.view = view; save();
    $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
    $$('#tabbar button').forEach(b => b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
    if (view === 'line') renderLine();
    if (view === 'rescue') renderRescue();
    if (view === 'call') renderCall();
    if (view === 'chat') { renderChat(); }
    if (focus) { const h = $('#view-' + view + ' h1'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
  }

  /* ---------- flight setup ---------- */
  function fillLists() {
    $('#airlineList').innerHTML = AIRLINES.map(a => `<option value="${esc(a.name)}"></option>`).join('');
    $('#airportList').innerHTML = Object.entries(AIRPORTS).map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('');
  }
  function loadForm() {
    const f = S.flight;
    $('#fAirline').value = f.airline; $('#fNumber').value = f.number; $('#fDate').value = f.date;
    $('#fFrom').value = f.from; $('#fTo').value = f.to; $('#fDep').value = f.dep;
  }
  function readForm() {
    Object.assign(S.flight, {
      airline: $('#fAirline').value.trim(), number: $('#fNumber').value.trim().toUpperCase(), date: $('#fDate').value,
      from: code($('#fFrom').value), to: code($('#fTo').value), dep: $('#fDep').value
    });
  }
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  function exampleFlight() {
    S.flight = { airline: 'Harborline Air', number: 'HL 482', date: today(), from: 'ORD', to: 'SEA', dep: '18:40', status: S.flight.status || 'scheduled' };
    loadForm(); onFlightChanged();
  }
  function onFlightChanged() {
    const a = airline();
    if (a && (!S.phone || AIRLINES.some(x => x.phone === S.phone))) S.phone = a.phone;
    S.hotelCity = S.flight.from ? `${city(S.flight.from)} ${code(S.flight.from).slice(0, 3)} airport` : S.hotelCity;
    S.pick = null; altCache = null; save();
  }
  function cancelled() {
    readForm();
    if (!S.flight.number || !S.flight.from || !S.flight.to) exampleFlight();
    S.flight.status = 'cancelled';
    if (!S.line.total) { S.line = { total: 171, pos: 152, served: 0, history: [], auto: false, speed: 3 }; }
    if (!S.chat.length) {
      S.chat.push({ who: 'bot', text: `I'm sorry, ${S.flight.number} to ${city(S.flight.to)} was cancelled. Here's the plan:\n1. Hold your place in the rebooking line.\n2. Call the airline at the same time. Whoever answers first wins.\n3. Work through the checklist: next flight, hotel, vouchers, tell someone, calendar.\nWhat do you want to start with?` });
    }
    save(); toast('Flight marked as cancelled. Let\'s get you rebooked.'); vibe([60, 40, 60]);
    show('line', true);
  }

  /* ---------- line ---------- */
  const yourNum = () => Math.max(1, S.line.pos - S.line.served);
  const ahead = () => Math.max(0, S.line.pos - 1 - S.line.served);
  function pace() {
    const h = S.line.history;
    if (h.length >= 3) return { sec: Math.max(5, (h[h.length - 1] - h[0]) / (h.length - 1) / 1000), observed: true };
    return { sec: DEFAULT_PACE, observed: false };
  }
  const waitSec = () => ahead() * pace().sec;
  function step(dir) {
    const L = S.line;
    if (dir > 0) {
      if (ahead() <= 0) return;
      L.served++; L.history.push(Date.now()); if (L.history.length > 25) L.history.shift();
      vibe(30);
      if (ahead() === 0) { L.auto = false; vibe([100, 60, 100, 60, 200]); beep(3); toast('You are next! Walk up to the desk.'); announce('You are next in line. Walk up to the desk.'); }
      else if (ahead() % 10 === 0 || ahead() <= 5) announce(`${ahead()} people ahead of you.`);
    } else {
      if (L.served <= 0) return;
      L.served--; L.history.pop();
    }
    save(); renderLine(); renderStats();
  }
  function announce(t) { const el = $('#lineBig'); el.setAttribute('aria-label', t); const live = $('#toast'); live.textContent = t; live.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => live.classList.remove('show'), 2200); }
  function renderFlightStrip() {
    const f = S.flight;
    $('#flightStrip').innerHTML = f.number ? `<div><div class="route">${esc(code(f.from).slice(0, 3))} &rarr; ${esc(code(f.to).slice(0, 3))}</div><div class="meta">${esc(f.airline || 'Airline')} ${esc(f.number)}, ${esc(fmtDate(f.date))}</div></div><span class="status-chip ${f.status === 'cancelled' ? '' : 'ok'}">${f.status === 'cancelled' ? 'Cancelled' : 'Scheduled'}</span>`
      : `<div class="meta">No flight saved yet. <button class="btn ghost" data-go="setup">Add flight</button></div>`;
  }
  let lastDotKey = '';
  function renderLine() {
    renderFlightStrip();
    const L = S.line;
    if (!L.total) { $('#lineBig').innerHTML = 'Set your place in line below, or tap <strong>My flight was cancelled</strong> on the Flight tab to load the example.'; $('#dots').innerHTML = ''; $('#paceNote').textContent = 'Pace: no data'; }
    else {
      const a = ahead();
      $('#lineBig').innerHTML = a === 0 ? `<strong>You're next!</strong> Head to the desk with your confirmation code ready.`
        : `You're <strong>#${yourNum()}</strong> in line. ${a} ${a === 1 ? 'person' : 'people'} ahead, about ${fmtWait(waitSec())}.`;
      $('#lineBig').setAttribute('aria-label', $('#lineBig').textContent);
      const p = pace();
      $('#paceNote').textContent = `Pace: ${Math.round(p.sec)} s per person (${p.observed ? 'measured' : 'typical estimate'})`;
      const total = Math.min(L.total, 400), key = total + ':' + L.pos;
      const dots = $('#dots');
      if (key !== lastDotKey) { dots.innerHTML = '<span class="dot"></span>'.repeat(total); lastDotKey = key; }
      const kids = dots.children, youIdx = L.pos - 1;
      for (let i = 0; i < kids.length; i++) {
        kids[i].className = 'dot' + (i < L.served ? ' served' : i === youIdx ? ' you' : i === L.served && i < youIdx ? ' next' : i > youIdx ? ' behind' : '');
      }
    }
    $('#setPos').value = L.pos || ''; $('#setTotal').value = L.total || '';
    $('#autoLine').checked = !!L.auto; $('#autoSpeed').value = String(L.speed || 3);
    $('#btnStep').disabled = !L.total || ahead() === 0; $('#btnBack').disabled = !L.served;
    renderStats();
  }
  function renderStats() {
    $('#stAhead').textContent = S.line.total ? ahead() : '0';
    $('#stWait').textContent = S.line.total ? (ahead() ? fmtWait(waitSec()) : 'Your turn') : '0 min';
    $('#stHold').textContent = fmtClock(holdMs());
    const n = ITEMS.filter(k => S.done[k]).length;
    $('#stDone').textContent = `${n} of 5`;
  }

  /* ---------- rescue checklist ---------- */
  let altCache = null;
  async function renderAlts() {
    const ad = RB.adapters.active;
    $('#adapterNote').textContent = ad.isDemo ? 'Example options from built-in demo data. Real seats and times come from your airline.' : `Live options from ${ad.name}.`;
    if (!S.flight.from) { $('#altList').innerHTML = '<p class="small">Add your flight first.</p>'; return; }
    if (!altCache) { $('#altList').innerHTML = '<p class="small">Finding options...</p>'; altCache = await ad.searchAlternatives(S.flight); }
    $('#altList').innerHTML = altCache.map(o => `<button class="alt" data-alt="${o.id}" aria-pressed="${S.pick && S.pick.id === o.id}">
      <span class="alt-top"><span>${esc(o.airline)} ${esc(o.number)}${o.partner ? '<span class="tag">Partner</span>' : ''}</span><span>${fmtTime(o.depart)}</span></span>
      <span class="alt-sub">${esc(fmtDay(o.depart))}, arrives ${fmtTime(o.arrive)}. ${o.stops ? `1 stop (${esc(o.via)})` : 'Nonstop'}. ${o.seats} seats left (example).</span>
      <span class="alt-sub">${esc(o.note)}</span></button>`).join('') +
      `<p class="small">Tap the one you want, then ask the agent for it by flight number.</p>`;
  }
  function setDone(k, v) {
    S.done[k] = v; save(); renderRescueState(); renderStats();
    if (v) { vibe(40); const n = ITEMS.filter(i => S.done[i]).length; toast(n === 5 ? 'All 5 done. You handled it!' : 'Checked off. Nice work.'); }
  }
  function renderRescueState() {
    let n = 0;
    $$('#checklist .item').forEach(li => {
      const k = li.dataset.key, d = !!S.done[k]; if (d) n++;
      li.classList.toggle('done', d);
      const btn = $('.done-btn', li); if (btn) btn.setAttribute('aria-pressed', d);
      $('.item-toggle', li).setAttribute('aria-label', `${$('.item-toggle', li).textContent}${d ? ', done' : ', not done'}`);
    });
    $('#progBar').style.width = (n / 5 * 100) + '%';
    $('#progText').textContent = `${n} of 5 done`;
  }
  function msgText() {
    const f = S.flight, p = S.pick, nm = S.contact.name ? `Hi ${S.contact.name}, ` : 'Hi, ';
    return `${nm}my ${f.airline || ''} flight ${f.number || ''} from ${city(f.from)} to ${city(f.to)} was cancelled. I'm working on rebooking now${p ? `. I'm aiming for ${p.airline} ${p.number}, leaving ${fmtTime(p.depart)} ${fmtDay(p.depart)} and landing ${fmtTime(p.arrive)}` : ''}. I'll keep you posted.`.replace(/\s+/g, ' ');
  }
  function renderNotify() {
    if (!S.contact.edited) S.contact.msg = msgText();
    $('#cName').value = S.contact.name; $('#cPhone').value = S.contact.phone; $('#cMsg').value = S.contact.msg;
    updateSms();
  }
  function updateSms() { $('#smsLink').href = `sms:${encodeURIComponent((S.contact.phone || '').replace(/[^\d+]/g, ''))}?&body=${encodeURIComponent(S.contact.msg)}`; }
  function renderHotel() {
    const q = S.hotelCity || city(S.flight.from);
    $('#hotelCity').value = q;
    const d = S.flight.date || today(), d2 = new Date(new Date(d + 'T12:00:00').getTime() + 864e5).toISOString().slice(0, 10), e = encodeURIComponent(q);
    const links = [
      ['Google Hotels', `https://www.google.com/travel/search?q=${encodeURIComponent('hotels near ' + q)}`],
      ['Booking.com', `https://www.booking.com/searchresults.html?ss=${e}&checkin=${d}&checkout=${d2}`],
      ['Expedia', `https://www.expedia.com/Hotel-Search?destination=${e}&startDate=${d}&endDate=${d2}`],
      ['Hotels.com', `https://www.hotels.com/Hotel-Search?destination=${e}&startDate=${d}&endDate=${d2}`]
    ];
    $('#hotelLinks').innerHTML = links.map(([n, u]) => `<a class="btn ghost" href="${u}" target="_blank" rel="noopener">${n}<span class="sr-only"> (opens in new tab)</span></a>`).join('');
  }
  function flightForCal() {
    if (S.pick) return { title: `${S.pick.airline} ${S.pick.number} ${S.pick.from} to ${S.pick.to}`, start: new Date(S.pick.depart), end: new Date(S.pick.arrive) };
    const f = S.flight, s = new Date(`${f.date || today()}T${f.dep || '18:00'}:00`);
    return { title: `${f.airline} ${f.number} ${code(f.from)} to ${code(f.to)}`, start: s, end: new Date(s.getTime() + 3 * 36e5) };
  }
  function renderCal() {
    const c = flightForCal();
    $('#calSummary').textContent = `${S.pick ? 'New flight' : 'Original flight'}: ${c.title}, ${c.start.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`;
    $('#alarmTime').value = S.alarm.time || '';
  }
  function buildIcs() {
    const c = flightForCal(), z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Smiles 2322//Rebook Buddy//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@rebookbuddy`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(c.start)}`, `DTEND:${z(c.end)}`,
      `SUMMARY:Flight ${c.title.replace(/[,;]/g, ' ')}`, 'DESCRIPTION:Added by Rebook Buddy. Confirm times with your airline.',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Leave for the airport', 'TRIGGER:-PT3H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
    return lines.join('\r\n') + '\r\n';
  }
  function downloadIcs() {
    const blob = new Blob([buildIcs()], { type: 'text/calendar' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'rebook-buddy-flight.ics'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (!S.done.calendar) setDone('calendar', true); else toast('Calendar file saved. Open it to add the event.');
  }
  function renderRescue() { renderAlts(); renderHotel(); renderNotify(); renderCal(); renderRescueState(); }

  /* ---------- call helper ---------- */
  const holdMs = () => S.hold.acc + (S.hold.start ? Date.now() - S.hold.start : 0);
  function scripts() {
    const f = S.flight, a = airline(), partner = a ? a.partner : 'a partner airline', dest = city(f.to);
    return [
      { id: 'rebook', t: 'Rebook me', s: `Hi, my flight ${f.number || ''} from ${city(f.from)} to ${dest} on ${fmtDate(f.date)} was cancelled. My confirmation code is (read your code). Can you put me on the next available flight to ${dest}?` },
      { id: 'partner', t: 'Ask for a partner airline', s: `If your next flights are full, can you rebook me on a partner airline, like ${partner}? I'm fine with a connection if it gets me to ${dest} sooner.` },
      { id: 'pick', t: 'Ask for a specific flight', s: S.pick ? `I see ${S.pick.airline} ${S.pick.number} leaving at ${fmtTime(S.pick.depart)}. Can you put me on that one?` : 'Pick a flight on the checklist first, then I will write this one for you.' },
      { id: 'hotel', t: 'Hotel and meals', s: `If I'm stuck overnight, what hotel and meal vouchers can you give me? Was this cancellation caused by something in the airline's control, like crew or maintenance?` },
      { id: 'refund', t: 'If you decide not to fly', s: 'If I choose not to travel, please confirm I will get a full refund to my original payment, as the US Department of Transportation refund rules describe.' },
      { id: 'wrap', t: 'Before you hang up', s: 'Can you send the new itinerary, seat and any vouchers to my email or phone? And may I have your name in case we get cut off?' }
    ];
  }
  let speaking = null;
  function stopSpeech() { if (window.speechSynthesis) speechSynthesis.cancel(); speaking = null; $$('[data-say]').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.textContent = 'Read aloud'; }); }
  function say(id) {
    const was = speaking; stopSpeech(); if (was === id) return;
    const sc = scripts().find(x => x.id === id); if (!sc) return;
    const b = $(`[data-say="${id}"]`); speaking = id; b.setAttribute('aria-pressed', 'true'); b.textContent = 'Stop reading';
    if (!window.speechSynthesis) { toast('Read aloud is not available on this browser.'); return; }
    const u = new SpeechSynthesisUtterance(sc.s); u.rate = 0.95;
    u.onend = () => { if (speaking === id) stopSpeech(); };
    speechSynthesis.speak(u);
  }
  function renderCall() {
    $('#airPhone').value = S.phone || '';
    const a = airline();
    $('#phoneNote').textContent = a && S.phone === a.phone ? `Example number for ${a.name}, a made-up demo airline. Type your real airline's number here.` : 'Find the number on your booking email or the airline app.';
    updateTel(); renderHold();
    $('#scripts').innerHTML = scripts().map(x => `<div class="script"><h3>${esc(x.t)}</h3><p>${esc(x.s)}</p><div class="btn-row"><button class="btn ghost" data-say="${x.id}" aria-pressed="false" aria-label="Read aloud: ${esc(x.t)}">Read aloud</button><button class="btn ghost" data-copy="${x.id}" aria-label="Copy: ${esc(x.t)}">Copy</button></div></div>`).join('');
    speaking = null;
  }
  function updateTel() { $('#telLink').href = 'tel:' + (S.phone || '').replace(/[^\d+]/g, ''); }
  function renderHold() { $('#holdTime').textContent = fmtClock(holdMs()); $('#btnHold').textContent = S.hold.start ? 'Pause timer' : (S.hold.acc ? 'Resume timer' : 'Start timer'); }

  /* ---------- chat ---------- */
  const RULES = [
    { k: ['line', 'wait', 'how long', 'position', 'ahead', 'queue'], r: () => S.line.total ? `You're #${yourNum()} with ${ahead()} ahead. At the current pace that's about ${fmtWait(waitSec())}. Tap "Line moved" each time someone is helped and I'll sharpen the estimate.` : 'Tell me your spot in line on the Line tab and I will estimate the wait.', go: 'line' },
    { k: ['hotel', 'sleep', 'room', 'tonight', 'stay'], r: () => `Ask the desk or phone agent for a hotel voucher first. If they won't give one, I've got hotel searches near ${city(S.flight.from)} on the checklist. Keep the receipt.`, go: 'rescue' },
    { k: ['refund', 'money back', 'rights', 'dot', 'law', 'compensation'], r: () => 'In the US, if the airline cancels and you decide not to travel, you can get a refund of your ticket, even a non-refundable one. Taking a new flight or credit usually ends that option. Meals and hotels depend on the airline\'s own policy. Details and the DOT link are on the checklist.', go: 'rescue' },
    { k: ['voucher', 'meal', 'food', 'eat', 'hungry'], r: () => 'Ask for a meal voucher if you\'re waiting more than a few hours, and ask whether the cancellation was in the airline\'s control. That often decides what they offer.', go: 'rescue' },
    { k: ['call', 'phone', 'hold', 'say', 'script', 'agent'], r: () => 'Call while you stay in line. Whoever answers first wins. I have scripts ready, including asking for a partner airline, and I can read them out loud.', go: 'call' },
    { k: ['flight', 'next', 'rebook', 'partner', 'option', 'seat'], r: () => S.pick ? `You picked ${S.pick.airline} ${S.pick.number} at ${fmtTime(S.pick.depart)}. Ask the agent for it by number.` : 'I have example options on the checklist, including a partner airline. Pick one so you can ask for it by flight number.', go: 'rescue' },
    { k: ['tell', 'text', 'family', 'friend', 'message', 'notify', 'mom', 'boss'], r: () => 'I wrote a message for you on the checklist. Add a name and tap Share or Text. You send it yourself.', go: 'rescue' },
    { k: ['calendar', 'alarm', 'remind', 'wake'], r: () => 'Once you have a new flight, download the calendar event. It has a 3 hour alert built in. You can also set a wake-up reminder.', go: 'rescue' },
    { k: ['thank', 'thanks', 'great', 'ok'], r: () => 'You\'ve got this. I\'m here if you need anything else.' },
    { k: ['hi', 'hello', 'hey', 'help', 'start'], r: () => nextTip() }
  ];
  function nextTip() {
    if (S.flight.status !== 'cancelled') return 'Hi! Add your flight on the Flight tab. If it gets cancelled, tap the red button and I\'ll take it from there.';
    const todo = ITEMS.find(k => !S.done[k]);
    const map = { flight: 'Next up: pick a backup flight so you can ask for it by number.', hotel: 'Next up: sort out a place to sleep, just in case.', voucher: 'Next up: ask about meal and hotel vouchers, and know your refund rights.', notify: 'Next up: let someone know what\'s going on.', calendar: 'Last step: put the new flight on your calendar with an alarm.' };
    return todo ? map[todo] : 'Everything on your checklist is done. Nice work! Keep your confirmation and receipts handy.';
  }
  function reply(text) {
    const t = text.toLowerCase();
    const rule = RULES.find(r => r.k.some(k => new RegExp(`\\b${k}`).test(t)));
    if (rule) return { who: 'bot', text: rule.r(), go: rule.go };
    return { who: 'bot', text: `I'm a simple helper, so I may not get that one. Try asking about the line, hotels, refunds, calling or your next flight.\n\n${nextTip()}` };
  }
  const VIEW_NAMES = { line: 'Open line', rescue: 'Open checklist', call: 'Open call helper', setup: 'Open flight' };
  function renderChat() {
    if (!S.chat.length) { S.chat.push({ who: 'bot', text: nextTip() }); save(); }
    $('#chatLog').innerHTML = S.chat.map(m => `<div class="msg ${m.who}">${m.who === 'bot' ? '<span class="sr-only">Buddy: </span>' : '<span class="sr-only">You: </span>'}${esc(m.text)}${m.go ? `<br><button class="go" data-go="${m.go}">${VIEW_NAMES[m.go]}</button>` : ''}</div>`).join('');
    $('#chatLog').scrollTop = 1e9;
    $('#chips').innerHTML = ['Where am I in line?', 'Find a hotel', 'Can I get a refund?', 'What do I say on the phone?', 'Next flights', 'Tell my family'].map(c => `<button class="chip">${c}</button>`).join('');
  }
  function sendChat(text) {
    text = text.trim(); if (!text) return;
    S.chat.push({ who: 'me', text }); S.chat.push(reply(text));
    if (S.chat.length > 60) S.chat = S.chat.slice(-60);
    save(); renderChat();
  }

  /* ---------- tour ---------- */
  const TOUR = [
    { t: 'Welcome to Rebook Buddy', x: 'When a flight gets cancelled, everyone rushes the desk. Rebook Buddy helps you work every angle at once, calmly.', i: '<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>' },
    { t: 'Track the line', x: 'Enter your spot in the rebooking line. Tap each time someone is helped, and Rebook Buddy learns the pace and estimates your wait.', i: '<svg viewBox="0 0 24 24"><path d="M4 7a2 2 0 104 0 2 2 0 00-4 0zm6 0a2 2 0 104 0 2 2 0 00-4 0zm6 0a2 2 0 104 0 2 2 0 00-4 0zM4 15a2 2 0 104 0 2 2 0 00-4 0zm6 0a2 2 0 104 0 2 2 0 00-4 0zm6 0a2 2 0 104 0 2 2 0 00-4 0z"/></svg>' },
    { t: 'Work the checklist', x: 'Next flight, hotel, vouchers and your rights, a message for your people, and a calendar event with an alarm.', i: '<svg viewBox="0 0 24 24"><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z"/></svg>' },
    { t: 'Call while you wait', x: 'Tap to call the airline, time your hold, and use ready scripts. Rebook Buddy can read them out loud for you.', i: '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.5 15.5 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>' },
    { t: 'Private and works offline', x: 'No account, no tracking. Everything stays on your phone and works without signal. This version uses example flight data.', i: '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4z"/></svg>' }
  ];
  let tourI = 0;
  function tourRender() {
    const s = TOUR[tourI];
    $('#tourArt').innerHTML = s.i; $('#tourTitle').textContent = s.t; $('#tourText').textContent = s.x;
    $('#tourStep').textContent = `Step ${tourI + 1} of ${TOUR.length}`;
    $('#tourNext').textContent = tourI === TOUR.length - 1 ? "Let's go" : 'Next';
  }
  function tourOpen() { tourI = 0; tourRender(); const d = $('#tour'); if (!d.open) d.showModal(); $('#tourNext').focus(); }
  function tourClose() { S.toured = true; save(); $('#tour').close(); }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]'); if (go) { show(go.dataset.go, true); return; }
    const tab = e.target.closest('#tabbar button'); if (tab) { show(tab.dataset.view, true); return; }
    const tog = e.target.closest('.item-toggle');
    if (tog) { const body = document.getElementById(tog.getAttribute('aria-controls')), open = tog.getAttribute('aria-expanded') === 'true'; tog.setAttribute('aria-expanded', !open); body.hidden = open; return; }
    const alt = e.target.closest('[data-alt]');
    if (alt) { S.pick = altCache.find(o => o.id === alt.dataset.alt); save(); renderAlts(); renderNotify(); renderCal(); setDone('flight', true); return; }
    const dn = e.target.closest('[data-done]'); if (dn) { setDone(dn.dataset.done, !S.done[dn.dataset.done]); return; }
    const sy = e.target.closest('[data-say]'); if (sy) { say(sy.dataset.say); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) { const sc = scripts().find(x => x.id === cp.dataset.copy); (navigator.clipboard ? navigator.clipboard.writeText(sc.s) : Promise.reject()).then(() => toast('Copied.'), () => toast('Could not copy on this browser.')); return; }
    const chip = e.target.closest('.chip'); if (chip) { sendChat(chip.textContent); return; }
  });
  $('#flightForm').addEventListener('submit', e => {
    e.preventDefault(); readForm();
    if (!S.flight.number || !S.flight.from || !S.flight.to) { $('#formMsg').style.color = '#ffb3b5'; $('#formMsg').textContent = 'Please add a flight number, from and to.'; return; }
    onFlightChanged(); $('#formMsg').style.color = ''; $('#formMsg').textContent = 'Flight saved.'; toast('Flight saved.');
  });
  $('#btnExample').addEventListener('click', () => { exampleFlight(); $('#formMsg').textContent = 'Example flight loaded. This is demo data.'; });
  $('#btnCancelled').addEventListener('click', cancelled);
  $('#btnStep').addEventListener('click', () => step(1));
  $('#btnBack').addEventListener('click', () => step(-1));
  $('#autoLine').addEventListener('change', e => { S.line.auto = e.target.checked && S.line.total > 0 && ahead() > 0; lastAuto = Date.now(); save(); renderLine(); toast(S.line.auto ? 'The line will move on its own.' : 'Automatic line paused.'); });
  $('#autoSpeed').addEventListener('change', e => { S.line.speed = +e.target.value; save(); });
  $('#btnSetPos').addEventListener('click', () => {
    const pos = Math.max(1, Math.min(999, parseInt($('#setPos').value, 10) || 1)); let tot = parseInt($('#setTotal').value, 10) || pos;
    tot = Math.max(pos, Math.min(999, tot));
    S.line = Object.assign(S.line, { pos, total: tot, served: 0, history: [] }); lastDotKey = ''; save(); renderLine(); toast(`Got it. You're #${pos} of ${tot}.`);
  });
  $('#hotelCity').addEventListener('input', e => { S.hotelCity = e.target.value; save(); clearTimeout(window.__hc); window.__hc = setTimeout(renderHotel, 500); });
  $('#cName').addEventListener('input', e => { S.contact.name = e.target.value; if (!S.contact.edited) { S.contact.msg = msgText(); $('#cMsg').value = S.contact.msg; } updateSms(); save(); });
  $('#cPhone').addEventListener('input', e => { S.contact.phone = e.target.value; updateSms(); save(); });
  $('#cMsg').addEventListener('input', e => { S.contact.msg = e.target.value; S.contact.edited = true; updateSms(); save(); });
  $('#btnShare').addEventListener('click', async () => {
    const text = S.contact.msg;
    if (navigator.share) { try { await navigator.share({ text }); if (!S.done.notify) setDone('notify', true); } catch (e) { /* user closed the share sheet */ } }
    else if (navigator.clipboard) { navigator.clipboard.writeText(text).then(() => toast('Message copied. Paste it into any app.'), () => toast('Use the Text it button instead.')); }
  });
  $('#btnIcs').addEventListener('click', downloadIcs);
  $('#btnAlarm').addEventListener('click', () => {
    const t = $('#alarmTime').value; if (!t) { $('#alarmMsg').textContent = 'Pick a time first.'; return; }
    S.alarm = { time: t, firedOn: '' }; save();
    $('#alarmMsg').textContent = `Reminder set for ${new Date('2000-01-01T' + t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Keep this app open, and set your phone alarm too.`;
    if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) { } }
  });
  $('#airPhone').addEventListener('input', e => { S.phone = e.target.value; updateTel(); save(); });
  $('#btnHold').addEventListener('click', () => {
    if (S.hold.start) { S.hold.acc += Date.now() - S.hold.start; S.hold.start = null; } else S.hold.start = Date.now();
    save(); renderHold(); renderStats();
  });
  $('#btnHoldReset').addEventListener('click', () => { S.hold = { start: null, acc: 0 }; save(); renderHold(); renderStats(); });
  $('#chatForm').addEventListener('submit', e => { e.preventDefault(); sendChat($('#chatIn').value); $('#chatIn').value = ''; });
  $('#btnTour').addEventListener('click', tourOpen);
  $('#tourNext').addEventListener('click', () => { if (tourI < TOUR.length - 1) { tourI++; tourRender(); } else tourClose(); });
  $('#tourSkip').addEventListener('click', tourClose);
  $('#tour').addEventListener('cancel', () => { S.toured = true; save(); });
  $('#btnSettings').addEventListener('click', () => $('#settings').showModal());
  $('#setClose').addEventListener('click', () => $('#settings').close());
  $('#optLarge').addEventListener('change', e => { S.settings.large = e.target.checked; save(); applySettings(); });
  $('#optMotion').addEventListener('change', e => { S.settings.reduce = e.target.checked; save(); applySettings(); });
  $('#optVibe').addEventListener('change', e => { S.settings.vibe = e.target.checked; save(); });
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('Start over? This clears your flight, line and checklist on this phone.')) return;
    stopSpeech(); const keep = S.settings; S = fresh(); S.settings = keep; S.toured = true; altCache = null; lastDotKey = ''; save();
    $('#settings').close(); loadForm(); show('setup', true); toast('Cleared.');
  });

  /* ---------- tick ---------- */
  let lastAuto = Date.now();
  setInterval(() => {
    if (S.line.auto && Date.now() - lastAuto >= (S.line.speed || 3) * 1000) { lastAuto = Date.now(); step(1); }
    if (S.hold.start) { if (S.view === 'call') renderHold(); }
    if (S.view === 'line') renderStats();
    if (S.alarm.time) {
      const n = new Date(), hm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`, day = n.toDateString();
      if (hm === S.alarm.time && S.alarm.firedOn !== day) {
        S.alarm.firedOn = day; save(); beep(6); vibe([300, 200, 300, 200, 300]); toast('Time to get moving. Check your flight!');
        if ('Notification' in window && Notification.permission === 'granted') { try { new Notification('Rebook Buddy', { body: 'Time to get moving. Check your flight!' }); } catch (e) { } }
      }
    }
  }, 500);

  /* ---------- boot ---------- */
  fillLists(); loadForm(); applySettings();
  if (!S.flight.date) $('#fDate').value = today();
  show(S.view || 'setup');
  if (!S.toured) setTimeout(tourOpen, 300);
  window.__rb = { get state() { return S; }, buildIcs, ahead, waitSec, pace };
  if ('serviceWorker' in navigator && !/[?&]nosw/.test(location.search)) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
