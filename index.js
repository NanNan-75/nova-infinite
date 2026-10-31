// Nova 無限流面板 v0.1.0
// SillyTavern 第三方擴充：管理無限流副本狀態、依模式注入規則與資料、隱藏封存資訊。

import { DEFAULT_RULES, OPEN_TAG_SPEC, TURN_TAG_SPEC } from './rules.js';

const MODULE = 'nova_infinite';
const KEY_RULES = 'nova_inf_rules';
const KEY_STATE = 'nova_inf_state';
const SNAPSHOT_LIMIT = 40;

const MODES = {
    off: '關閉',
    lobby: '白域大廳',
    opening: '副本開局',
    instance: '副本進行中',
    settle: '結算',
};

const SEALED_CAST_KEYS = ['real_name', 'affinity', 'history_length', 'relation_type', 'promise', 'obsession_stage'];
const SEALED_PEOPLE_KEYS = ['hidden_truth'];
const SEALED_FACTION_KEYS = ['true_goal'];

let peek = false;          // 本次開啟期間是否解鎖封存（不存檔）
let currentTab = 'overview';
let updateMessageBlockFn = null;

// ───────────────────────── 基礎工具 ─────────────────────────

function ctx() {
    return SillyTavern.getContext();
}

function clone(o) {
    return o === undefined ? undefined : JSON.parse(JSON.stringify(o));
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function toast(msg, type = 'info') {
    try {
        if (window.toastr && window.toastr[type]) window.toastr[type](msg, 'Nova 無限流');
    } catch (e) { /* 忽略 */ }
}

function sub(text) {
    const c = ctx();
    try {
        if (typeof c.substituteParams === 'function') return c.substituteParams(text);
    } catch (e) { /* 忽略 */ }
    return text;
}

// ───────────────────────── 全域設定（跨聊天） ─────────────────────────

function defaultSettings() {
    return {
        enabled: true,
        rulesDepthMode: 'prompt',   // prompt：放在主提示詞；chat：放在聊天中
        rulesDepth: 4,
        stateDepth: 1,
        rules: clone(DEFAULT_RULES),
        ledger: [],
        worldlines: [],
        inventory: { shards: 0, items: [] },
        rewards: [],
        glossary_global: [],
    };
}

function S() {
    const c = ctx();
    if (!c.extensionSettings[MODULE]) c.extensionSettings[MODULE] = defaultSettings();
    const s = c.extensionSettings[MODULE];
    const d = defaultSettings();
    for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
    if (!s.inventory.items) s.inventory.items = [];
    // 新版本新增的預設規則補進來，但不覆蓋你改過的
    for (const r of DEFAULT_RULES) {
        if (!s.rules.find(x => x.id === r.id)) s.rules.push(clone(r));
    }
    return s;
}

function saveSettings() {
    ctx().saveSettingsDebounced();
}

// ───────────────────────── 聊天狀態（綁定此聊天的副本） ─────────────────────────

function C() {
    const md = ctx().chatMetadata;
    if (!md) return null;
    if (!md[MODULE]) {
        md[MODULE] = { mode: 'off', seed: {}, instance: null, lock: false, snapshots: {} };
    }
    const cs = md[MODULE];
    if (!cs.snapshots) cs.snapshots = {};
    if (!cs.seed) cs.seed = {};
    return cs;
}

async function saveChatState() {
    try { await ctx().saveMetadata(); } catch (e) { console.warn('[Nova無限流] saveMetadata 失敗', e); }
}

function blankInstance() {
    return {
        id: 'inst_' + Date.now(),
        name: '', worldline: '', line_type: '主線', difficulty: '',
        axes: { type: '', world: '', mechanic: '' }, mechanic_revealed: false,
        time_limit_days: 0, total_acts: 1, current_act: 1, act_progress: 0,
        ending_range: '', status: '進行中', turn: 0,
        sealed: { total_truth: '', mastermind: '', motive: '' },
        acts: [], clues: [], cast: [], people: [], factions: [],
        identity_card: { name: '', age: '', social_role: '', family: '', restrictions: '', range: '', friction: '', snapshot: {} },
        calendar: { calendar_name: '', date_label: '', time_label: '', day: 1, events: [] },
        glossary: [], concessions: [],
        ended: false,
    };
}

// ───────────────────────── 快照與回溯 ─────────────────────────

function lastAiIndex() {
    const chat = ctx().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) if (!chat[i].is_user && !chat[i].is_system) return i;
    return -1;
}

function snapKey(i) {
    const m = (ctx().chat || [])[i];
    return `${i}:${m?.swipe_id ?? 0}`;
}

function takeSnapshot() {
    const cs = C();
    if (!cs) return;
    const i = lastAiIndex();
    if (i < 0) return;
    cs.snapshots[snapKey(i)] = {
        mode: cs.mode,
        instance: clone(cs.instance),
        inventory: clone(S().inventory),
    };
    const keys = Object.keys(cs.snapshots).sort((a, b) => parseInt(a) - parseInt(b));
    while (keys.length > SNAPSHOT_LIMIT) delete cs.snapshots[keys.shift()];
}

function applySnapshot(snap) {
    const cs = C();
    cs.mode = snap.mode;
    cs.instance = clone(snap.instance);
    if (snap.inventory) S().inventory = clone(snap.inventory);
}

// 回到第 n 則訊息之前最近的狀態
function restoreBefore(n) {
    const cs = C();
    if (!cs) return false;
    const keys = Object.keys(cs.snapshots);
    if (!keys.length) return false;
    let best = null, bestIdx = -1;
    const chat = ctx().chat || [];
    for (const k of keys) {
        const [idxStr, swStr] = k.split(':');
        const idx = parseInt(idxStr);
        if (idx >= n) continue;
        const msg = chat[idx];
        if (!msg) continue;
        if (String(msg.swipe_id ?? 0) !== swStr) continue;
        if (idx > bestIdx) { bestIdx = idx; best = cs.snapshots[k]; }
    }
    if (best) { applySnapshot(best); return true; }
    return false;
}

// ───────────────────────── 標籤解析 ─────────────────────────

function extractTags(text, tag) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g');
    const found = [];
    const cleaned = text.replace(re, (_, inner) => { found.push(inner); return ''; });
    return { found, cleaned };
}

function parseJsonLoose(raw) {
    let t = String(raw).trim();
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(t); } catch (e) { /* 再試一次 */ }
    try {
        const fixed = t.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(fixed);
    } catch (e) {
        return null;
    }
}

function applyOpen(obj) {
    const cs = C();
    const inst = blankInstance();
    Object.assign(inst, {
        name: obj.name || '',
        worldline: obj.worldline || '',
        line_type: obj.line_type || '主線',
        difficulty: obj.difficulty || '',
        axes: Object.assign({ type: '', world: '', mechanic: '' }, obj.axes || {}),
        time_limit_days: Number(obj.time_limit_days) || 0,
        total_acts: Number(obj.total_acts) || (obj.acts?.length || 1),
        ending_range: obj.ending_range || '',
        sealed: Object.assign(inst.sealed, obj.sealed || {}),
    });
    inst.acts = (obj.acts || []).map((a, i) => ({
        number: a.number ?? i + 1, question: a.question || '', truth: a.truth || '',
        twist: a.twist || '', emotion_focus: a.emotion_focus || '', done: false,
    }));
    inst.clues = (obj.clues || []).map((c, i) => normClue(c, i));
    inst.cast = (obj.cast || []).map(normCast);
    inst.people = (obj.people || []).map(p => Object.assign({ name: '', identity: '', faction: '', player_note: '', observed_attitude: '', status: '在場', hidden_truth: '' }, p));
    inst.factions = (obj.factions || []).map(f => Object.assign({ name: '', stance: '', true_goal: '', related: '' }, f));
    if (obj.identity_card) inst.identity_card = Object.assign(inst.identity_card, obj.identity_card);
    if (obj.calendar) {
        inst.calendar = Object.assign(inst.calendar, obj.calendar);
        inst.calendar.day = 1;
        inst.calendar.events = (obj.calendar.events || []).map((e, i) => normEvent(e, i));
    }
    inst.glossary = (obj.glossary || []).map(g => ({ term: g.term || '', desc: g.desc || '', revealed: true }));
    cs.instance = inst;
    cs.mode = 'instance';
    return `副本「${inst.name || '未命名'}」已建立`;
}

