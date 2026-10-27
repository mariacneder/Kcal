/* app.js — Meu Corpo.
   Regras principais:
   • Calorias são DIÁRIAS: à meia-noite o dia zera; só o total fica guardado (o detalhe das refeições é apagado).
   • Metas (kcal/dia, cardio/semana, peso desejado) são MENSAIS e nunca alteram meses anteriores.
   • Cardio: registrado por dia, meta por semana (segunda a domingo).
   • Treino: uma ficha por dia da semana; só muda quando você editar.
   • Peso e medidas: mensais, sempre editáveis. */
'use strict';
const APP_VERSION = '1.0';


const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const s = String(v ?? '').trim(); if (!s) return null; const n = parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : null; };
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const val = x => (x == null ? '' : String(x).replace('.', ','));
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => toISO(new Date());
const addDays = (iso, n) => { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = ym => fromISO(ym + '-01').toLocaleDateString('pt-BR', { month: 'long' });
const monthOf = iso => iso.slice(0, 7);
const dateBR = iso => fromISO(iso).toLocaleDateString('pt-BR');
const daysIn = d => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const fq = n => { const r = Math.round(Number(n || 0) * 10) / 10; return fmt(r, Number.isInteger(r) ? 0 : 1); };
const sumBy = (arr, k) => arr.reduce((a, i) => a + (i[k] || 0), 0);
const weekStart = iso => { const d = fromISO(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toISO(d); };
function dateLabel(iso) {
  const t = todayISO();
  if (iso === t) return 'Hoje'; if (iso === addDays(t, -1)) return 'Ontem'; if (iso === addDays(t, 1)) return 'Amanhã';
  return fromISO(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).replace('.', '');
}
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
const errMsg = e => (e && e.name === 'QuotaExceededError') ? 'Sem espaço no aparelho' : (e && e.message) || 'Algo deu errado';
const field = (id, label, v = '', extra = '') => `<label class="field"><span>${label}</span><input id="${id}" value="${esc(v)}" ${extra}></label>`;
const dec = (id, label, v) => field(id, label, val(v), 'inputmode="decimal" autocomplete="off"');
const empty = (t, m) => `<div class="card empty"><b>${t}</b>${m}</div>`;

// ---------- constantes e estado ----------
const MEALS = [['cafe', 'Café da manhã'], ['almoco', 'Almoço'], ['lanche', 'Lanche'], ['jantar', 'Jantar'], ['ceia', 'Ceia']];
const mealName = id => (MEALS.find(m => m[0] === id) || [0, 'Refeição'])[1];
const CARDIO = ['Esteira', 'Caminhada', 'Corrida', 'Bicicleta', 'Elíptico', 'Escada', 'Outro'];
// MET de referência (Compêndio de Atividades Físicas). Sem MET = sem estimativa: só vale a caloria informada.
const MET = { Esteira: 4.3, Caminhada: 4.3, Corrida: 9.8, Bicicleta: 6.8, 'Elíptico': 5.0, Escada: 9.0 };
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WDF = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MEAS = [['cintura', 'Cintura'], ['abdomen', 'Abdômen'], ['quadril', 'Quadril'], ['torax', 'Busto/tórax'], ['braco', 'Braço'], ['coxa', 'Coxa'], ['panturrilha', 'Panturrilha']];
const state = {
  tab: 'inicio', date: todayISO(), today: todayISO(), wd: null, open: new Set(), goals: {}, cur: {}, ew: null, foods: [], saved: [],
  lastKg: null, moreMonths: false, moreWeights: false, urls: [],
  settings: { name: '', theme: 'auto', addCardio: false, syncUrl: '', syncToken: '', lastSync: '', askedWeight: '' }
};

// ---------- metas por mês (nunca mexem em meses anteriores) ----------
const goalPick = e => ({ kcal: e?.kcal ?? null, cardioMin: e?.cardioMin ?? null, weight: e?.weight ?? null });
const goalBase = e => (e ? (e.only ? e.base : e) : null);   // valor que o mês seguinte herda
function goalsFor(ym) {
  if (state.goals[ym]) return state.goals[ym];
  for (const k of Object.keys(state.goals).filter(k => k < ym).sort().reverse()) { const b = goalBase(state.goals[k]); if (b) return b; }
  return {};
}
async function ensureMonth() {
  const ym = monthOf(todayISO()); if (state.goals[ym]) return;
  state.goals[ym] = goalPick(goalsFor(ym)); await DB.setSetting('goals', state.goals);
}
async function saveGoals(ym, vals, scope) {
  const e = state.goals[ym], base = e ? goalPick(goalBase(e)) : goalPick(goalsFor(ym));
  state.goals[ym] = scope === 'only' ? { ...vals, only: true, base } : { ...vals };
  await DB.setSetting('goals', state.goals);
}

// ---------- cálculos ----------
const scale = (f, qty) => { const x = qty / f.refQty; return { kcal: (f.kcal || 0) * x, prot: (f.prot || 0) * x, carb: (f.carb || 0) * x, fat: (f.fat || 0) * x }; };
const foodName = f => f.prep ? `${f.name}, ${f.prep}` : f.name;
// Calorias ativas estimadas = (MET − 1) × peso × horas. A caloria informada à mão sempre tem prioridade.
function cardioKcal(a) {
  if (a.kcal != null) return a.kcal;
  const met = MET[a.type]; if (!met || !state.lastKg) return null;
  return (met - 1) * state.lastKg * a.min / 60;
}
const isEstimate = a => a.kcal == null && cardioKcal(a) != null;
async function refreshWeight() { const w = (await DB.all('weights')).sort((a, b) => a.date.localeCompare(b.date)); state.lastKg = w.length ? w[w.length - 1].kg : null; return w; }
async function dayInfo(date) {
  const [items, acts] = await Promise.all([DB.where('diary', 'date', date), DB.where('activities', 'date', date)]);
  const g = goalsFor(monthOf(date)), eaten = sumBy(items, 'kcal'), burned = acts.reduce((s, a) => s + (cardioKcal(a) || 0), 0);
  const bonus = state.settings.addCardio && date === todayISO() ? burned : 0;
  const avail = g.kcal == null ? null : g.kcal + bonus;
  return { items, acts, g, eaten, burned, bonus, avail, left: avail == null ? null : avail - eaten };
}
async function weekInfo(date) {
  const s = weekStart(date), e = addDays(s, 6), acts = (await DB.all('activities')).filter(a => a.date >= s && a.date <= e);
  return { s, e, acts, min: sumBy(acts, 'min'), kcal: acts.reduce((t, a) => t + (cardioKcal(a) || 0), 0) };
}
async function updateDaily(date) {
  const [items, acts, old] = await Promise.all([DB.where('diary', 'date', date), DB.where('activities', 'date', date), DB.get('daily', date)]);
  const past = date < todayISO();
  // Dia passado já fechado: o detalhe foi apagado, então não recalculamos as calorias (só o cardio).
  const rec = past && old && !items.length ? { ...old }
    : { date, kcal: sumBy(items, 'kcal'), prot: sumBy(items, 'prot'), carb: sumBy(items, 'carb'), fat: sumBy(items, 'fat'), goal: past && old ? old.goal : (goalsFor(monthOf(date)).kcal ?? null) };
  if (!past || rec.trainTotal == null) {   // treino do dia: quantos exercícios foram feitos (guardado ao virar o dia)
    const [wk, ss] = await Promise.all([DB.get('workouts', String(fromISO(date).getDay())), DB.get('sessions', date)]);
    rec.trainTotal = wk ? wk.exercises.length : 0; rec.trainDone = ss ? ss.done.length : 0;
  }
  rec.date = date; rec.cardioMin = sumBy(acts, 'min'); rec.cardioKcal = acts.reduce((t, a) => t + (cardioKcal(a) || 0), 0);
  await DB.put('daily', rec);
}
// À meia-noite o dia zera: guarda só o total e apaga o detalhe das refeições de dias anteriores.
async function rollover() {
  const old = (await DB.all('diary')).filter(e => e.date < todayISO());
  for (const d of new Set(old.map(e => e.date))) await updateDaily(d);
  for (const e of old) await DB.del('diary', e.id);
}

// ---------- tema ----------
function applyTheme() {
  const t = state.settings.theme, r = document.documentElement;
  t === 'auto' || !t ? r.removeAttribute('data-theme') : r.setAttribute('data-theme', t);
  const dark = t === 'dark' || ((t === 'auto' || !t) && matchMedia('(prefers-color-scheme: dark)').matches);
  const hc = getComputedStyle(document.querySelector('.topbar')).backgroundColor;
  document.querySelectorAll('meta[name=theme-color]').forEach(m => m.setAttribute('content', hc));
}

// ---------- abas ----------
const ICON = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  alimentacao: '<path d="M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M17 3c-2 2-3 5-3 8h3v10"/>',
  treinos: '<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>',
  evolucao: '<path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/>'
};
const TABS = [['inicio', 'Início'], ['alimentacao', 'Alimentação'], ['treinos', 'Treinos'], ['evolucao', 'Evolução']];
function renderTabbar() {
  $('#tabbar').innerHTML = TABS.map(([id, l]) => `<button class="tab" data-tab="${id}" ${id === state.tab ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[id]}</svg>${l}</button>`).join('');
}
function go(tab) { state.tab = tab; history.replaceState(null, '', '#' + tab); render(true); }
function renderHeader() {
  document.body.dataset.area = state.tab;
  const t = state.tab, now = new Date(), tomorrow = addDays(todayISO(), 1);
  $('#titulo').textContent = t === 'inicio' && state.settings.name ? 'Olá, ' + state.settings.name : TABS.find(x => x[0] === t)[1];
  $('#monthinfo').textContent = `${cap(monthName(monthOf(todayISO())))} · dia ${now.getDate()}/${daysIn(now)}`;
  $('#datenav').hidden = !['inicio', 'alimentacao'].includes(t);
  $('#dia-label').textContent = dateLabel(state.date); $('#dia-input').value = state.date; $('#dia-input').max = tomorrow;
  $('#dia-prox').disabled = state.date >= tomorrow;
}

// ---------- avisos ----------
const banner = (msg, btn, act) => `<div class="card banner"><span>${msg}</span><button class="btn" data-act="${act}">${btn}</button></div>`;
function weightBanner(weights) {
  const t = new Date(), ym = monthOf(toISO(t)), last = daysIn(t), inM = weights.filter(w => w.date.startsWith(ym));
  if (!inM.length) return banner(`Novo mês: registre seu peso de ${monthName(ym)}.`, 'Registrar', 'weight');
  const lim = toISO(new Date(t.getFullYear(), t.getMonth(), last - 2));
  if (t.getDate() >= last - 2 && !inM.some(w => w.date >= lim)) return banner('Fim do mês: atualize seu peso final.', 'Registrar', 'weight');
  return '';
}

// ---------- telas ----------
function hero(info, tomorrow) {
  const { eaten, avail, left, items } = info, C = 2 * Math.PI * 46, pct = avail > 0 ? Math.min(1, eaten / avail) : 0;
  const mac = (l, v, c) => `<div><span class="muted">${l}</span><b style="color:${c}">${fmt(v)} g</b></div>`;
  return `<div class="card hero"><div class="ring-wrap">
      <svg class="ring" viewBox="0 0 112 112" role="img" aria-label="Calorias restantes">
        <circle cx="56" cy="56" r="46" fill="none" stroke-width="11" style="stroke:var(--track)"/>
        <circle cx="56" cy="56" r="46" transform="rotate(-90 56 56)" fill="none" stroke-width="11" stroke-linecap="round" style="stroke:${left != null && left < 0 ? 'var(--danger)' : 'var(--accent)'};transition:stroke-dashoffset .4s" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
        <text x="56" y="58" text-anchor="middle" font-size="22" font-weight="800">${left == null ? '—' : fmt(Math.abs(left))}</text>
        <text x="56" y="74" text-anchor="middle" font-size="10" opacity=".75">${left != null && left < 0 ? 'kcal acima' : 'kcal restam'}</text></svg>
      <div class="stats"><div><span class="muted">Meta do dia</span><b>${avail == null ? '—' : fmt(avail)}</b></div><div><span class="muted">Consumidas</span><b>${fmt(eaten)}</b></div></div></div>
    ${avail == null ? `<button class="btn soft block" style="margin-top:14px" data-act="config">Definir metas do mês</button>` : ''}
    <div class="macros">${mac('Proteína', sumBy(items, 'prot'), 'var(--prot)')}${mac('Carbo', sumBy(items, 'carb'), 'var(--carb)')}${mac('Gordura', sumBy(items, 'fat'), 'var(--fat)')}</div></div>`;
}
async function pastCard(date) {
  const d = await DB.get('daily', date);
  return `<div class="card hero"><b style="text-transform:capitalize">${dateLabel(date)} · ${dateBR(date)}</b>
    ${d ? `<div class="kv"><span class="muted">Calorias consumidas</span><b>${fmt(d.kcal)} kcal</b></div>${d.goal ? `<div class="kv"><span class="muted">Meta daquele dia</span><b>${fmt(d.goal)} kcal</b></div>` : ''}<div class="kv"><span class="muted">Cardio</span><b>${fmt(d.cardioMin)} min</b></div>${d.trainTotal ? `<div class="kv"><span class="muted">Treino</span><b>${d.trainDone || 0} de ${d.trainTotal} exercícios</b></div>` : ''}` : '<p class="muted" style="margin:8px 0 0">Sem registro neste dia.</p>'}
    <p class="muted" style="margin:10px 0 0">À meia-noite o dia zera: o detalhe das refeições é apagado e ficam só os totais.</p>
    <div class="grid2" style="margin-top:14px"><button class="btn" data-act="editday">Corrigir total</button><button class="btn primary" data-act="today">Voltar para hoje</button></div></div>`;
}

const SCREENS = {
  async inicio() {
    const t = todayISO(), isToday = state.date === t, isPast = state.date < t;
    if (isPast) return pastCard(state.date);
    const dow = fromISO(state.date).getDay();
    const [info, weights, w, sess, wk] = await Promise.all([dayInfo(state.date), refreshWeight(), DB.get('workouts', String(dow)), DB.get('sessions', state.date), weekInfo(state.date)]);
    const g = info.g, gw = g.cardioMin || 0, remaining = Math.max(0, gw - wk.min);
    const today = info.acts, todayMin = sumBy(today, 'min'), todayKcal = info.burned, anyEst = today.some(isEstimate);
    const done = sess ? sess.done.length : 0, n = w ? w.exercises.length : 0, last = weights[weights.length - 1];
    let html = isToday ? weightBanner(weights) : '';
    html += hero(info, !isToday);
    if (!isPast) html += `<div class="card"><div class="row"><div style="min-width:0"><b><span class="dot" style="background:var(--c-cardio)"></span>Cardio da semana</b>
        <div class="big" style="margin-top:8px;font-size:${gw ? 30 : 26}px">${gw ? (remaining > 0 ? `${fmt(remaining)} <small>min faltam</small>` : 'Meta batida!') : `${fmt(wk.min)} <small>min na semana</small>`}</div></div>
        <button class="round f-cardio" data-act="cadd" aria-label="Registrar cardio">+</button></div>
      <div class="bar" style="margin-top:12px"><i style="width:${gw ? Math.min(100, wk.min / gw * 100) : 0}%;background:var(--c-cardio)"></i></div>
      <div class="row" style="margin-top:10px"><span class="muted">${gw ? `${fmt(wk.min)} de ${fmt(gw)} min nesta semana` : 'Defina a meta semanal em Configurações'}</span><button class="mini" data-act="cweek">Ver registros</button></div>
      <p class="muted" style="margin:4px 0 0">${cap(dateLabel(state.date))}: ${fmt(todayMin)} min${todayKcal ? ` · ${anyEst ? '~' : ''}${fmt(todayKcal)} kcal${anyEst ? ' (estimativa)' : ''}` : ''}</p></div>`;
    const title = `Treino de ${WDF[dow]}${w && w.name ? ' · ' + esc(w.name) : ''}`;
    html += `<div class="card"><div class="row"><b><span class="dot" style="background:var(--c-train)"></span>${title}</b><span class="muted">${n ? (isToday ? done + '/' + n + ' feitos' : n + ' exercícios') : 'sem ficha'}</span></div>
      <button class="btn block ${n ? 'f-train' : ''}" style="margin-top:12px" data-act="gotreino">${n ? 'Abrir treino' : 'Montar treino'}</button></div>`;
    if (isToday) html += `<div class="card"><div class="row"><b><span class="dot" style="background:var(--c-body)"></span>Peso</b><span class="muted">${g.weight ? 'meta ' + val(g.weight) + ' kg' : ''}</span></div>
      <div class="row" style="margin-top:8px"><div><div class="big">${last ? val(last.kg) + ' <small>kg</small>' : '—'}</div>${last ? `<p class="muted" style="margin:6px 0 0">em ${dateBR(last.date)}</p>` : ''}</div>
      <button class="btn" data-act="weight">${last ? 'Novo peso' : 'Registrar'}</button></div></div>`;
    return html;
  },

  async alimentacao() {
    if (state.date < todayISO()) return pastCard(state.date);
    const info = await dayInfo(state.date), tomorrow = state.date > todayISO();
    const { items, avail, left, eaten } = info, pct = avail > 0 ? Math.min(100, eaten / avail * 100) : 0;
    const summary = `<div class="card hero"><div class="row"><div><div class="muted">Ainda posso comer</div>
        <div class="big" style="margin-top:6px;color:${left != null && left < 0 ? 'var(--danger)' : 'var(--ink)'}">${left == null ? '—' : fmt(Math.abs(left))} <small>${left != null && left < 0 ? 'kcal acima' : 'kcal'}</small></div></div>
        <div style="text-align:right"><div class="muted">${fmt(eaten)} de ${avail == null ? '—' : fmt(avail)}</div><div class="muted">P ${fmt(sumBy(items, 'prot'))} · C ${fmt(sumBy(items, 'carb'))} · G ${fmt(sumBy(items, 'fat'))}</div></div></div>
      <div class="bar" style="margin-top:12px"><i style="width:${pct}%;background:${left != null && left < 0 ? 'var(--danger)' : 'var(--accent)'}"></i></div>
      ${avail == null ? `<button class="btn soft block" style="margin-top:12px" data-act="config">Definir meta de calorias</button>` : ''}</div>`;
    const meals = MEALS.map(([id, nome]) => {
      const its = items.filter(i => i.meal === id);
      return `<div class="card"><div class="row" style="margin-bottom:2px"><b style="font-size:17px">${nome}</b><span class="pill">${fmt(sumBy(its, 'kcal'))} kcal</span></div>
        ${its.map(i => `<div class="list-item"><button class="rowbtn" data-act="entry" data-id="${i.id}"><b>${esc(foodName(i.f))}</b><span class="muted">${fq(i.qty)} ${esc(i.f.unit)}${i.f.brand ? ' · ' + esc(i.f.brand) : ''}</span></button><span style="white-space:nowrap">${fmt(i.kcal)} kcal</span></div>`).join('')}
        <div class="grid2" style="margin-top:10px"><button class="btn soft" data-act="add" data-id="${id}">Adicionar</button>${its.length ? `<button class="btn" data-act="savemeal" data-id="${id}">Salvar refeição</button>` : '<span></span>'}</div></div>`;
    }).join('');
    return summary + meals + `<button class="btn block" data-act="library">Minha biblioteca de alimentos</button>`;
  },

  async treinos() {
    const today = todayISO(), dow = fromISO(today).getDay(), wd = state.wd ?? dow, same = wd === dow;
    const [w, sess] = await Promise.all([DB.get('workouts', String(wd)), DB.get('sessions', today)]);
    const done = new Set(sess ? sess.done : []);
    const chips = [1, 2, 3, 4, 5, 6, 0].map(d => `<button class="chip ${d === dow ? 'today' : ''}" aria-pressed="${d === wd}" data-act="wd" data-id="${d}">${WD[d]}</button>`).join('');
    if (!w || !w.exercises.length) return `<div class="chips">${chips}</div>${empty('Sem treino de ' + WDF[wd], 'Monte a ficha uma vez; ela só muda quando você editar.')}
      <button class="btn f-train block" data-act="edwork">Montar treino de ${WDF[wd]}</button>`;
    return `<div class="chips">${chips}</div>
      <div class="row" style="margin:0 4px 10px"><h3 style="margin:0">Treino de ${WDF[wd]}${w.name ? ' · ' + esc(w.name) : ''}</h3><button class="mini" data-act="edwork">Editar</button></div>
      <div class="card" style="padding:4px 16px">${w.exercises.map(x => {
        const open = state.open.has(x.id);
        return `<div class="ex">${same ? `<button class="chk" data-act="done" data-id="${x.id}" aria-pressed="${done.has(x.id)}" aria-label="Marcar ${esc(x.name)} como feito">${done.has(x.id) ? '✓' : ''}</button>` : ''}
          <div class="exm"><b>${esc(x.name)}</b><span class="muted">${esc(x.sets || '-')} × ${esc(x.reps || '-')}${x.load ? ' · ' + esc(x.load) : ''}</span></div>
          <button class="mini" data-act="tog" data-id="${x.id}">${open ? 'Fechar' : 'Detalhes'}</button></div>
          ${open ? `<div class="exd">${x.hasPhoto ? `<img data-photo="${x.id}" data-act="zoom" data-id="${x.id}" alt="Foto de ${esc(x.name)}">` : ''}
            ${x.notes ? `<p>${esc(x.notes)}</p>` : ''}${x.rest ? `<button class="btn" data-act="rest" data-id="${x.rest}">Descanso de ${esc(x.rest)} s</button>` : ''}</div>` : ''}`;
      }).join('')}</div>`;
  },

  async evolucao() {
    const [weights, meas, daily] = await Promise.all([refreshWeight(), DB.all('measures'), DB.all('daily')]);
    const ym = monthOf(todayISO()), g = goalsFor(ym), ms = meas.slice().sort((a, b) => a.date.localeCompare(b.date));
    const byM = {}; weights.forEach(w => { byM[monthOf(w.date)] = w; });
    const cur = byM[ym], first = weights[0], lastW = weights[weights.length - 1];
    const dm = {}; daily.forEach(d => { if (d.date >= todayISO()) return; const m = monthOf(d.date), o = dm[m] || (dm[m] = { n: 0, k: 0 }); if (d.kcal > 0) { o.n++; o.k += d.kcal; } });
    const months = [...new Set([...Object.keys(byM), ...Object.keys(dm), ym])].sort().reverse();
    const shown = state.moreMonths ? months : months.slice(0, 3);
    const diff = (a, b) => { const d = b - a; return `<b>${d > 0 ? '+' : ''}${fmt(d, 1)} kg</b>`; };
    const pts = Object.keys(byM).sort().map(m => ({ label: cap(monthName(m)).slice(0, 3), kg: byM[m].kg }));
    const ws = weights.slice().reverse(), wshown = state.moreWeights ? ws : ws.slice(0, 5);
    return weightBanner(weights) + `
      <div class="card"><div class="row"><b><span class="dot" style="background:var(--c-body)"></span>Peso de ${monthName(ym)}</b><button class="mini" data-act="weight">${cur ? 'Novo registro' : 'Registrar'}</button></div>
        ${cur ? `<div class="big" style="margin-top:8px">${val(cur.kg)} <small>kg</small></div>
          ${weights.length > 1 ? `<div class="kv"><span class="muted">Desde o primeiro registro</span>${diff(first.kg, lastW.kg)}</div>` : ''}
          ${g.weight ? `<div class="kv"><span class="muted">Para chegar a ${val(g.weight)} kg</span>${diff(lastW.kg, g.weight)}</div>` : ''}`
        : '<div class="empty" style="padding:14px"><b>Ainda sem peso neste mês</b>Registre para acompanhar a evolução.</div>'}${chart(pts, g.weight)}</div>
      <h2>Mês a mês</h2><div class="card" style="padding:4px 16px">${shown.map(m => { const w = byM[m], o = dm[m], gk = goalsFor(m).kcal;
        return `<div class="list-item"><span style="min-width:0"><b>${cap(monthName(m))} ${m.slice(0, 4)}</b><br><span class="muted">${o && o.n ? 'média ' + fmt(o.k / o.n) + ' kcal/dia' : 'sem dias fechados ainda'}${gk ? ' · meta ' + fmt(gk) : ''}</span></span><b>${w ? val(w.kg) + ' kg' : '—'}</b></div>`; }).join('')}
        ${months.length > 3 ? `<button class="mini" data-act="moremonths">${state.moreMonths ? 'Mostrar menos' : 'Ver meses anteriores'}</button>` : ''}</div>
      ${weights.length ? `<h2>Pesagens</h2><div class="card" style="padding:4px 16px">${wshown.map(w => `<div class="list-item"><button class="rowbtn" data-act="wedit" data-id="${w.id}"><b>${val(w.kg)} kg</b><span class="muted">${dateBR(w.date)}</span></button><button class="mini" data-act="wedit" data-id="${w.id}">Editar</button></div>`).join('')}
        ${ws.length > 5 ? `<button class="mini" data-act="morew">${state.moreWeights ? 'Mostrar menos' : 'Ver todas'}</button>` : ''}</div>` : ''}
      <div class="card"><div class="row"><b><span class="dot" style="background:var(--c-train)"></span>Medidas <span class="muted" style="font-weight:400">(opcional)</span></b><button class="mini" data-act="meas">Registrar</button></div>
        ${ms.length ? MEAS.filter(([k]) => ms.some(m => m[k] != null)).map(([k, l]) => {
          const v = ms.filter(m => m[k] != null), a = v[0][k], b = v[v.length - 1][k], d = b - a;
          return `<div class="kv"><span>${l}</span><span><b>${val(b)} cm</b>${v.length > 1 ? ` <span class="muted">(${d > 0 ? '+' : ''}${fmt(d, 1)})</span>` : ''}</span></div>`;
        }).join('') + `<button class="mini" data-act="mlist">Ver histórico</button>` : '<p class="muted" style="margin:8px 0 0">Registre só quando quiser acompanhar.</p>'}</div>`;
  }
};
function chart(pts, goal) {
  if (pts.length < 2) return '';
  const W = 320, H = 150, pl = 16, pr = 16, pt = 20, pb = 24, ks = pts.map(p => p.kg).concat(goal ? [goal] : []);
  const mn = Math.min(...ks) - .6, mx = Math.max(...ks) + .6, X = i => pl + i * (W - pl - pr) / (pts.length - 1), Y = v => pt + (mx - v) / (mx - mn) * (H - pt - pb);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de peso por mês">
    ${goal ? `<line x1="${pl}" x2="${W - pr}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${W - pr}" y="${Y(goal) - 4}" text-anchor="end" style="fill:var(--accent)">meta ${val(goal)}</text>` : ''}
    <polyline points="${pts.map((p, i) => X(i) + ',' + Y(p.kg)).join(' ')}" fill="none" stroke="var(--c-body)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.kg)}" r="4.5" fill="var(--c-body)"/><text x="${X(i)}" y="${Y(p.kg) - 9}" text-anchor="middle">${val(p.kg)}</text><text x="${X(i)}" y="${H - 6}" text-anchor="middle">${p.label}</text>`).join('')}</svg>`;
}

let renderId = 0;
async function render(reset) {
  const id = ++renderId, y = window.scrollY;
  renderHeader(); renderTabbar();
  try {
    const html = await SCREENS[state.tab]();
    if (id !== renderId) return;
    state.urls.forEach(u => URL.revokeObjectURL(u)); state.urls = [];
    $('#view').innerHTML = html; hydrate(); window.scrollTo(0, reset ? 0 : y);
  } catch (e) { if (id === renderId) $('#view').innerHTML = empty('Erro ao carregar', esc(e.message)); }
}
function hydrate() {
  document.querySelectorAll('img[data-photo]').forEach(async im => { const r = await DB.get('photos', im.dataset.photo); if (r) { const u = URL.createObjectURL(r.blob); state.urls.push(u); im.src = u; } });
}

// ---------- janelas ----------
function openSheet(html) { const s = $('#sheet'); s.innerHTML = html; s.hidden = false; $('#sheet-backdrop').hidden = false; s.scrollTop = 0; document.body.classList.add('lock'); }
function closeSheet() { $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true; document.body.classList.remove('lock'); }
const actions = (...b) => `<div class="grid2" style="margin-top:16px">${b.join('')}</div>`;
const B = (act, label, cls = '', id = '') => `<button class="btn ${cls}" data-act="${act}" ${id ? `data-id="${id}"` : ''}>${label}</button>`;
const DEL = (act, label) => `<button class="btn danger block" style="margin-top:10px" data-act="${act}">${label}</button>`;
function ask(title, msg, ok = 'Excluir', danger = true) {
  return new Promise(res => {
    const d = $('#dlg'), b = $('#dlg-back');
    d.innerHTML = `<h3>${title}</h3><p class="sub" style="font-size:15px">${msg}</p><div class="grid2"><button class="btn" id="dlg-no">Cancelar</button><button class="btn ${danger ? 'dangerfill' : 'primary'}" id="dlg-yes">${ok}</button></div>`;
    d.hidden = false; b.hidden = false;
    const done = v => { d.hidden = true; b.hidden = true; res(v); };
    $('#dlg-no').onclick = () => done(false); $('#dlg-yes').onclick = () => done(true); b.onclick = () => done(false);
  });
}

// --- biblioteca e alimentos ---
async function openPicker(meal, tab = 'foods') {
  state.cur = { meal, tab };
  [state.foods, state.saved] = await Promise.all([DB.all('foods'), DB.all('favMeals')]);
  drawPicker();
}
function drawPicker() {
  const { meal, tab } = state.cur, manage = !meal;
  openSheet(`<h3>${manage ? 'Minha biblioteca' : 'Adicionar a ' + mealName(meal).toLowerCase()}</h3>
    ${manage ? '<p class="sub">Toque em Editar para corrigir valores. Os registros antigos não mudam.</p>' : `<div class="seg"><button data-act="ptab" data-id="foods" aria-pressed="${tab === 'foods'}">Alimentos</button><button data-act="ptab" data-id="saved" aria-pressed="${tab === 'saved'}">Refeições salvas</button></div>`}
    ${tab === 'foods' ? `<label class="field"><span>Buscar por nome, marca ou preparo (ex.: frango cru)</span><input id="fsearch" type="search" autocomplete="off" autocapitalize="none"></label><div id="flist">${foodRows('')}</div>` : `<div id="flist" style="margin-top:12px">${savedRows()}</div>`}
    ${tab === 'foods' ? actions(B('close', 'Fechar'), B('newfood', 'Novo alimento', 'primary')) : `<button class="btn block" style="margin-top:16px" data-act="close">Fechar</button>`}`);
}
function foodRow(f) {
  return `<div class="list-item"><button class="rowbtn" data-act="pick" data-id="${f.id}"><b>${esc(foodName(f))}</b><span class="muted">${f.brand ? esc(f.brand) + ' · ' : ''}${fq(f.kcal)} kcal / ${fq(f.refQty)} ${esc(f.unit)}</span></button>
    <button class="star" data-act="fav" data-id="${f.id}" aria-pressed="${!!f.fav}" aria-label="Favorito">${f.fav ? '★' : '☆'}</button><button class="mini" data-act="editfood" data-id="${f.id}">Editar</button></div>`;
}
function foodRows(q = '') {
  if (!state.foods.length) return '<div class="card empty"><b>Biblioteca vazia</b>Cadastre o primeiro alimento com os dados do rótulo. Depois é só informar a quantidade.</div>';
  const toks = norm(q).split(/\s+/).filter(Boolean), by = (a, b) => foodName(a).localeCompare(foodName(b), 'pt-BR');
  const hit = f => { const h = norm(foodName(f) + ' ' + (f.brand || '')); return toks.every(t => h.includes(t)); };
  let html = '';
  if (!toks.length) {
    const rec = state.foods.filter(f => f.lastUsed).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 5), favs = state.foods.filter(f => f.fav && !rec.includes(f)).sort(by);
    if (rec.length) html += `<h2>Recentes</h2><div class="card" style="padding:2px 16px">${rec.map(foodRow).join('')}</div>`;
    if (favs.length) html += `<h2>Favoritos</h2><div class="card" style="padding:2px 16px">${favs.map(foodRow).join('')}</div>`;
    html += '<h2>Todos</h2>';
  }
  const list = state.foods.filter(hit).sort(by);
  return html + (list.length ? `<div class="card" style="padding:2px 16px">${list.map(foodRow).join('')}</div>` : '<div class="card empty">Nada encontrado. Toque em “Novo alimento” para cadastrar.</div>');
}
function savedRows() {
  if (!state.saved.length) return '<div class="card empty"><b>Nenhuma refeição salva</b>Monte uma refeição e toque em “Salvar refeição” para reaproveitar com um toque.</div>';
  return `<div class="card" style="padding:2px 16px">${state.saved.map(m => `<div class="list-item"><button class="rowbtn" data-act="addsaved" data-id="${m.id}"><b>${esc(m.name)}</b><span class="muted">${fmt(sumBy(m.items.map(i => scale(i.f, i.qty)), 'kcal'))} kcal · ${m.items.length} ${m.items.length === 1 ? 'item' : 'itens'}</span></button><button class="mini" data-act="addsaved" data-id="${m.id}">Adicionar</button><button class="mini danger" data-act="delsaved" data-id="${m.id}">Excluir</button></div>`).join('')}</div>`;
}
function foodForm(f = {}) {
  state.cur.food = f;
  openSheet(`<h3>${f.id ? 'Editar alimento' : 'Novo alimento'}</h3><p class="sub">Informe os valores do rótulo para a quantidade de referência.</p>
    ${field('f-name', 'Nome', f.name, 'autocomplete="off"')}${field('f-brand', 'Marca (opcional)', f.brand, 'autocomplete="off"')}
    <div class="grid2"><label class="field"><span>Unidade</span><select id="f-unit">${['g', 'ml', 'un'].map(u => `<option ${f.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>${dec('f-ref', 'Quantidade de referência', f.refQty ?? 100)}</div>
    ${dec('f-kcal', 'Calorias (kcal)', f.kcal)}
    <div class="grid2">${dec('f-prot', 'Proteínas (g)', f.prot)}${dec('f-carb', 'Carboidratos (g)', f.carb)}</div>${dec('f-fat', 'Gorduras (g)', f.fat)}
    ${f.base ? `<p class="src">Valores iniciais: ${esc(f.src || 'TACO')}${f.note ? ' — ' + esc(f.note) : ''}</p>` : ''}
    ${actions(B('foodback', 'Voltar'), B('savefood', 'Salvar', 'primary'))}${f.id ? DEL('delfood', 'Excluir alimento') : ''}`);
}
function qtySheet(f, meal, entry) {
  state.cur = { ...state.cur, meal, f, entry };
  const sel = entry ? `<label class="field"><span>Refeição</span><select id="q-meal">${MEALS.map(([id, n]) => `<option value="${id}" ${id === entry.meal ? 'selected' : ''}>${n}</option>`).join('')}</select></label>` : '';
  openSheet(`<h3>${esc(foodName(f))}</h3><p class="sub">${f.brand ? esc(f.brand) + ' · ' : ''}${fq(f.kcal)} kcal por ${fq(f.refQty)} ${esc(f.unit)}</p>
    ${f.note ? `<p class="src" style="margin-top:4px">${esc(f.note)}</p>` : ''}
    ${dec('q-qty', 'Quantidade (' + esc(f.unit) + ')', entry ? entry.qty : f.refQty)}${sel}
    <div class="card hero" style="margin-top:14px;text-align:center"><div class="big" id="q-kcal"></div><div class="muted" id="q-mac" style="margin-top:6px"></div><div id="q-left" style="margin-top:8px;font-weight:700"></div></div>
    ${f.base && f.src ? `<p class="src">Fonte: ${esc(f.src)}</p>` : ''}
    ${actions(B('close', 'Cancelar'), B('qsave', entry ? 'Salvar' : 'Adicionar', 'primary'))}${entry ? DEL('qdel', 'Remover do dia') : ''}`);
  qtyPreview();
}
async function qtyPreview() {
  const { f, entry } = state.cur, el = $('#q-qty'); if (!f || !el) return;
  const q = num(el.value), s = q > 0 ? scale(f, q) : { kcal: 0, prot: 0, carb: 0, fat: 0 };
  $('#q-kcal').textContent = fmt(s.kcal) + ' kcal'; $('#q-mac').textContent = `P ${fmt(s.prot, 1)} g · C ${fmt(s.carb, 1)} g · G ${fmt(s.fat, 1)} g`;
  if (state.cur.leftNow === undefined) { const i = await dayInfo(state.date); state.cur.leftNow = i.left; }
  const ln = state.cur.leftNow; if (ln == null || !$('#q-left')) return;
  const after = ln + (entry ? entry.kcal : 0) - s.kcal;
  $('#q-left').textContent = after >= 0 ? `Restariam ${fmt(after)} kcal` : `Passaria ${fmt(-after)} kcal da meta`;
  $('#q-left').style.color = after >= 0 ? 'var(--accent)' : 'var(--danger)';
}

// --- cardio ---
function cardioForm(a = {}) {
  state.cur = { a };
  const t = addDays(todayISO(), 1), d = a.date || state.date;
  openSheet(`<h3>${a.id ? 'Editar cardio' : 'Registrar cardio'}</h3>
    <label class="field"><span>Atividade</span><select id="a-type">${CARDIO.map(c => `<option ${a.type === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label class="field"><span>Data</span><input id="a-date" type="date" max="${t}" value="${d}"></label>
    ${dec('a-min', 'Duração (minutos)', a.min)}${dec('a-kcal', 'Calorias do relógio (opcional)', a.kcal)}
    <p class="muted" style="margin-top:10px">Se você informar as calorias, elas valem no lugar da estimativa. Sem elas, o app estima as calorias ativas (referência MET × seu último peso).</p>
    ${actions(B('close', 'Cancelar'), B('csave', 'Salvar', 'primary'))}${a.id ? DEL('cdel', 'Excluir registro') : ''}`);
}
async function cardioWeek() {
  const wk = await weekInfo(state.date), acts = wk.acts.sort((a, b) => b.date.localeCompare(a.date));
  openSheet(`<h3>Cardio da semana</h3><p class="sub">${dateBR(wk.s)} a ${dateBR(wk.e)} · ${fmt(wk.min)} min</p>
    <div class="card" style="margin-top:12px;padding:2px 16px">${acts.length ? acts.map(a => { const k = cardioKcal(a); return `<div class="list-item"><button class="rowbtn" data-act="cedit" data-id="${a.id}"><b>${esc(a.type)} · ${fmt(a.min)} min</b><span class="muted">${dateLabel(a.date)}${k != null ? ` · ${a.kcal == null ? '~' : ''}${fmt(k)} kcal` : ''}</span></button><button class="mini" data-act="cedit" data-id="${a.id}">Editar</button></div>`; }).join('') : '<div class="empty"><b>Nada registrado</b>Use o botão + no Início.</div>'}</div>
    ${actions(B('close', 'Fechar'), B('cadd', 'Registrar', 'f-cardio'))}`);
}

// --- treino ---
function workoutSheet() {
  const w = state.ew;
  openSheet(`<h3>Treino de ${WDF[w.wd]}</h3>${field('w-name', 'Foco do treino (opcional, ex.: Glúteos)', w.name, 'autocomplete="off"')}
    <h2>Exercícios</h2><div class="card" style="padding:2px 16px">${w.exercises.map((x, i) => `<div class="list-item"><button class="rowbtn" data-act="exedit" data-id="${x.id}"><b>${esc(x.name)}</b><span class="muted">${esc(x.sets || '-')} × ${esc(x.reps || '-')}${x.load ? ' · ' + esc(x.load) : ''}</span></button>
      <button class="mini" data-act="exup" data-id="${i}" aria-label="Subir">▲</button><button class="mini" data-act="exdown" data-id="${i}" aria-label="Descer">▼</button></div>`).join('') || '<p class="muted" style="margin:12px 0">Nenhum exercício ainda.</p>'}</div>
    ${actions(B('exnew', 'Novo exercício', 'f-train'), B('wend', 'Concluir', 'primary'))}${w.exercises.length || w.name ? DEL('wclear', 'Limpar treino deste dia') : ''}`);
}
async function persistEW() { const n = $('#w-name'); if (n) state.ew.name = n.value.trim().slice(0, 40); await DB.put('workouts', state.ew); scheduleSync(); }
function exForm(x) {
  state.cur = { x, photo: undefined };
  openSheet(`<h3>${x.id ? 'Editar exercício' : 'Novo exercício'}</h3>${field('x-name', 'Nome', x.name, 'autocomplete="off"')}
    <div class="grid2">${field('x-sets', 'Séries', x.sets, 'inputmode="numeric"')}${field('x-reps', 'Repetições', x.reps, 'autocomplete="off"')}</div>
    <div class="grid2">${field('x-load', 'Carga (ex.: 35 kg)', x.load, 'autocomplete="off"')}${field('x-rest', 'Descanso (segundos)', x.rest, 'inputmode="numeric"')}</div>
    <label class="field"><span>Observações</span><textarea id="x-notes">${esc(x.notes || '')}</textarea></label>
    <label class="field"><span>Foto de apoio (opcional)${x.hasPhoto ? ' — já tem uma; escolha outra para trocar' : ''}</span><input id="x-photo" type="file" accept="image/*"></label>
    ${x.hasPhoto ? `<button class="mini" data-act="rmphoto">Remover foto</button>` : ''}
    ${actions(B('exback', 'Voltar'), B('exsave', 'Salvar', 'primary'))}${x.id ? DEL('exdel', 'Excluir exercício') : ''}`);
}
function compress(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { const s = Math.min(1, 900 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob(b => b ? res(b) : rej(new Error('Falha ao comprimir')), 'image/jpeg', .75); };
    im.onerror = () => rej(new Error('Imagem não suportada')); im.src = url;
  });
}
// descanso: usa o horário de término real, então continua certo ao voltar para o app
let timerEnd = null, timerInt;
function startTimer(sec) { timerEnd = Date.now() + sec * 1000; clearInterval(timerInt); timerInt = setInterval(tick, 500); tick(); }
function tick() {
  let bar = $('#timerbar'); if (timerEnd == null) { if (bar) bar.remove(); clearInterval(timerInt); return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'timerbar'; bar.className = 'timerbar'; document.body.appendChild(bar); }
  const s = Math.ceil((timerEnd - Date.now()) / 1000);
  if (s <= -4) { timerEnd = null; return tick(); }
  bar.innerHTML = `<span>${s > 0 ? 'Descanso ' + Math.floor(s / 60) + ':' + pad(s % 60) : 'Descanso concluído'}</span><span><button data-act="t15">+15 s</button><button data-act="tstop">Pular</button></span>`;
  if (s <= 0 && navigator.vibrate) navigator.vibrate(200);
}

// --- peso e medidas ---
function weightForm(w = {}, note = '') {
  state.cur = { w };
  openSheet(`<h3>${w.id ? 'Editar peso' : 'Registrar peso'}</h3>${note ? `<p class="sub">${note}</p>` : ''}
    <label class="field"><span>Data</span><input id="p-date" type="date" max="${todayISO()}" value="${w.date || todayISO()}"></label>${dec('p-kg', 'Peso (kg)', w.kg)}
    ${actions(B('close', note ? 'Agora não' : 'Cancelar'), B('wsave', 'Salvar', 'primary'))}${w.id ? DEL('wdel', 'Excluir pesagem') : ''}`);
}
function measForm(m = {}) {
  state.cur = { m };
  openSheet(`<h3>${m.id ? 'Editar medidas' : 'Registrar medidas'}</h3><p class="sub">Preencha só o que medir hoje.</p>
    <label class="field"><span>Data</span><input id="m-date" type="date" max="${todayISO()}" value="${m.date || todayISO()}"></label>
    <div class="grid2">${MEAS.map(([k, l]) => dec('m-' + k, l + ' (cm)', m[k])).join('')}</div>
    ${actions(B('close', 'Cancelar'), B('msave', 'Salvar', 'primary'))}${m.id ? DEL('mdel', 'Excluir medição') : ''}`);
}
async function maybeAskWeight() {
  const ym = monthOf(todayISO()), ws = await DB.all('weights');
  if (!ws.length || ws.some(w => w.date.startsWith(ym)) || state.settings.askedWeight === ym || !$('#sheet').hidden) return;
  state.settings.askedWeight = ym; await DB.setSetting('askedWeight', ym);
  weightForm({}, `Começou ${monthName(ym)}! Qual é o seu peso hoje? Assim você acompanha a evolução deste mês.`);
}

// --- configurações ---
function openSettings() {
  const s = state.settings, ym = monthOf(todayISO()), g = goalsFor(ym);
  openSheet(`<h3>Configurações</h3>${field('c-name', 'Seu nome ou apelido (opcional)', s.name, 'autocomplete="off"')}
    <label class="field"><span>Tema</span><select id="c-theme">${[['auto', 'Automático (segue o iPhone)'], ['light', 'Claro'], ['dark', 'Escuro']].map(([k, l]) => `<option value="${k}" ${s.theme === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <h2>Metas de ${monthName(ym)}</h2>${dec('c-kcal', 'Calorias por dia (kcal)', g.kcal)}<div class="grid2">${dec('c-card', 'Cardio por semana (min)', g.cardioMin)}${dec('c-peso', 'Peso desejado (kg)', g.weight)}</div>
    <label class="field"><span>Essa mudança vale para</span><select id="c-scope"><option value="forward">Este mês e os próximos</option><option value="only">Só este mês</option></select></label>
    <p class="muted" style="margin-top:8px">Meses anteriores nunca são alterados.</p>
    <label class="switch"><span>Somar calorias do cardio às calorias do dia<small>Desligado: a meta não muda com o cardio.</small></span><input id="c-add" type="checkbox" ${s.addCardio ? 'checked' : ''}></label>
    <h2>Salvar em planilha do Google</h2>
    <p class="muted" style="margin:0 0 4px">Grátis. Guarda treinos, peso, medidas, biblioteca de alimentos e o total de cada dia numa planilha sua. Veja o passo a passo no arquivo LEIA-ME.</p>
    ${field('c-url', 'Endereço do script (termina em /exec)', s.syncUrl, 'type="url" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"')}
    ${field('c-token', 'Senha do script', s.syncToken, 'autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"')}
    <div class="grid2" style="margin-top:12px">${B('gsave', 'Salvar agora')}${B('grest', 'Restaurar')}</div>
    <p class="muted" style="margin-top:8px">${s.lastSync ? 'Último envio: ' + new Date(s.lastSync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Ainda não enviado.'} O app envia sozinho a cada dia novo quando abrir.</p>
    <h2>Backup no aparelho</h2><div class="grid2">${B('export', 'Exportar tudo')}${B('import', 'Importar')}</div>
    <p class="muted" style="margin-top:8px">O backup inclui as fotos. Os dados ficam só neste aparelho: apagar o app ou trocar de iPhone apaga tudo, então exporte de vez em quando.</p>
    <p class="muted">Importar também aceita uma lista de alimentos no mesmo formato da base inicial (.json).</p>
    ${actions(B('close', 'Fechar'), B('savecfg', 'Salvar', 'primary'))}${DEL('reset', 'Apagar todos os dados')}
    <p class="src" style="text-align:center;margin-top:14px">Meu Corpo v${APP_VERSION} · alimentos: TACO (NEPA/UNICAMP, 4ª ed.). Calorias de cardio são estimativas.</p>`);
}
async function saveSettings() {
  const ym = monthOf(todayISO()), st = state.settings;
  const next = { name: $('#c-name').value.trim().slice(0, 40), theme: $('#c-theme').value, addCardio: $('#c-add').checked, syncUrl: $('#c-url').value.trim(), syncToken: $('#c-token').value.trim() };
  if (next.syncUrl && !/^https:\/\/script\.google(usercontent)?\.com\//.test(next.syncUrl)) return toast('O endereço deve começar com https://script.google.com/');
  await saveGoals(ym, { kcal: num($('#c-kcal').value), cardioMin: num($('#c-card').value), weight: num($('#c-peso').value) }, $('#c-scope').value);
  Object.assign(st, next); for (const [k, v] of Object.entries(next)) await DB.setSetting(k, v);
  await updateDaily(todayISO()); applyTheme(); closeSheet(); render(); toast('Salvo'); scheduleSync();
}

// ---------- backup e planilha do Google ----------
const toDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
function fromDataURL(u) { const [h, b] = u.split(','), mime = /:(.*?);/.exec(h)[1], bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: mime }); }
async function snapshot(full) {
  const names = full ? ['foods', 'diary', 'activities', 'workouts', 'sessions', 'weights', 'measures', 'daily', 'favMeals'] : ['foods', 'favMeals', 'activities', 'workouts', 'weights', 'measures', 'daily', 'diary', 'sessions'];
  const data = {}; for (const s of names) data[s] = await DB.all(s);
  if (full) data.photos = await Promise.all((await DB.all('photos')).map(async p => ({ id: p.id, data: await toDataURL(p.blob) })));
  data.settings = { name: state.settings.name, theme: state.settings.theme, addCardio: state.settings.addCardio, goals: state.goals };
  return { app: 'meucorpo', schema: 1, exportedAt: new Date().toISOString(), full, data };
}
async function restore(b) {
  if (!b || b.app !== 'meucorpo' || !b.data) throw new Error('Arquivo de backup inválido');
  if (b.schema !== 1) throw new Error('Versão de backup não suportada');
  const data = {};
  for (const [k, v] of Object.entries(b.data)) {
    if (k === 'settings' || k === 'photos' || !DB.STORES[k]) continue;
    if (!Array.isArray(v)) throw new Error('Backup corrompido em ' + k);
    const key = DB.STORES[k].key; if (v.some(r => !r || r[key] == null)) throw new Error('Backup corrompido em ' + k);
    data[k] = v;
  }
  if (Array.isArray(b.data.photos)) data.photos = b.data.photos.map(p => ({ id: p.id, blob: fromDataURL(p.data) }));
  await DB.replaceAll(data);   // tudo ou nada: se falhar, os dados atuais ficam como estavam
  const st = b.data.settings;
  if (st) { state.goals = st.goals || {}; Object.assign(state.settings, { name: st.name || '', theme: st.theme || 'auto', addCardio: !!st.addCardio }); for (const k of ['name', 'theme', 'addCardio']) await DB.setSetting(k, state.settings[k]); await DB.setSetting('goals', state.goals); }
  // exercícios cuja foto não veio no backup não devem apontar para foto inexistente
  const ids = new Set((await DB.all('photos')).map(p => p.id));
  for (const w of await DB.all('workouts')) { let ch = false; w.exercises.forEach(x => { if (x.hasPhoto && !ids.has(x.id)) { x.hasPhoto = false; ch = true; } }); if (ch) await DB.put('workouts', w); }
  await ensureMonth(); await seedFoods(); await refreshWeight(); applyTheme();
}
function mapTaco(a) {
  let prep = a.preparo; if (/\bsecos?\b/i.test(a.detalhe_referencia || '')) prep = 'seco';
  return { id: a.id, name: a.nome, prep: ['cozido', 'cru', 'seco', 'assado', 'grelhado', 'frito'].includes(prep) ? prep : '', brand: '', unit: 'g', refQty: a.porcao_referencia_g || 100,
    kcal: a.calorias_kcal, prot: a.proteinas_g, carb: a.carboidratos_g, fat: a.gorduras_g, cat: a.categoria, note: a.detalhe_referencia, src: a.fonte, base: true };
}
async function seedFoods() {
  if (await DB.getSetting('baseSeed') === BASE_FOODS.versao) return;
  const have = new Set((await DB.all('foods')).map(f => f.id));
  for (const a of BASE_FOODS.alimentos) if (!have.has(a.id)) await DB.put('foods', mapTaco(a));
  await DB.setSetting('baseSeed', BASE_FOODS.versao);
}
async function importFoods(b) {
  const ok = b.alimentos.filter(a => a && a.nome && Number.isFinite(a.calorias_kcal) && a.porcao_referencia_g > 0 && a.id);
  if (!ok.length) throw new Error('Nenhum alimento válido no arquivo');
  const have = new Set((await DB.all('foods')).map(f => f.id)); let n = 0;
  for (const a of ok) if (!have.has(a.id)) { await DB.put('foods', mapTaco(a)); n++; }
  return n;
}
const GRP = 40000;
async function sheetCall(body) {
  const { syncUrl, syncToken } = state.settings; if (!syncUrl) throw new Error('Cole o endereço do script em Configurações');
  let r; try { r = await fetch(syncUrl, { method: 'POST', body: JSON.stringify({ token: syncToken, ...body }) }); } catch (_) { throw new Error('Sem conexão com a planilha'); }
  let j; try { j = await r.json(); } catch (_) { throw new Error('A planilha não respondeu (confira o endereço e a implantação)'); }
  if (!j.ok) throw new Error(j.error || 'Erro na planilha'); return j;
}
let syncing = false;
async function syncPush() {
  if (syncing) return; syncing = true;
  try {
    await sheetCall({ action: 'save', data: await snapshot(false) });
    state.settings.lastSync = new Date().toISOString(); await DB.setSetting('lastSync', state.settings.lastSync);
  } finally { syncing = false; }
}
async function syncPull() { const j = await sheetCall({ action: 'load' }); if (!j.data) throw new Error('Nenhum backup encontrado na planilha'); await restore(j.data); }
let syncT;
{ const SYNC_STORES = ['diary', 'activities', 'daily', 'weights', 'sessions'], rawPut = DB.put, rawDel = DB.del;   // qualquer registro dispara o envio (com atraso de 5 s)
  DB.put = (s, v) => rawPut(s, v).then(r => { if (SYNC_STORES.includes(s)) scheduleSync(); return r; });
  DB.del = (s, k) => rawDel(s, k).then(r => { if (SYNC_STORES.includes(s)) scheduleSync(); return r; }); }
function scheduleSync() { if (!state.settings.syncUrl) return; clearTimeout(syncT); syncT = setTimeout(() => syncPush().catch(() => {}), 5000); }
function syncIfDue() {
  const ls = state.settings.lastSync;
  if (state.settings.syncUrl && navigator.onLine && (!ls || toISO(new Date(ls)) !== todayISO())) syncPush().catch(() => {});
}
async function busy(fn, ok) { try { toast('Aguarde...'); await fn(); toast(ok); render(); } catch (e) { toast(errMsg(e)); } }

// ---------- ações ----------
const ACT = {
  close: closeSheet, config: openSettings, savecfg: saveSettings,
  gotreino() { state.wd = null; go('treinos'); },
  today() { setDate(todayISO()); },
  // alimentos
  add: el => openPicker(el.dataset.id),
  library: () => openPicker(null),
  ptab(el) { state.cur.tab = el.dataset.id; drawPicker(); },
  pick(el) { const f = state.foods.find(x => x.id === el.dataset.id); if (!state.cur.meal) return foodForm(f); state.cur.leftNow = undefined; qtySheet(f, state.cur.meal); },
  newfood() { state.cur = { meal: state.cur.meal, tab: 'foods' }; foodForm({ unit: 'g', refQty: 100 }); },
  editfood(el) { foodForm(state.foods.find(f => f.id === el.dataset.id)); },
  foodback() { openPicker(state.cur.meal); },
  async fav(el) { const f = state.foods.find(x => x.id === el.dataset.id); f.fav = !f.fav; await DB.put('foods', f); const q = $('#fsearch'); $('#flist').innerHTML = foodRows(q ? q.value : ''); },
  async savefood() {
    const f = state.cur.food, name = $('#f-name').value.trim(), ref = num($('#f-ref').value), kcal = num($('#f-kcal').value);
    if (!name || !(ref > 0) || kcal == null) return toast('Preencha nome, referência e calorias');
    const nf = { ...f, id: f.id || DB.uid(), name: name.slice(0, 60), brand: $('#f-brand').value.trim().slice(0, 40), unit: $('#f-unit').value, refQty: ref, kcal, prot: num($('#f-prot').value) || 0, carb: num($('#f-carb').value) || 0, fat: num($('#f-fat').value) || 0 };
    await DB.put('foods', nf); scheduleSync(); const meal = state.cur.meal;
    if (!f.id && meal) { state.foods = await DB.all('foods'); state.cur.leftNow = undefined; qtySheet(nf, meal); } else { await openPicker(meal); toast('Alimento salvo'); }
  },
  async delfood() { if (!await ask('Excluir alimento?', 'Ele sai da biblioteca. O que você já registrou continua igual.')) return; await DB.del('foods', state.cur.food.id); scheduleSync(); openPicker(state.cur.meal); },
  async qsave() {
    const { f, meal, entry } = state.cur, q = num($('#q-qty').value); if (!(q > 0)) return toast('Informe a quantidade');
    const m = entry ? $('#q-meal').value : meal, s = scale(f, q);
    const e = { ...(entry || {}), id: entry?.id || DB.uid(), date: entry?.date || state.date, meal: m, fid: f.id || entry?.fid, f: { name: f.name, prep: f.prep || '', brand: f.brand || '', unit: f.unit, refQty: f.refQty, kcal: f.kcal, prot: f.prot, carb: f.carb, fat: f.fat }, qty: q, ...s };
    await DB.put('diary', e); await updateDaily(e.date);
    if (e.fid) { const lib = await DB.get('foods', e.fid); if (lib) { lib.lastUsed = Date.now(); await DB.put('foods', lib); } }
    closeSheet(); render(); toast(entry ? 'Atualizado' : 'Adicionado');
  },
  async entry(el) { const e = await DB.get('diary', el.dataset.id); state.cur = { leftNow: undefined }; qtySheet(e.f, e.meal, e); },
  async qdel() { const e = state.cur.entry; await DB.del('diary', e.id); await updateDaily(e.date); closeSheet(); render(); toast('Removido'); },
  savemeal(el) { state.cur = { mealId: el.dataset.id }; openSheet(`<h3>Salvar refeição</h3><p class="sub">Guarde ${esc(mealName(el.dataset.id).toLowerCase())} de hoje para repetir com um toque.</p>${field('s-name', 'Nome (ex.: Minha marmita)', '', 'autocomplete="off"')}${actions(B('close', 'Cancelar'), B('savemeal2', 'Salvar', 'primary'))}`); },
  async savemeal2() {
    const name = $('#s-name').value.trim(); if (!name) return toast('Dê um nome à refeição');
    const items = (await DB.where('diary', 'date', state.date)).filter(i => i.meal === state.cur.mealId).map(i => ({ f: i.f, qty: i.qty }));
    await DB.put('favMeals', { id: DB.uid(), name: name.slice(0, 40), items }); closeSheet(); toast('Refeição salva'); scheduleSync();
  },
  async addsaved(el) {
    const m = state.saved.find(x => x.id === el.dataset.id), meal = state.cur.meal;
    for (const i of m.items) await DB.put('diary', { id: DB.uid(), date: state.date, meal, f: i.f, qty: i.qty, ...scale(i.f, i.qty) });
    await updateDaily(state.date); closeSheet(); render(); toast('Refeição adicionada');
  },
  async delsaved(el) { if (!await ask('Excluir refeição salva?', 'Os registros já feitos não mudam.')) return; await DB.del('favMeals', el.dataset.id); state.saved = await DB.all('favMeals'); $('#flist').innerHTML = savedRows(); scheduleSync(); },
  editday: async () => { const d = await DB.get('daily', state.date); state.cur = { d }; openSheet(`<h3>Corrigir ${dateLabel(state.date).toLowerCase()}</h3><p class="sub">${dateBR(state.date)}</p>${dec('d-kcal', 'Calorias consumidas (kcal)', d ? Math.round(d.kcal) : '')}${actions(B('close', 'Cancelar'), B('dsave', 'Salvar', 'primary'))}`); },
  async dsave() { const k = num($('#d-kcal').value); if (k == null || k < 0) return toast('Informe as calorias'); const d = state.cur.d || { date: state.date, prot: 0, carb: 0, fat: 0, cardioMin: 0, goal: goalsFor(monthOf(state.date)).kcal ?? null }; await DB.put('daily', { ...d, kcal: k }); closeSheet(); render(); toast('Salvo'); scheduleSync(); },
  // cardio
  cadd: () => cardioForm(),
  cweek: cardioWeek,
  async cedit(el) { cardioForm(await DB.get('activities', el.dataset.id)); },
  async csave() {
    const m = num($('#a-min').value), d = $('#a-date').value; if (!(m > 0) || !d) return toast('Informe data e duração');
    const old = state.cur.a || {}, a = { ...old, id: old.id || DB.uid(), date: d, type: $('#a-type').value, min: m, kcal: num($('#a-kcal').value) };
    await DB.put('activities', a); await updateDaily(d); if (old.date && old.date !== d) await updateDaily(old.date); closeSheet(); render(); toast('Cardio salvo'); scheduleSync();
  },
  async cdel() { if (!await ask('Excluir este cardio?', 'O registro será removido da semana.')) return; const a = state.cur.a; await DB.del('activities', a.id); await updateDaily(a.date); closeSheet(); render(); scheduleSync(); },
  // treinos
  wd(el) { state.wd = +el.dataset.id; render(); },
  tog(el) { const id = el.dataset.id; state.open.has(id) ? state.open.delete(id) : state.open.add(id); render(); },
  async done(el) { const t = todayISO(), s = (await DB.get('sessions', t)) || { id: t, date: t, done: [] }, id = el.dataset.id; s.done = s.done.includes(id) ? s.done.filter(x => x !== id) : [...s.done, id]; await DB.put('sessions', s); render(); },
  async zoom(el) { const r = await DB.get('photos', el.dataset.id); if (r) { const u = URL.createObjectURL(r.blob); state.urls.push(u); openSheet(`<img class="zoom" src="${u}" alt="">${actions(B('close', 'Fechar', 'primary'))}`); } },
  rest: el => startTimer(+el.dataset.id), t15() { timerEnd += 15000; tick(); }, tstop() { timerEnd = null; tick(); },
  async edwork() { const wd = state.wd ?? fromISO(todayISO()).getDay(); state.ew = (await DB.get('workouts', String(wd))) || { id: String(wd), wd, name: '', exercises: [] }; state.ew.wd = wd; workoutSheet(); },
  async exnew() { await persistEW(); exForm({}); },
  async exedit(el) { await persistEW(); exForm(state.ew.exercises.find(x => x.id === el.dataset.id)); },
  exback: workoutSheet,
  async exup(el) { const i = +el.dataset.id, a = state.ew.exercises; if (i > 0) [a[i - 1], a[i]] = [a[i], a[i - 1]]; await persistEW(); workoutSheet(); },
  async exdown(el) { const i = +el.dataset.id, a = state.ew.exercises; if (i < a.length - 1) [a[i + 1], a[i]] = [a[i], a[i + 1]]; await persistEW(); workoutSheet(); },
  rmphoto() { state.cur.photo = null; $('#x-photo').value = ''; toast('A foto será removida ao salvar'); },
  async exsave() {
    const x = state.cur.x, name = $('#x-name').value.trim(); if (!name) return toast('Informe o nome do exercício');
    const nx = { ...x, id: x.id || DB.uid(), name: name.slice(0, 60), sets: $('#x-sets').value.trim(), reps: $('#x-reps').value.trim(), load: $('#x-load').value.trim(), rest: num($('#x-rest').value) || '', notes: $('#x-notes').value.trim().slice(0, 400) };
    const file = $('#x-photo').files[0];
    if (file) { await DB.put('photos', { id: nx.id, blob: await compress(file) }); nx.hasPhoto = true; }
    else if (state.cur.photo === null) { await DB.del('photos', nx.id); nx.hasPhoto = false; }
    const a = state.ew.exercises, i = a.findIndex(e => e.id === nx.id); i >= 0 ? a[i] = nx : a.push(nx);
    await persistEW(); workoutSheet(); render();
  },
  async exdel() { if (!await ask('Excluir exercício?', 'Ele sai da ficha deste dia.')) return; const id = state.cur.x.id; state.ew.exercises = state.ew.exercises.filter(e => e.id !== id); await DB.del('photos', id); await persistEW(); workoutSheet(); render(); },
  async wend() { await persistEW(); closeSheet(); render(); },
  async wclear() { if (!await ask('Limpar treino?', 'Todos os exercícios deste dia da semana serão removidos.', 'Limpar')) return; for (const x of state.ew.exercises) await DB.del('photos', x.id); await DB.del('workouts', state.ew.id); scheduleSync(); closeSheet(); render(); },
  // peso e medidas
  weight: () => weightForm(),
  async wedit(el) { weightForm(await DB.get('weights', el.dataset.id)); },
  async wsave() {
    const kg = num($('#p-kg').value), d = $('#p-date').value; if (!(kg >= 20 && kg <= 400) || !d) return toast('Informe data e peso válidos');
    await DB.put('weights', { ...(state.cur.w || {}), id: state.cur.w?.id || DB.uid(), date: d, kg }); await refreshWeight(); closeSheet(); render(); toast('Peso salvo'); scheduleSync();
  },
  async wdel() { if (!await ask('Excluir pesagem?', 'Esse registro de peso será removido.')) return; await DB.del('weights', state.cur.w.id); await refreshWeight(); closeSheet(); render(); toast('Pesagem excluída'); scheduleSync(); },
  moremonths() { state.moreMonths = !state.moreMonths; render(); }, morew() { state.moreWeights = !state.moreWeights; render(); },
  meas: () => measForm(),
  async msave() {
    const old = state.cur.m || {}, r = { id: old.id || DB.uid(), date: $('#m-date').value }; let any = false;
    MEAS.forEach(([k]) => { const v = num($('#m-' + k).value); if (v != null) { r[k] = v; any = true; } });
    if (!any || !r.date) return toast('Preencha data e ao menos uma medida');
    await DB.put('measures', r); closeSheet(); render(); toast('Medidas salvas'); scheduleSync();
  },
  async mlist() { const ms = (await DB.all('measures')).sort((a, b) => b.date.localeCompare(a.date)); openSheet(`<h3>Histórico de medidas</h3>${ms.map(m => `<div class="card" style="margin-top:12px"><div class="row"><b>${dateBR(m.date)}</b><button class="mini" data-act="medit" data-id="${m.id}">Editar</button></div>${MEAS.filter(([k]) => m[k] != null).map(([k, l]) => `<div class="kv"><span class="muted">${l}</span><span>${val(m[k])} cm</span></div>`).join('')}</div>`).join('')}${actions(B('close', 'Fechar', 'primary'))}`); },
  async medit(el) { measForm(await DB.get('measures', el.dataset.id)); },
  async mdel() { if (!await ask('Excluir medição?', 'Esse conjunto de medidas será removido.')) return; await DB.del('measures', state.cur.m.id); closeSheet(); render(); scheduleSync(); },
  // backup e planilha
  async export() {
    const json = JSON.stringify(await snapshot(true)), blob = new Blob([json], { type: 'application/json' }), name = `meu-corpo-backup-${todayISO()}.json`;
    if (!await ask('Gerar backup?', `O arquivo terá ${blob.size > 1048576 ? fmt(blob.size / 1048576, 1) + ' MB' : fmt(blob.size / 1024) + ' KB'} e inclui as fotos.`, 'Gerar', false)) return;
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Backup gerado');
  },
  import() { $('#file-in').click(); },
  async reset() { if (!await ask('Apagar tudo?', 'Todos os dados deste aparelho serão apagados e isso não pode ser desfeito. Exporte um backup antes, se quiser.', 'Apagar tudo')) return; for (const s of Object.keys(DB.STORES)) await DB.clear(s); state.goals = {}; state.settings = { name: '', theme: 'auto', addCardio: false, syncUrl: '', syncToken: '', lastSync: '', askedWeight: '' }; state.lastKg = null; await seedFoods(); await ensureMonth(); applyTheme(); closeSheet(); render(); toast('Dados apagados'); },
  gsave: () => busy(syncPush, 'Salvo na planilha'),
  async grest() { if (await ask('Restaurar da planilha?', 'Isso substitui treinos, peso, medidas, cardio e biblioteca deste aparelho pelos da planilha.', 'Restaurar', false)) busy(syncPull, 'Restaurado da planilha'); }
};

// ---------- eventos ----------
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]'); if (t) return go(t.dataset.tab);
  const a = e.target.closest('[data-act]'); if (!a || !ACT[a.dataset.act]) return;
  Promise.resolve().then(() => ACT[a.dataset.act](a)).catch(err => { console.error(err); toast(errMsg(err)); });
});
document.addEventListener('input', e => { if (e.target.id === 'q-qty') qtyPreview(); if (e.target.id === 'fsearch') $('#flist').innerHTML = foodRows(e.target.value); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
$('#btn-config').onclick = openSettings; $('#sheet-backdrop').onclick = closeSheet;
const setDate = d => { const max = addDays(todayISO(), 1); state.date = d > max ? max : d; state.wd = null; render(true); };
$('#dia-ant').onclick = () => setDate(addDays(state.date, -1)); $('#dia-prox').onclick = () => setDate(addDays(state.date, 1));
$('#dia-input').onchange = e => { if (e.target.value) setDate(e.target.value); };
const fi = document.createElement('input'); fi.type = 'file'; fi.accept = '.json,application/json'; fi.id = 'file-in'; fi.hidden = true; document.body.appendChild(fi);
fi.onchange = async () => {
  const f = fi.files[0]; fi.value = ''; if (!f) return;
  try {
    const b = JSON.parse(await f.text());
    if (Array.isArray(b.alimentos)) { const n = await importFoods(b); toast(n + ' alimentos novos importados'); return; }
    if (!await ask('Importar backup?', 'Isso substitui os registros atuais pelos do arquivo. Se algo falhar, seus dados atuais ficam como estão.', 'Importar', false)) return;
    await restore(b); closeSheet(); render(); toast('Backup importado');
  } catch (e) { toast(e instanceof SyntaxError ? 'Arquivo inválido' : errMsg(e)); }
};

// Virou o dia (inclusive com o app aberto à meia-noite): fecha o dia anterior e abre o novo mês se for o caso.
async function checkDay() {
  const t = todayISO(); if (t === state.today) return;
  state.today = t; state.date = t; state.wd = null; state.open.clear();
  await rollover(); await ensureMonth(); await render(true); syncIfDue(); maybeAskWeight();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDay(); tick(); } });
setInterval(checkDay, 30000);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

(async function init() {
  try {
    await DB.open();
    (await DB.all('settings')).forEach(r => { if (r.key === 'goals') state.goals = r.value || {}; else state.settings[r.key] = r.value; });
    applyTheme(); state.today = todayISO(); state.date = state.today;
    await seedFoods(); await rollover(); await ensureMonth(); await refreshWeight();
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    const h = location.hash.slice(1); if (SCREENS[h]) state.tab = h;
    document.body.dataset.area = state.tab;
    await render(true); syncIfDue(); maybeAskWeight();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch (e) { $('#view').innerHTML = empty('Armazenamento indisponível', esc(e.message) + '<br>Abra pelo Safari normal (não em aba privada).'); }
})();