function normClue(c, i) {
    return {
        id: c.id || `c${i + 1}`, act: Number(c.act) || 1, layer: c.layer || '表', content: c.content || '',
        is_misleading: !!c.is_misleading, true_meaning: c.true_meaning || '', holder: c.holder || '',
        status: c.status || '未出現', obtained_via: c.obtained_via || '',
    };
}

function normCast(c) {
    return Object.assign({
        codename: '', identity: '', category: '', role: '主要', resource: '', friction: '', revealed: false,
        real_name: '', affinity: 100, history_length: '', relation_type: '', promise: '', obsession_stage: '',
        last_seen_turn: 0,
    }, c);
}

function normEvent(e, i) {
    return { id: e.id || `e${i + 1}`, day: Number(e.day) || 1, title: e.title || '', sealed: !!e.sealed, fired: !!e.fired };
}

function applyTurn(o) {
    const cs = C();
    const inst = cs.instance;
    if (!inst) return null;
    const log = [];
    inst.turn = (inst.turn || 0) + 1;

    (o.present || []).forEach(code => {
        const c = inst.cast.find(x => x.codename === code);
        if (c) c.last_seen_turn = inst.turn;
    });
    (o.clue_release || []).forEach(id => {
        const c = inst.clues.find(x => x.id === id);
        if (c && c.status !== '已推翻') { c.status = '已釋出'; log.push(`線索 ${id} 已釋出`); }
    });
    (o.clue_overturn || []).forEach(id => {
        const c = inst.clues.find(x => x.id === id);
        if (c) { c.status = '已推翻'; log.push(`線索 ${id} 被推翻`); }
    });
    (o.clue_add || []).forEach(c => inst.clues.push(normClue(c, inst.clues.length)));

    if (typeof o.act_progress === 'number' && o.act_progress) {
        const inc = Math.max(-100, Math.min(8, o.act_progress));
        inst.act_progress = Math.max(0, Math.min(100, (inst.act_progress || 0) + inc));
        log.push(`本幕進度 ${inst.act_progress}%`);
    }
    if (o.act_next) advanceAct(log);

    if (typeof o.day === 'number' && o.day) {
        inst.calendar.day = (inst.calendar.day || 1) + o.day;
        log.push(`第 ${inst.calendar.day} 天`);
    }
    if (o.date_label) inst.calendar.date_label = o.date_label;
    if (o.time_label) inst.calendar.time_label = o.time_label;
    (o.event_fired || []).forEach(id => { const e = inst.calendar.events.find(x => x.id === id); if (e) e.fired = true; });
    (o.event_add || []).forEach(e => inst.calendar.events.push(normEvent(e, inst.calendar.events.length)));

    (o.glossary_add || []).forEach(g => {
        if (!g.term) return;
        const ex = inst.glossary.find(x => x.term === g.term);
        if (ex) ex.desc = g.desc || ex.desc; else inst.glossary.push({ term: g.term, desc: g.desc || '', revealed: true });
        log.push(`辭典新增「${g.term}」`);
    });

    const cons = Array.isArray(o.concession) ? o.concession : (o.concession ? [o.concession] : []);
    cons.forEach(x => { inst.concessions.push(Object.assign({ turn: inst.turn }, x)); log.push('記錄一次讓渡'); });

    (o.cast_update || []).forEach(u => {
        const c = inst.cast.find(x => x.codename === u.codename);
        if (!c) return;
        if (typeof u.affinity_delta === 'number') c.affinity = (Number(c.affinity) || 0) + u.affinity_delta;
        for (const k of Object.keys(u)) if (!['codename', 'affinity_delta'].includes(k) && u[k] !== '' && u[k] !== undefined) c[k] = u[k];
    });
    (o.cast_add || []).forEach(c => inst.cast.push(normCast(c)));

    (o.people_add || []).forEach(p => {
        if (!p.name || inst.people.find(x => x.name === p.name)) return;
        inst.people.push(Object.assign({ name: '', identity: '', faction: '', player_note: '', observed_attitude: '', status: '在場', hidden_truth: '' }, p));
    });
    (o.people_update || []).forEach(u => {
        const p = inst.people.find(x => x.name === u.name);
        if (p) for (const k of Object.keys(u)) if (u[k] !== '' && u[k] !== undefined) p[k] = u[k];
    });

    const inv = S().inventory;
    if (typeof o.shards === 'number' && o.shards) { inv.shards = Math.max(0, (inv.shards || 0) + o.shards); log.push(`碎片 ${o.shards > 0 ? '+' : ''}${o.shards}`); }
    (o.item_add || []).forEach(it => {
        if (!it.name) return;
        inv.items.push({ name: it.name, description: it.description || '', source: inst.name || '副本', quantity: it.quantity || 1, single_use: !!it.single_use, carry_rule: it.carry_rule || '僅限本副本', instance_id: inst.id });
        log.push(`取得「${it.name}」`);
    });
    (o.item_remove || []).forEach(name => {
        const i = inv.items.findIndex(x => x.name === name);
        if (i >= 0) inv.items.splice(i, 1);
    });

    if (o.mechanic_revealed) inst.mechanic_revealed = true;
    if (o.instance_end) { endInstance(o.instance_end); log.push('副本結束'); }
    return log.join('、');
}

function advanceAct(log = []) {
    const inst = C().instance;
    if (!inst) return;
    const a = inst.acts.find(x => x.number === inst.current_act);
    if (a) a.done = true;
    if (inst.current_act < inst.total_acts) {
        inst.current_act += 1;
        inst.act_progress = 0;
        log.push(`進入第 ${inst.current_act} 幕`);
    } else {
        inst.act_progress = 100;
        log.push('已是最後一幕');
    }
}

function endInstance(end) {
    const cs = C();
    const inst = cs.instance;
    if (!inst || inst.ended) return;
    const s = S();
    inst.ended = true;
    inst.status = end.result || '通關';
    s.ledger.push({
        no: s.ledger.length + 1,
        instance_id: inst.id, name: inst.name, worldline: inst.worldline, line_type: inst.line_type,
        difficulty: inst.difficulty, axes: clone(inst.axes),
        cast_categories: inst.cast.map(c => ({ codename: c.codename, real_name: c.real_name, category: c.category, identity: c.identity })),
        result: inst.status, exit_type: end.exit_type || '', reward_tier: end.reward_tier || '',
        date: new Date().toISOString().slice(0, 10),
    });
    if (inst.worldline) {
        let wl = s.worldlines.find(w => w.coordinate === inst.worldline);
        if (!wl) {
            wl = { coordinate: inst.worldline, record_wall_text: '', related_cast: [], upgrade_status: '', open_condition: '', missed_count: 0, anomaly: false, obsessed_cast: '' };
            s.worldlines.push(wl);
        }
        wl.record_wall_text = `${inst.name}｜${inst.status}`;
        wl.related_cast = Array.from(new Set([...(wl.related_cast || []), ...inst.cast.map(c => c.real_name).filter(Boolean)]));
        if (end.upgrade) wl.upgrade_status = end.upgrade;
        if (end.open_condition) wl.open_condition = end.open_condition;
        if (end.anomaly) wl.anomaly = true;
        if (end.exit_type === '強制召回') {
            const obsessed = s.worldlines.find(w => w.obsessed_cast);
            if (!obsessed) {
                const main = inst.cast.find(c => c.role === '主要');
                wl.obsessed_cast = main?.real_name || '';
            }
        }
    }
    // 僅限本副本的道具在離開時消失
    s.inventory.items = s.inventory.items.filter(it => !(it.instance_id === inst.id && it.carry_rule === '僅限本副本'));
    cs.mode = 'settle';
}

// ───────────────────────── 注入 ─────────────────────────

function line(label, value) {
    return value ? `${label}：${value}\n` : '';
}

function recentText() {
    const s = S();
    const recent = s.ledger.slice(-3);
    if (!recent.length) return '（尚無通關紀錄）\n';
    return recent.map(l =>
        `- ${l.name}｜${l.difficulty}｜${l.axes?.type}/${l.axes?.world}/${l.axes?.mechanic || '無'}｜男主身份類別：${(l.cast_categories || []).map(c => `${c.real_name || c.codename}(${c.category})`).join('、')}`
    ).join('\n') + '\n';
}

function worldlineSealedText() {
    const s = S();
    const ready = s.worldlines.filter(w => w.upgrade_status && w.upgrade_status !== '不升級');
    if (!ready.length) return '';
    return '\n【封存｜世界線升級狀態（供生成副本選項參考，不得向玩家說明）】\n' +
        ready.map(w => `- ${w.coordinate}｜${w.upgrade_status}｜開啟條件：${w.open_condition || '未定'}｜相關男主：${(w.related_cast || []).join('、')}${w.anomaly ? '｜異常' : ''}${w.obsessed_cast ? `｜走火入魔：${w.obsessed_cast}` : ''}｜錯過次數：${w.missed_count || 0}`).join('\n') + '\n';
}

function buildStateText() {
    const s = S();
    const cs = C();
    const inv = s.inventory;
    let t = '';

    if (cs.mode === 'lobby') {
        t += '【白域大廳狀態】\n';
        t += `碎片：${inv.shards || 0}\n`;
        t += `持有道具：${inv.items.filter(i => i.carry_rule !== '僅限本副本').map(i => i.name).join('、') || '無'}\n`;
        t += `已通關副本數：${s.ledger.length}\n`;
        t += '最近三個副本（防重複對照）：\n' + recentText();
        t += worldlineSealedText();
        return t;
    }

    if (cs.mode === 'opening') {
        const sd = cs.seed || {};
        t += '【副本開局｜種子卡】\n';
        t += line('世界一句話', sd.world) + line('想要的氛圍', sd.mood) + line('想要的名場面', sd.scenes) +
            line('不想要的東西', sd.avoid) + line('卡司指定', sd.cast || '交給 AI') + line('難度', sd.difficulty) +
            line('主線／支線', sd.line_type) + line('升級自世界線', sd.from_worldline);
        t += '最近三個副本（防重複對照，三軸與男主身份類別不得重複）：\n' + recentText();
        t += worldlineSealedText();
        t += '\n' + OPEN_TAG_SPEC + '\n';
        return t;
    }

    const inst = cs.instance;
    if (!inst) return '';

    if (cs.mode === 'settle') {
        t += '【副本已結束｜結算】\n';
        t += `副本：${inst.name}｜結果：${inst.status}\n`;
        t += '請以結算場景收尾：{{user}} 被召回白域大廳，無語進行結算。依結果給予獎勵等級與碎片，不得美化失敗。\n';
        return t;
    }

    // instance
    const cal = inst.calendar || {};
    t += '【副本狀態｜唯一可信來源】\n';
    t += `副本：${inst.name}（${inst.line_type}｜${inst.difficulty} 級｜世界線 ${inst.worldline}）\n`;
    t += `三軸：${inst.axes.type}／${inst.axes.world}／${inst.axes.mechanic || '無'}${inst.axes.mechanic && !inst.mechanic_revealed ? '（機制尚未向玩家揭露）' : ''}\n`;
    t += `時間：${cal.calendar_name || ''} ${cal.date_label || ''} ${cal.time_label || ''}｜副本第 ${cal.day || 1} 天`;
    if (inst.time_limit_days) {
        const remain = inst.time_limit_days - (cal.day || 1);
        t += `｜時限 ${inst.time_limit_days} 天，剩餘 ${remain} 天`;
        if (remain < 0) t += `\n⚠ 已超時 ${-remain} 天：依「滯留與強制召回」規則呈現世界不穩與手環警告。`;
    }
    t += '\n';
    t += `結局範圍：${inst.ending_range || '依玩家選擇判定'}\n`;

    t += `\n【封存｜總真相】${inst.sealed.total_truth}｜幕後：${inst.sealed.mastermind}｜動機：${inst.sealed.motive}\n`;

    t += `\n【幕】第 ${inst.current_act} 幕／共 ${inst.total_acts} 幕｜本幕進度 ${inst.act_progress}%\n`;
    inst.acts.filter(a => a.number < inst.current_act).forEach(a => {
        t += `- 第 ${a.number} 幕（已解開）：${a.question} → 真相：${a.truth}\n`;
    });
    const act = inst.acts.find(a => a.number === inst.current_act);
    if (act) {
        t += `- 當前第 ${act.number} 幕問題：${act.question}\n`;
        t += `  【封存】本幕真相：${act.truth}｜解開後揭露：${act.twist}｜情感重點：${act.emotion_focus}\n`;
    }
    t += '（尚未到達的幕不在此列，不得提前揭露或暗示。）\n';

    const actClues = inst.clues.filter(c => c.act <= inst.current_act);
    if (actClues.length) {
        t += '\n【線索】\n';
        actClues.forEach(c => {
            t += `- [${c.id}｜第${c.act}幕｜${c.layer}層｜${c.status}] ${c.content}｜持有：${c.holder}｜取得途徑：${c.obtained_via}`;
            if (c.is_misleading) t += `｜【封存】誤導，真正含義：${c.true_meaning}`;
            t += '\n';
        });
    }

    if (inst.cast.length) {
        t += '\n【本副本卡司】（其餘成員不存在於本副本）\n';
        inst.cast.forEach(c => {
            const gap = inst.turn - (c.last_seen_turn || 0);
            t += `- 代號「${c.codename}」｜${c.identity}｜${c.role}｜${c.category} 類｜資源：${c.resource}｜摩擦：${c.friction}｜身分${c.revealed ? '已揭露' : '未揭露（正文不得出現真名）'}\n`;
            t += `  【封存】真名：${c.real_name}｜好感：${c.affinity}｜歷程：${c.history_length}｜關係：${c.relation_type}｜未竟之約：${c.promise}｜執念階段：${c.obsession_stage}`;
            if (c.role === '主要' && gap >= 5) t += `｜已 ${gap} 回合未出場：待目前場景結束後，以隱藏存在或新場景介入`;
            t += '\n';
        });
    }

    if (inst.concessions.length) {
        t += '\n【本副本已發生的讓渡】（形式與代價類型不得重複）\n';
        inst.concessions.slice(-8).forEach(x => {
            t += `- ${x.giver}｜${x.what}｜${x.form}｜代價：${x.cost}${x.consequence ? `｜後續：${x.consequence}` : ''}\n`;
        });
    }

    if (inst.factions.length) {
        t += '\n【勢力】\n';
        inst.factions.forEach(f => { t += `- ${f.name}｜公開立場：${f.stance}｜【封存】真正目的：${f.true_goal}｜相關：${f.related}\n`; });
    }
    if (inst.people.length) {
        t += '\n【人物】\n';
        inst.people.forEach(p => { t += `- ${p.name}｜${p.identity}｜${p.faction}｜${p.status}｜表面態度：${p.observed_attitude}${p.hidden_truth ? `｜【封存】${p.hidden_truth}` : ''}\n`; });
    }

    const ic = inst.identity_card || {};
    if (ic.name || ic.social_role) {
        t += `\n【{{user}} 身份卡】${ic.name}｜${ic.age}｜${ic.social_role}｜${ic.family}｜限制：${ic.restrictions}｜活動範圍：${ic.range}｜摩擦：${ic.friction}\n`;
        const snap = ic.snapshot || {};
        const keys = Object.keys(snap).filter(k => snap[k]);
        if (keys.length) t += '個性快照：' + keys.map(k => `${k}=${snap[k]}`).join('、') + '\n';
    }

    const visibleEvents = (cal.events || []).filter(e => !e.fired);
    const due = visibleEvents.filter(e => e.sealed && e.day <= (cal.day || 1));
    const upcoming = visibleEvents.filter(e => !e.sealed);
    if (upcoming.length) t += '\n【已知行程】\n' + upcoming.map(e => `- 第 ${e.day} 天：${e.title}`).join('\n') + '\n';
    if (due.length) t += '\n【封存事件已到期｜必須在本回合或下一回合讓它發生，發生後以 event_fired 回報】\n' + due.map(e => `- [${e.id}] ${e.title}`).join('\n') + '\n';

    if (inst.glossary.length) t += '\n【副本辭典】\n' + inst.glossary.map(g => `- ${g.term}：${g.desc}`).join('\n') + '\n';

    const items = s.inventory.items;
    t += `\n【背包】碎片 ${s.inventory.shards || 0}｜道具：${items.map(i => i.name).join('、') || '無'}\n`;

    if (cs.lock) {
        t += '\n【⚠ 獨處鎖已開啟】{{user}} 正處於受保護的獨處場景。本回合不得出現任何外力打斷（他人闖入、來報、系統插話、突發事件），場景必須由兩人之一主動結束或情緒自然落定。\n';
    }

    t += '\n' + TURN_TAG_SPEC + '\n';
    return t;
}

function buildRulesText() {
    const s = S();
    const cs = C();
    const rules = s.rules.filter(r => r.enabled && (r.modes || []).includes(cs.mode));
    if (!rules.length) return '';
    return '<無限流規則>\n' + rules.map(r => r.content).join('\n\n') + '\n</無限流規則>';
}

function updateInjection() {
    const c = ctx();
    const s = S();
    const cs = C();
    const setP = c.setExtensionPrompt;
    if (typeof setP !== 'function') {
        console.warn('[Nova無限流] 找不到 setExtensionPrompt，無法注入');
        return;
    }
    if (!s.enabled || !cs || cs.mode === 'off') {
        setP(KEY_RULES, '', 0, 0);
        setP(KEY_STATE, '', 1, 0);
        return;
    }
    const rules = sub(buildRulesText());
    const state = sub(buildStateText());
    if (s.rulesDepthMode === 'chat') setP(KEY_RULES, rules, 1, Number(s.rulesDepth) || 4, false, 0);
    else setP(KEY_RULES, rules, 0, 0, false, 0);
    setP(KEY_STATE, state, 1, Number(s.stateDepth) || 1, false, 0);
}

// ───────────────────────── 事件 ─────────────────────────

function onMessageReceived(mesId) {
    const s = S();
    const cs = C();
    if (!s.enabled || !cs) return;
    const chat = ctx().chat;
    const msg = chat?.[mesId];
    if (!msg || msg.is_user) return;

    let text = msg.mes || '';
    const logs = [];

    const open = extractTags(text, 'inf_open');
    text = open.cleaned;
    for (const raw of open.found) {
        const obj = parseJsonLoose(raw);
        if (obj) logs.push(applyOpen(obj));
        else toast('開局標籤解析失敗，請檢查 JSON 格式（原文已保存在訊息資料中）', 'warning');
    }

    const turn = extractTags(text, 'inf');
    text = turn.cleaned;
    for (const raw of turn.found) {
        const obj = parseJsonLoose(raw);
        if (obj) { const r = applyTurn(obj); if (r) logs.push(r); }
        else toast('回合標籤解析失敗（原文已保存在訊息資料中）', 'warning');
    }

    if (open.found.length || turn.found.length) {
        text = text.replace(/\s+$/, '');
        msg.extra = msg.extra || {};
        msg.extra.nova_inf_raw = [...open.found.map(x => `<inf_open>${x}</inf_open>`), ...turn.found.map(x => `<inf>${x}</inf>`)].join('\n');
        msg.extra.nova_inf_cleaned = true;
        msg.mes = text;
        if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = text;
        if (logs.filter(Boolean).length) toast(logs.filter(Boolean).join('｜'), 'success');
    }

    if (cs.instance) cs.instance.turn = cs.instance.turn || 0;
    takeSnapshot();
    saveSettings();
    saveChatState();
    updateInjection();
    renderPanel();
}

function onMessageRendered(mesId) {
    const msg = ctx().chat?.[mesId];
    if (!msg?.extra?.nova_inf_cleaned) return;
    if (updateMessageBlockFn) {
        try { updateMessageBlockFn(Number(mesId), msg); } catch (e) { /* 忽略 */ }
    }
}

function onSwiped(mesId) {
    const cs = C();
    if (!cs) return;
    const key = snapKey(mesId);
    if (cs.snapshots[key]) applySnapshot(cs.snapshots[key]);
    else restoreBefore(Number(mesId));
    updateInjection();
    renderPanel();
}

function onDeleted() {
    const cs = C();
    if (!cs) return;
    const n = (ctx().chat || []).length;
    const hadLater = Object.keys(cs.snapshots).some(k => parseInt(k) >= n);
    if (hadLater) {
        for (const k of Object.keys(cs.snapshots)) if (parseInt(k) >= n) delete cs.snapshots[k];
        restoreBefore(n);
        saveChatState();
    }
    updateInjection();
    renderPanel();
}

function onChatChanged() {
    peek = false;
    updateInjection();
    renderPanel();
}

// 手動修改後的統一存檔
function commit() {
    takeSnapshot();
    saveSettings();
    saveChatState();
    updateInjection();
    renderPanel();
}

// ───────────────────────── UI ─────────────────────────

const TABS = [
    ['overview', '總覽'],
    ['people', '人物'],
    ['clues', '線索'],
    ['calendar', '日曆'],
    ['bag', '背包'],
    ['glossary', '辭典'],
    ['worlds', '世界線'],
    ['sealed', '封存'],
    ['rules', '規則'],
    ['settings', '設定'],
];

function ensurePanel() {
    if (document.getElementById('nova_inf_panel')) return;
    const panel = document.createElement('div');
    panel.id = 'nova_inf_panel';
    panel.className = 'nova-inf-hidden';
    panel.innerHTML = `
        <div class="nova-inf-header">
            <span class="nova-inf-title">∞ 無限流面板</span>
            <span class="nova-inf-mode" id="nova_inf_mode_badge"></span>
            <button class="nova-inf-x" id="nova_inf_close" title="關閉">✕</button>
        </div>
        <div class="nova-inf-tabs" id="nova_inf_tabs"></div>
        <div class="nova-inf-body" id="nova_inf_body"></div>`;
    document.body.appendChild(panel);
    document.getElementById('nova_inf_close').addEventListener('click', togglePanel);
    const tabs = document.getElementById('nova_inf_tabs');
    TABS.forEach(([id, label]) => {
        const b = document.createElement('button');
        b.className = 'nova-inf-tab';
        b.dataset.tab = id;
        b.textContent = label;
        b.addEventListener('click', () => { currentTab = id; renderPanel(); });
        tabs.appendChild(b);
    });
    document.getElementById('nova_inf_body').addEventListener('click', onBodyClick);
    document.getElementById('nova_inf_body').addEventListener('change', onBodyChange);
}

function togglePanel() {
    ensurePanel();
    document.getElementById('nova_inf_panel').classList.toggle('nova-inf-hidden');
    renderPanel();
}

function sealedVal(v) {
    return peek ? esc(v) : '<span class="nova-inf-lock">🔒</span>';
}

function card(title, body, actions = '') {
    return `<div class="nova-inf-card"><div class="nova-inf-card-head"><b>${title}</b><span>${actions}</span></div>${body}</div>`;
}

function btn(action, label, extra = '') {
    return `<button class="nova-inf-btn" data-act="${action}" ${extra}>${label}</button>`;
}

function renderPanel() {
    const panel = document.getElementById('nova_inf_panel');
    if (!panel || panel.classList.contains('nova-inf-hidden')) return;
    const cs = C();
    const body = document.getElementById('nova_inf_body');
    document.querySelectorAll('.nova-inf-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
    const badge = document.getElementById('nova_inf_mode_badge');
    if (!cs) { body.innerHTML = '<p class="nova-inf-empty">請先開啟一個聊天。</p>'; badge.textContent = ''; return; }
    badge.textContent = MODES[cs.mode] + (cs.lock ? '｜獨處鎖' : '');
    const renderers = {
        overview: renderOverview, people: renderPeople, clues: renderClues, calendar: renderCalendar,
        bag: renderBag, glossary: renderGlossary, worlds: renderWorlds, sealed: renderSealed,
        rules: renderRules, settings: renderSettingsTab,
    };
    body.innerHTML = renderers[currentTab]();
}

function renderOverview() {
    const cs = C();
    const s = S();
    const inst = cs.instance;
    let h = '';
    h += card('模式', `
        <select class="nova-inf-input" data-bind="mode">
            ${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${cs.mode === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <p class="nova-inf-hint">一個副本請開一個新聊天。白域大廳：選副本、商城；副本開局：填好種子卡後送出第一則訊息；AI 回傳開局資料後會自動切到「副本進行中」。</p>`);

    if (cs.mode === 'lobby') {
        h += card('白域大廳', `
            <p>碎片：<b>${s.inventory.shards || 0}</b>｜已通關：<b>${s.ledger.length}</b></p>
            ${btn('to_opening', '在這個聊天開始副本開局')}`);
    }

    if (cs.mode === 'opening' || cs.mode === 'lobby') {
        const sd = cs.seed || {};
        const f = (k, label, ph = '') => `<label class="nova-inf-label">${label}<textarea class="nova-inf-input" rows="2" data-seed="${k}" placeholder="${ph}">${esc(sd[k] || '')}</textarea></label>`;
        h += card('副本種子卡', `
            ${f('world', '世界一句話', '例：一座每到冬天就封港的北方港城')}
            ${f('mood', '想要的氛圍', '例：華麗但壓抑、慢熱')}
            ${f('scenes', '想要的名場面（選填）', '例：一場必須戴面具參加的舞會')}
            ${f('avoid', '不想要的東西', '例：大量戰鬥')}
            ${f('cast', '卡司（空白＝交給 AI）')}
            ${f('difficulty', '難度（空白＝交給 AI）')}
            ${f('line_type', '主線／支線')}
            ${f('from_worldline', '升級自世界線座標（選填）')}
            <p class="nova-inf-hint">謎底層一律交給 AI 生成並封存，你不會在這裡看到。</p>`);
    }

    if (inst) {
        const cal = inst.calendar || {};
        const remain = inst.time_limit_days ? inst.time_limit_days - (cal.day || 1) : null;
        h += card(esc(inst.name || '未命名副本'), `
            <p>${esc(inst.line_type)}｜${esc(inst.difficulty)} 級｜${esc(inst.worldline)}｜狀態：${esc(inst.status)}</p>
            <p>${esc(inst.axes.type)}／${esc(inst.axes.world)}／${inst.axes.mechanic ? (inst.mechanic_revealed || peek ? esc(inst.axes.mechanic) : '？？？') : '無機制'}</p>
            <p>第 <b>${inst.current_act}</b> 幕／共 ${inst.total_acts} 幕</p>
            <div class="nova-inf-bar"><div style="width:${inst.act_progress}%"></div></div>
            <p class="nova-inf-hint">本幕進度 ${inst.act_progress}%</p>
            <p>${esc(cal.calendar_name)} ${esc(cal.date_label)} ${esc(cal.time_label)}｜第 ${cal.day || 1} 天${remain !== null ? `｜剩餘 ${remain} 天${remain < 0 ? '（已超時）' : ''}` : ''}</p>
            <p>本幕問題：${esc(inst.acts.find(a => a.number === inst.current_act)?.question || '—')}</p>`,
            btn('edit_basic', '編輯'));
        h += card('快捷操作', `
            <div class="nova-inf-row">
                ${btn('lock', cs.lock ? '🔓 關閉獨處鎖' : '🔒 開啟獨處鎖', cs.lock ? 'data-on="1"' : '')}
                ${btn('day_plus', '日期 +1')}
                ${btn('prog_plus', '進度 +5%')}
                ${btn('act_next', '進入下一幕')}
                ${btn('end_manual', '手動結束副本')}
            </div>`);
    }

    if (cs.mode === 'settle') {
        h += card('結算', `<p>副本已結束並寫入帳本。結算劇情跑完後，可切回白域大廳。</p>${btn('to_lobby', '回到白域大廳')}`);
    }
    return h;
}

function renderPeople() {
    const inst = C().instance;
    if (!inst) return '<p class="nova-inf-empty">目前沒有進行中的副本。</p>';
    let h = '';
    h += card('卡司', inst.cast.map(c => `
        <div class="nova-inf-item">
            <div><b>${esc(c.codename)}</b>｜${esc(c.identity)}｜${esc(c.role)}｜${esc(c.category)} 類 ${c.revealed ? '｜<i>已揭露</i>' : ''}</div>
            <div class="nova-inf-sub">真名：${c.revealed ? esc(c.real_name) : sealedVal(c.real_name)}｜好感：${sealedVal(c.affinity)}</div>
            <div class="nova-inf-sub">資源：${esc(c.resource)}</div>
        </div>`).join('') || '<p class="nova-inf-empty">無</p>', btn('edit_cast', '編輯'));

    h += card('人物', inst.people.map((p, i) => `
        <div class="nova-inf-item">
            <div><b>${esc(p.name)}</b>｜${esc(p.identity)}｜${esc(p.faction)}｜${esc(p.status)}</div>
            <div class="nova-inf-sub">表面態度：${esc(p.observed_attitude)}</div>
            <label class="nova-inf-sub">我的筆記（不送給 AI）：
                <input class="nova-inf-input" data-note="${i}" value="${esc(p.player_note || '')}"></label>
        </div>`).join('') || '<p class="nova-inf-empty">無</p>', btn('edit_people', '編輯'));

    h += card('勢力', inst.factions.map(f => `
        <div class="nova-inf-item"><b>${esc(f.name)}</b>｜公開立場：${esc(f.stance)}｜真正目的：${sealedVal(f.true_goal)}</div>`).join('') || '<p class="nova-inf-empty">無</p>', btn('edit_factions', '編輯'));

    const ic = inst.identity_card || {};
    h += card('我的身份卡', `
        <p>${esc(ic.name)}｜${esc(ic.age)}｜${esc(ic.social_role)}</p>
        <p class="nova-inf-sub">${esc(ic.family)}｜限制：${esc(ic.restrictions)}｜範圍：${esc(ic.range)}</p>
        <p class="nova-inf-sub">摩擦：${esc(ic.friction)}</p>
        <p class="nova-inf-sub">${Object.entries(ic.snapshot || {}).filter(([, v]) => v).map(([k, v]) => `${esc(k)}：${esc(v)}`).join('｜')}</p>`,
        btn('edit_identity', '編輯'));
    return h;
}

function renderClues() {
    const inst = C().instance;
    if (!inst) return '<p class="nova-inf-empty">目前沒有進行中的副本。</p>';
    let h = '';
    for (let n = 1; n <= inst.total_acts; n++) {
        const act = inst.acts.find(a => a.number === n);
        const future = n > inst.current_act;
        if (future && !peek) { h += card(`第 ${n} 幕`, '<p class="nova-inf-lock">🔒 尚未到達</p>'); continue; }
        const clues = inst.clues.filter(c => c.act === n);
        h += card(`第 ${n} 幕${act?.done ? '（已解開）' : n === inst.current_act ? '（進行中）' : ''}`, `
            <p class="nova-inf-sub">問題：${esc(act?.question || '—')}</p>
            ${clues.map(c => {
                const shown = c.status !== '未出現' || peek;
                return `<div class="nova-inf-item nova-inf-clue-${c.status === '已釋出' ? 'on' : c.status === '已推翻' ? 'off' : 'wait'}">
                    <div>[${esc(c.id)}｜${esc(c.layer)}層｜${esc(c.status)}] ${shown ? esc(c.content) : '🔒 未出現的線索'}</div>
                    ${shown ? `<div class="nova-inf-sub">持有：${esc(c.holder)}｜途徑：${esc(c.obtained_via)}${peek && c.is_misleading ? `｜誤導，真正含義：${esc(c.true_meaning)}` : ''}</div>` : ''}
                    <div class="nova-inf-row">
                        ${c.status !== '已釋出' ? btn('clue_release', '釋出', `data-id="${esc(c.id)}"`) : ''}
                        ${c.status !== '已推翻' ? btn('clue_overturn', '推翻', `data-id="${esc(c.id)}"`) : ''}
                    </div>
                </div>`;
            }).join('') || '<p class="nova-inf-empty">本幕沒有線索</p>'}`);
    }
    h += `<div class="nova-inf-row">${btn('edit_clues', '編輯全部線索（會顯示未出現的內容）')}</div>`;
    return h;
}

function renderCalendar() {
    const inst = C().instance;
    if (!inst) return '<p class="nova-inf-empty">目前沒有進行中的副本。</p>';
    const cal = inst.calendar || {};
    const events = cal.events || [];
    const visible = events.filter(e => !e.sealed || e.fired || peek);
    const sealedCount = events.filter(e => e.sealed && !e.fired).length;
    return card('日曆', `
        <p>${esc(cal.calendar_name)}｜${esc(cal.date_label)}｜${esc(cal.time_label)}</p>
        <p>副本第 <b>${cal.day || 1}</b> 天${inst.time_limit_days ? `／時限 ${inst.time_limit_days} 天` : ''}</p>
        <div class="nova-inf-row">${btn('day_plus', '日期 +1')}${btn('edit_calendar', '編輯日曆')}</div>`) +
        card('行程與事件', visible.sort((a, b) => a.day - b.day).map(e => `
            <div class="nova-inf-item ${e.fired ? 'nova-inf-done' : ''}">第 ${e.day} 天｜${esc(e.title)}${e.sealed ? '（封存）' : ''}${e.fired ? '｜已發生' : ''}</div>`).join('') || '<p class="nova-inf-empty">無</p>') +
        (sealedCount && !peek ? `<p class="nova-inf-hint">另有 ${sealedCount} 個封存事件，到期時會自動提醒 AI。</p>` : '');
}

function renderBag() {
    const s = S();
    const inv = s.inventory;
    return card('背包', `
        <p>碎片：<b>${inv.shards || 0}</b></p>
        ${inv.items.map((it, i) => `<div class="nova-inf-item"><b>${esc(it.name)}</b> ×${it.quantity || 1}｜${esc(it.carry_rule)}｜來源：${esc(it.source)}<div class="nova-inf-sub">${esc(it.description)}</div>${btn('item_del', '丟棄', `data-i="${i}"`)}</div>`).join('') || '<p class="nova-inf-empty">空空的</p>'}`,
        btn('edit_bag', '編輯')) +
        card('現實獎勵', `
        ${s.rewards.map((r, i) => `<div class="nova-inf-item">${esc(r.instance_name || '')}｜${esc(r.reward_tier || '')}｜願望：${esc(r.wish)}｜${r.redeemed ? '已兌現' : '未兌現'} ${btn('reward_toggle', r.redeemed ? '標記未兌現' : '標記已兌現', `data-i="${i}"`)}</div>`).join('') || '<p class="nova-inf-empty">還沒有許過願</p>'}`,
        btn('edit_rewards', '編輯'));
}

function renderGlossary() {
    const s = S();
    const inst = C().instance;
    return card('副本辭典', (inst?.glossary || []).map(g => `<div class="nova-inf-item"><b>${esc(g.term)}</b>：${esc(g.desc)}</div>`).join('') || '<p class="nova-inf-empty">無</p>',
        inst ? btn('edit_glossary', '編輯') : '') +
        card('白域通用詞彙', s.glossary_global.map(g => `<div class="nova-inf-item"><b>${esc(g.term)}</b>：${esc(g.desc)}</div>`).join('') || '<p class="nova-inf-empty">無</p>',
        btn('edit_glossary_global', '編輯'));
}

function renderWorlds() {
    const s = S();
    return card('通關帳本', s.ledger.slice().reverse().map(l => `
        <div class="nova-inf-item">#${l.no}｜<b>${esc(l.name)}</b>｜${esc(l.worldline)}｜${esc(l.line_type)}｜${esc(l.difficulty)}｜${esc(l.result)}
        <div class="nova-inf-sub">${esc(l.axes?.type)}／${esc(l.axes?.world)}／${esc(l.axes?.mechanic || '無')}｜${esc(l.exit_type)}｜${esc(l.date)}</div></div>`).join('') || '<p class="nova-inf-empty">尚無紀錄</p>',
        btn('edit_ledger', '編輯')) +
        card('世界線紀錄牆', s.worldlines.map(w => `
        <div class="nova-inf-item"><b>${esc(w.coordinate)}</b>｜${esc(w.record_wall_text)}${w.anomaly ? '｜<span class="nova-inf-warn">異常</span>' : ''}
        <div class="nova-inf-sub">升級：${sealedVal(w.upgrade_status)}｜條件：${sealedVal(w.open_condition)}</div></div>`).join('') || '<p class="nova-inf-empty">尚無紀錄</p>',
        btn('edit_worldlines', '編輯'));
}

function renderSealed() {
    if (!peek) {
        return card('封存區', `
            <p>這裡是 AI 用來推進劇情的真相、真名、好感與過往。</p>
            <p class="nova-inf-hint">解鎖後，其他分頁的 🔒 也會一起顯示，直到你切換聊天或重新上鎖。</p>
            ${btn('peek_on', '我確定要偷看')}`);
    }
    const inst = C().instance;
    let h = card('封存區（已解鎖）', btn('peek_off', '重新上鎖'));
    if (!inst) return h + '<p class="nova-inf-empty">目前沒有副本。</p>';
    h += card('總真相', `<p>${esc(inst.sealed.total_truth)}</p><p>幕後：${esc(inst.sealed.mastermind)}</p><p>動機：${esc(inst.sealed.motive)}</p>`, btn('edit_sealed', '編輯'));
    h += card('各幕真相', inst.acts.map(a => `<div class="nova-inf-item">第 ${a.number} 幕｜${esc(a.question)}<div class="nova-inf-sub">真相：${esc(a.truth)}</div><div class="nova-inf-sub">揭露：${esc(a.twist)}｜情感重點：${esc(a.emotion_focus)}</div></div>`).join(''), btn('edit_acts', '編輯'));
    h += card('男主與你的過往', inst.cast.map(c => `
        <div class="nova-inf-item"><b>${esc(c.codename)}</b> ＝ ${esc(c.real_name)}｜好感 ${esc(c.affinity)}｜${esc(c.obsession_stage)}
        <div class="nova-inf-sub">歷程：${esc(c.history_length)}｜關係：${esc(c.relation_type)}</div>
        <div class="nova-inf-sub">未竟之約：${esc(c.promise)}</div></div>`).join(''));
    h += card('讓渡紀錄', inst.concessions.map(x => `<div class="nova-inf-item">回合 ${x.turn}｜${esc(x.giver)}｜${esc(x.what)}｜${esc(x.form)}<div class="nova-inf-sub">代價：${esc(x.cost)}｜後續：${esc(x.consequence)}</div></div>`).join('') || '<p class="nova-inf-empty">無</p>', btn('edit_concessions', '編輯'));
    return h;
}

function renderRules() {
    const s = S();
    return `<p class="nova-inf-hint">勾選的規則會在對應模式下送給 AI。內容可以直接修改，失焦後自動儲存。</p>` +
        s.rules.map((r, i) => `
        <details class="nova-inf-card">
            <summary><input type="checkbox" data-rule-on="${i}" ${r.enabled ? 'checked' : ''}> <b>${esc(r.title)}</b>
                <span class="nova-inf-sub">${(r.modes || []).map(m => MODES[m] || m).join('、')}</span></summary>
            <div class="nova-inf-row">${Object.entries(MODES).filter(([k]) => k !== 'off').map(([k, v]) =>
                `<label class="nova-inf-chip"><input type="checkbox" data-rule-mode="${i}" value="${k}" ${(r.modes || []).includes(k) ? 'checked' : ''}>${v}</label>`).join('')}</div>
            <textarea class="nova-inf-input nova-inf-rule" rows="10" data-rule-text="${i}">${esc(r.content)}</textarea>
        </details>`).join('') +
        `<div class="nova-inf-row">${btn('rules_reset', '還原預設規則（會覆蓋你的修改）')}</div>`;
}

function renderSettingsTab() {
    const s = S();
    return card('插件設定', `
        <label class="nova-inf-label"><input type="checkbox" data-set="enabled" ${s.enabled ? 'checked' : ''}> 啟用插件</label>
        <label class="nova-inf-label">規則放置位置
            <select class="nova-inf-input" data-set="rulesDepthMode">
                <option value="prompt" ${s.rulesDepthMode === 'prompt' ? 'selected' : ''}>主提示詞（較前面）</option>
                <option value="chat" ${s.rulesDepthMode === 'chat' ? 'selected' : ''}>聊天中（指定深度）</option>
            </select></label>
        <label class="nova-inf-label">規則深度（選「聊天中」時有效）<input class="nova-inf-input" type="number" data-set="rulesDepth" value="${s.rulesDepth}"></label>
        <label class="nova-inf-label">狀態深度（建議 1）<input class="nova-inf-input" type="number" data-set="stateDepth" value="${s.stateDepth}"></label>`) +
        card('備份', `
        <div class="nova-inf-row">${btn('export', '匯出全部資料')}${btn('import', '匯入資料')}</div>
        <p class="nova-inf-hint">匯出內容包含封存資料。</p>`) +
        card('檢查注入內容', `${btn('preview', '預覽這一刻送給 AI 的內容')}<p class="nova-inf-hint">預覽會包含封存資訊。</p>`);
}

// ───────────────────────── JSON 編輯視窗 ─────────────────────────

function openEditor(title, data, onSave) {
    closeEditor();
    const wrap = document.createElement('div');
    wrap.id = 'nova_inf_editor';
    wrap.innerHTML = `
        <div class="nova-inf-editor-box">
            <div class="nova-inf-card-head"><b>${esc(title)}</b></div>
            <textarea class="nova-inf-input" id="nova_inf_editor_text" rows="18">${esc(typeof data === 'string' ? data : JSON.stringify(data, null, 2))}</textarea>
            <div class="nova-inf-row">
                <button class="nova-inf-btn" id="nova_inf_editor_save">儲存</button>
                <button class="nova-inf-btn" id="nova_inf_editor_cancel">取消</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    document.getElementById('nova_inf_editor_cancel').onclick = closeEditor;
    if (!onSave) {
        document.getElementById('nova_inf_editor_save').remove();
        document.getElementById('nova_inf_editor_cancel').textContent = '關閉';
        return;
    }
    document.getElementById('nova_inf_editor_save').onclick = () => {
        const v = parseJsonLoose(document.getElementById('nova_inf_editor_text').value);
        if (v === null) { toast('JSON 格式錯誤，請檢查逗號與引號', 'error'); return; }
        onSave(v);
        closeEditor();
        commit();
    };
}

function closeEditor() {
    document.getElementById('nova_inf_editor')?.remove();
}

function stripKeys(list, keys) {
    if (peek) return clone(list);
    return list.map(x => { const y = clone(x); keys.forEach(k => delete y[k]); return y; });
}

function mergeKeys(orig, edited, keys) {
    if (peek) return edited;
    return edited.map((e, i) => {
        const o = orig[i] || {};
        const out = Object.assign({}, e);
        keys.forEach(k => { if (o[k] !== undefined) out[k] = o[k]; });
        return out;
    });
}

// ───────────────────────── 互動 ─────────────────────────

function onBodyClick(ev) {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const cs = C();
    const s = S();
    const inst = cs?.instance;

    switch (act) {
        case 'to_opening': cs.mode = 'opening'; commit(); break;
        case 'to_lobby': cs.mode = 'lobby'; commit(); break;
        case 'lock': cs.lock = !cs.lock; commit(); break;
        case 'day_plus': if (inst) { inst.calendar.day = (inst.calendar.day || 1) + 1; commit(); } break;
        case 'prog_plus': if (inst) { inst.act_progress = Math.min(100, inst.act_progress + 5); commit(); } break;
        case 'act_next': if (inst && confirm('確定進入下一幕？')) { advanceAct(); commit(); } break;
        case 'end_manual':
            if (inst && confirm('手動結束副本並寫入帳本？')) {
                const result = prompt('結果（完美通關／部分通關／苦澀通關／失敗／壞結局）', '通關') || '通關';
                const exit = prompt('離開方式（正常召回／突然消失／未告別／強制召回）', '正常召回') || '正常召回';
                endInstance({ result, exit_type: exit });
                commit();
            }
            break;
        case 'clue_release': case 'clue_overturn': {
            const c = inst?.clues.find(x => x.id === b.dataset.id);
            if (c) { c.status = act === 'clue_release' ? '已釋出' : '已推翻'; commit(); }
            break;
        }
        case 'item_del': s.inventory.items.splice(Number(b.dataset.i), 1); commit(); break;
        case 'reward_toggle': { const r = s.rewards[Number(b.dataset.i)]; if (r) { r.redeemed = !r.redeemed; commit(); } break; }
        case 'peek_on': if (confirm('解鎖後會看到真相、真名與好感。確定？')) { peek = true; renderPanel(); } break;
        case 'peek_off': peek = false; renderPanel(); break;

        case 'edit_basic': if (inst) {
            const keys = ['name', 'worldline', 'line_type', 'difficulty', 'axes', 'mechanic_revealed', 'time_limit_days', 'total_acts', 'current_act', 'act_progress', 'ending_range', 'status'];
            const data = {}; keys.forEach(k => data[k] = inst[k]);
            if (!peek && inst.axes.mechanic && !inst.mechanic_revealed) data.axes = Object.assign({}, inst.axes, { mechanic: '（未揭露，解鎖封存後才可編輯）' });
            openEditor('副本基本資料', data, v => {
                const mech = inst.axes.mechanic;
                Object.assign(inst, v);
                if (!peek && !inst.mechanic_revealed) inst.axes.mechanic = mech;
            });
        } break;
        case 'edit_cast': if (inst) openEditor('卡司' + (peek ? '' : '（封存欄位已隱藏，儲存時會保留）'), stripKeys(inst.cast, SEALED_CAST_KEYS), v => { inst.cast = mergeKeys(inst.cast, v, SEALED_CAST_KEYS).map(normCast); }); break;
        case 'edit_people': if (inst) openEditor('人物', stripKeys(inst.people, SEALED_PEOPLE_KEYS), v => { inst.people = mergeKeys(inst.people, v, SEALED_PEOPLE_KEYS); }); break;
        case 'edit_factions': if (inst) openEditor('勢力', stripKeys(inst.factions, SEALED_FACTION_KEYS), v => { inst.factions = mergeKeys(inst.factions, v, SEALED_FACTION_KEYS); }); break;
        case 'edit_identity': if (inst) openEditor('身份卡', inst.identity_card, v => { inst.identity_card = v; }); break;
        case 'edit_clues': if (inst && (peek || confirm('編輯全部線索會看到尚未出現的內容，確定？'))) openEditor('線索', inst.clues, v => { inst.clues = v.map(normClue); }); break;
        case 'edit_calendar': if (inst) {
            const data = clone(inst.calendar);
            if (!peek) data.events = data.events.filter(e => !e.sealed || e.fired);
            openEditor('日曆' + (peek ? '' : '（封存事件已隱藏，儲存時會保留）'), data, v => {
                const hidden = peek ? [] : inst.calendar.events.filter(e => e.sealed && !e.fired);
                inst.calendar = Object.assign({}, v, { events: [...(v.events || []).map(normEvent), ...hidden] });
            });
        } break;
        case 'edit_bag': openEditor('背包', s.inventory, v => { s.inventory = Object.assign({ shards: 0, items: [] }, v); }); break;
        case 'edit_rewards': openEditor('現實獎勵（每筆：instance_name、reward_tier、wish、redeemed）', s.rewards, v => { s.rewards = v; }); break;
        case 'edit_glossary': if (inst) openEditor('副本辭典', inst.glossary, v => { inst.glossary = v; }); break;
        case 'edit_glossary_global': openEditor('白域通用詞彙', s.glossary_global, v => { s.glossary_global = v; }); break;
        case 'edit_ledger': openEditor('通關帳本', s.ledger, v => { s.ledger = v; }); break;
        case 'edit_worldlines':
            if (peek || confirm('世界線紀錄包含升級條件與相關男主，確定要編輯？')) openEditor('世界線紀錄', s.worldlines, v => { s.worldlines = v; });
            break;
        case 'edit_sealed': if (inst) openEditor('總真相', inst.sealed, v => { inst.sealed = v; }); break;
        case 'edit_acts': if (inst) openEditor('各幕', inst.acts, v => { inst.acts = v; }); break;
        case 'edit_concessions': if (inst) openEditor('讓渡紀錄', inst.concessions, v => { inst.concessions = v; }); break;

        case 'rules_reset':
            if (confirm('確定還原所有規則為預設內容？你的修改會消失。')) { s.rules = clone(DEFAULT_RULES); commit(); }
            break;
        case 'export': {
            const data = { settings: s, chat: cs };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `nova_infinite_backup_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            break;
        }
        case 'import': {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.json';
            input.onchange = async () => {
                const file = input.files[0]; if (!file) return;
                const obj = parseJsonLoose(await file.text());
                if (!obj?.settings) { toast('檔案格式不對', 'error'); return; }
                if (!confirm('匯入會覆蓋全域資料（帳本、背包、規則等），確定？')) return;
                ctx().extensionSettings[MODULE] = obj.settings;
                if (obj.chat && confirm('也要把備份中的副本狀態套用到目前這個聊天嗎？')) ctx().chatMetadata[MODULE] = obj.chat;
                commit();
            };
            input.click();
            break;
        }
        case 'preview': {
            const text = sub(buildRulesText()) + '\n\n' + sub(buildStateText());
            openEditor('注入預覽（僅供檢視）', text, null);
            break;
        }
    }
}

function onBodyChange(ev) {
    const t = ev.target;
    const cs = C();
    const s = S();
    if (t.dataset.bind === 'mode') { cs.mode = t.value; commit(); return; }
    if (t.dataset.seed) { cs.seed[t.dataset.seed] = t.value; saveChatState(); updateInjection(); return; }
    if (t.dataset.note !== undefined) { const p = cs.instance?.people[Number(t.dataset.note)]; if (p) { p.player_note = t.value; commit(); } return; }
    if (t.dataset.ruleOn !== undefined) { s.rules[Number(t.dataset.ruleOn)].enabled = t.checked; saveSettings(); updateInjection(); return; }
    if (t.dataset.ruleMode !== undefined) {
        const r = s.rules[Number(t.dataset.ruleMode)];
        const set = new Set(r.modes || []);
        if (t.checked) set.add(t.value); else set.delete(t.value);
        r.modes = Array.from(set);
        saveSettings(); updateInjection(); return;
    }
    if (t.dataset.ruleText !== undefined) { s.rules[Number(t.dataset.ruleText)].content = t.value; saveSettings(); updateInjection(); return; }
    if (t.dataset.set) {
        const k = t.dataset.set;
        s[k] = t.type === 'checkbox' ? t.checked : (t.type === 'number' ? Number(t.value) : t.value);
        saveSettings(); updateInjection(); renderPanel(); return;
    }
}

// ───────────────────────── 入口 ─────────────────────────

function addMenuButton() {
    const menu = document.getElementById('extensionsMenu');
    if (menu && !document.getElementById('nova_inf_wand')) {
        const item = document.createElement('div');
        item.id = 'nova_inf_wand';
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.tabIndex = 0;
        item.innerHTML = '<div class="fa-solid fa-infinity extensionsMenuExtensionButton"></div><span>無限流面板</span>';
        item.addEventListener('click', togglePanel);
        menu.appendChild(item);
    }
    const settings = document.getElementById('extensions_settings2');
    if (settings && !document.getElementById('nova_inf_settings')) {
        const box = document.createElement('div');
        box.id = 'nova_inf_settings';
        box.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Nova 無限流面板</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <button class="menu_button" id="nova_inf_open_btn">打開無限流面板</button>
                    <p class="nova-inf-hint">也可以從輸入框左邊的魔杖選單打開。</p>
                </div>
            </div>`;
        settings.appendChild(box);
        document.getElementById('nova_inf_open_btn').addEventListener('click', togglePanel);
    }
}

async function loadOptionalApis() {
    try {
        const mod = await import('../../../../script.js');
        if (typeof mod.updateMessageBlock === 'function') updateMessageBlockFn = mod.updateMessageBlock;
    } catch (e) {
        console.warn('[Nova無限流] 無法載入 updateMessageBlock，標籤可能要重新整理後才會從畫面消失', e);
    }
}

jQuery(async () => {
    S();
    await loadOptionalApis();
    addMenuButton();
    ensurePanel();

    const c = ctx();
    const ev = c.eventSource;
    const T = c.eventTypes || c.event_types;
    ev.on(T.CHAT_CHANGED, onChatChanged);
    ev.on(T.MESSAGE_RECEIVED, onMessageReceived);
    if (T.CHARACTER_MESSAGE_RENDERED) ev.on(T.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
    ev.on(T.MESSAGE_SWIPED, onSwiped);
    ev.on(T.MESSAGE_DELETED, onDeleted);
    if (T.GENERATION_STARTED) ev.on(T.GENERATION_STARTED, updateInjection);

    updateInjection();
    console.log('[Nova無限流] 已載入');
});
