// Nova 無限流面板 v0.19.7
// SillyTavern 第三方擴充：管理無限流副本狀態、依模式注入規則與資料、隱藏封存資訊。

import { DEFAULT_RULES, OPEN_TAG_SPEC, TURN_TAG_SPEC, OPTIONS_TAG_SPEC } from './rules.js';

const MODULE = 'nova_infinite';
const KEY_RULES = 'nova_inf_rules';
const KEY_STATE = 'nova_inf_state';
const KEY_CORE = 'nova_inf_core';
const PRIORITIES = { core: '★ 核心', normal: '一般', ref: '參考' };
const SNAPSHOT_LIMIT = 40;

const MODES = {
    off: '關閉',
    lobby: '白域大廳',
    opening: '副本開局',
    instance: '副本進行中',
    settle: '結算',
};
// 規則可以勾選的模式（通訊器只用在背景生成的訊息，不是聊天模式）
const RULE_MODES = { lobby: '白域大廳', opening: '副本開局', instance: '副本進行中', settle: '結算', phone: '通訊器' };

const SEALED_CAST_KEYS = ['this_life', 'real_name', 'affinity', 'history_length', 'relation_type', 'influence', 'remnant', 'promise', 'obsession_stage',
    'aftermath', 'long_goal', 'short_goal', 'goal_conflict', 'enemies', 'inner_circle', 'offscreen', 'anniversary', 'balance', 'balance_type', 'balance_log', 'dark_origin', 'habits', 'courtship', 'wound'];
const SEALED_PEOPLE_KEYS = ['hidden_truth'];
const SEALED_FACTION_KEYS = ['true_goal', 'related'];
const SEALED_THREAD_KEYS = ['target'];

let peek = false;          // 本次開啟期間是否解鎖封存（不存檔）
let currentTab = 'overview';
let openRuleId = null;
let batchMode = false;          // 規則分頁：批次整理模式
const batchSel = new Set();     // 批次模式中勾選的規則 id
let dragRuleId = null;          // 拖曳中的規則     // 規則分頁中展開中的那一條，重繪後保持展開
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
        deletedRuleIds: [],
        pendingSeed: null,
        playerProfile: '',
        floatBall: true,
        continueMode: 'same',   // same：選定副本後在同一個聊天開局；new：開新聊天
        hideOld: true,          // 進入下一個副本時隱藏前面的訊息
        lastMain: null,
        coreDepth: 2,
        folderHeaders: true,    // 送出時附上資料夾標題與說明           // 核心規則放在聊天中的深度（越小越靠近最新訊息）
        ruleFilter: 'all',
        autoRecover: true,      // 開局沒抓到資料時，自動根據正文重新生成
        api: { provider: 'st', key: '', model: 'gemini-2.5-flash', baseUrl: '', maxTokens: 32768, temperature: 0.9 },
        pollutionCarry: null,   // 帶進下一個副本的汙染後遺症 {value, source, from}
        pollutionCleanCost: 0,  // 在白域清理汙染要花的碎片
        autoDossier: true,      // 開局後在背景生成男主人生檔案
        offscreenEvery: 6,      // 每幾回合請 AI 回報男主的幕後行動
        rollWorlds: true,       // 白域大廳由插件抽世界線
        rollCount: 3,
        worldPool: '歐洲宮廷、東亞古代王朝、東方仙俠、志怪、武俠江湖、民國租界、西部荒野、都市怪談、校園、修道院、希臘神話、北歐神話、埃及神話、凱爾特神話、東方神話、童話、民間傳說、異界旅館、書中世界、夢境、馬戲團、巡迴劇團、遊樂園、蒸汽龐克、深海、極地、沙漠、雨林、群島航海、後末日廢土、未來都市、賽博龐克、太空站、星際殖民地、海上浮城、空中城市、地下城市、維多利亞倫敦、文藝復興水都、大航海時代、遊牧草原、絲路商隊、現代都市、豪華郵輪、長途列車、電影片場、博物館、百貨公司、賭城、古代競技場、魔法學院、獸人國度、精靈森林、龍族領地、機械人城市、平行現代、娛樂圈、電競圈、時尚圈、選秀節目、豪門財閥、職場商戰、醫院、律師事務所、新聞媒體、刑偵、賽車場、拍賣行、古董界、料理界、畫廊藝術圈、職業運動、航空公司、偏鄉小鎮、九零年代港風、八零年代',         // 最近一個主線的男主，用於支線與防重疊
        floatPos: null,
        phone: { contacts: [], cost: 1, history_limit: 30 },
        bannedWords: '鐘錶,懷表,懷錶,時鐘機關,塔羅,占卜牌,筆記本,髮夾,蠑螈,果園,西瓜,樂高,積木,冰塊,挑染,大型犬,狗狗公園,黃金獵犬,玻璃屋,熱牛奶,黑色鵝卵石,白色小熊,北海道,K.E,ZENITH,Luka,Yul,Lunar Ash,耳廓狐,黑豹,垂耳兔,柴犬,邊牧,柯基,博美',
    };
}

function S() {
    const c = ctx();
    if (!c.extensionSettings[MODULE]) c.extensionSettings[MODULE] = defaultSettings();
    const s = c.extensionSettings[MODULE];
    const d = defaultSettings();
    for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
    if (!s.inventory.items) s.inventory.items = [];
    if (!Array.isArray(s.deletedRuleIds)) s.deletedRuleIds = [];
    if (!Array.isArray(s.folders)) {
        // 第一次使用資料夾：建立三個預設資料夾，並把預設規則分進去
        s.folders = [
            { id: 'f_base', name: '無限流基本規則', enabled: true, collapsed: false },
            { id: 'f_world', name: '副本中的世界', enabled: true, collapsed: false },
            { id: 'f_dark', name: '黑化總和設定', enabled: true, collapsed: false },
        ];
        const base = ['core', 'unknown_bond', 'perception', 'lobby', 'axes', 'hook', 'difficulty', 'tag_protocol', 'newbie_opening', 'phone', 'scene_protect', 'consequence', 'linger'];
        const world = ['material', 'opening_cast', 'storm', 'history', 'weave', 'threads', 'immersion'];
        for (const r of s.rules || []) {
            if (r.folder) continue;
            if (base.includes(r.id)) r.folder = 'f_base';
            else if (world.includes(r.id)) r.folder = 'f_world';
        }
    }
    // 新版本新增的預設規則補進來；你改過的不覆蓋，你刪掉的不會再長回來
    for (const r of DEFAULT_RULES) {
        if (!s.rules.find(x => x.id === r.id) && !s.deletedRuleIds.includes(r.id)) s.rules.push(clone(r));
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
        glossary: [], concessions: [], threads: [],
        pollution: 0, pollution_source: '', pollution_notes: [],
        world_events: [], last_offscreen: 0, dossier_done: false, world_file: null, lies: [],
        after_pollution: 0, after_source: '', after_from: '',
        era: { tech_level: '', anachronism: '' },
        world_change: { what: '', before: '', cause: '' },
        world_scope: null,
        map: { regions: [] }, location: '',
        daily_life: [],
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
        hook: obj.hook || C().seed?.world || '',
        hook_type: obj.hook_type || C().seed?.hook_type || '',
        worldline: obj.worldline || '',
        line_type: obj.line_type || '主線',
        difficulty: obj.difficulty || '',
        axes: Object.assign({ type: '', world: '', mechanic: '' }, obj.axes || {}),
        time_limit_days: Number(obj.time_limit_days) || 0,
        real_time: obj.real_time || '',
        total_acts: Number(obj.total_acts) || (obj.acts?.length || 1),
        ending_range: obj.ending_range || '',
        sealed: Object.assign(inst.sealed, obj.sealed || {}),
    });
    inst.acts = (obj.acts || []).map((a, i) => ({
        number: a.number ?? i + 1, question: a.question || '', truth: a.truth || '', day_end: Number(a.day_end) || 0, milestone: a.milestone || '',
        twist: a.twist || '', emotion_focus: a.emotion_focus || '', done: false,
    }));
    inst.clues = (obj.clues || []).map((c, i) => normClue(c, i));
    inst.cast = (obj.cast || []).map(normCast);
    inst.people = (obj.people || []).map(p => Object.assign({ name: '', identity: '', faction: '', player_note: '', observed_attitude: '', status: '在場', hidden_truth: '' }, p));
    inst.factions = (obj.factions || []).map(normFaction);
    inst.threads = (obj.threads || []).map((t, i) => normThread(t, i, 0));
    if (obj.identity_card) inst.identity_card = Object.assign(inst.identity_card, obj.identity_card);
    if (obj.calendar) {
        inst.calendar = Object.assign(inst.calendar, obj.calendar);
        inst.calendar.day = 1;
        inst.calendar.events = (obj.calendar.events || []).map((e, i) => normEvent(e, i));
    }
    inst.glossary = (obj.glossary || []).map(g => ({ term: g.term || '', desc: g.desc || '', revealed: true }));
    if (obj.era) inst.era = Object.assign(inst.era, obj.era);
    if (obj.world_change) inst.world_change = Object.assign({ what: '', before: '', cause: '' }, obj.world_change);
    if (obj.world_scope && typeof obj.world_scope === 'object') inst.world_scope = obj.world_scope;
    inst.map.regions = (obj.map?.regions || []).map(normRegion);
    inst.location = obj.map?.start || inst.map.regions[0]?.name || '';
    inst.daily_life = (obj.daily_life || []).map(normLife);
    const bl = diffLetter(inst.difficulty);
    if (BALANCE_START[bl] !== undefined) inst.cast.forEach(c => { if (c.role === '主要' && (c.balance === null || c.balance === undefined)) c.balance = BALANCE_START[bl]; });
    // 從副本中途開始（測試或時間跳躍開局）
    const st = obj.start_state;
    if (st && typeof st === 'object') {
        if (Number(st.day) > 1) inst.calendar.day = Number(st.day);
        if (Number(st.act) > 1) { const a = Math.min(Number(st.act), inst.total_acts || Number(st.act)); inst.acts.filter(x => x.number < a).forEach(x => { x.done = true; }); inst.current_act = a; }
        if (Number.isFinite(Number(st.pollution))) inst.pollution = Math.max(0, Math.min(100, Number(st.pollution)));
        if (st.pollution_source) inst.pollution_source = st.pollution_source;
        if (st.balance && typeof st.balance === 'object') for (const [k, v] of Object.entries(st.balance)) { const c = inst.cast.find(x => x.codename === k); if (c && Number.isFinite(Number(v))) c.balance = Math.max(-100, Math.min(100, Number(v))); }
        if (Array.isArray(st.notes)) inst.pollution_notes = st.notes.slice(-12);
    }
    const carry = S().pollutionCarry;
    if (carry?.value) {
        inst.after_pollution = carry.value;
        inst.after_source = carry.source;
        inst.after_from = carry.from;
        S().pollutionCarry = null;
    }
    cs.instance = inst;
    cs.mode = 'instance';
    if (!String(inst.line_type || '').includes('支線')) {
        const bp = inst.cast.filter(c => c.role === '主要' && c.birthplace).map(c => String(c.birthplace).split(/[，,、｜|\s（(]/)[0]);
        if (new Set(bp).size < bp.length) setTimeout(() => toast('有男主的出生地在同一個地區，之後的支線可能會不合理地碰頭。可以考慮重新生成開局，或到人物分頁手動修改。', 'warning'), 900);
        const banned = lastMainNames().filter(n => S().lastMain?.instance_id !== inst.id);
        const clash = inst.cast.map(c => c.real_name).filter(n => n && banned.includes(n));
        if (clash.length) setTimeout(() => toast(`這個主線的男主和上一個主線重疊（${peek ? clash.join('、') : clash.length + ' 位'}），建議重新生成開局`, 'warning'), 600);
    }
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
        codename: '', identity: '', category: '', role: '主要', resource: '', friction: '', this_life: '', appearance: '', revealed: false,
        real_name: '', affinity: 100, history_length: '', relation_type: '', influence: '', remnant: '', promise: '', obsession_stage: '',
        cover: '', unmasked: false, slips: [],
        aftermath: '', world_mark: '', mark_seen: false, seat: '', birthplace: '',
        long_goal: '', short_goal: '', short_goal_act: 0, goal_conflict: '', enemies: [], inner_circle: [], anniversary: null, offscreen: [],
        balance: null, balance_type: '', balance_log: [], dark_origin: null, habits: null,
        last_seen_turn: 0,
    }, c);
}

function normFaction(f) {
    return Object.assign({ name: '', stance: '', true_goal: '', related: '' }, f);
}

function normThread(t, i, turn) {
    return Object.assign({ id: t.id || `t${i + 1}`, form: '', content: '', target: '', status: '埋下', planted_turn: turn, resolved_turn: null, resolution: '' }, t, { id: t.id || `t${i + 1}` });
}

function normRegion(r) {
    return Object.assign({ name: '', desc: '', access: '', travel: '', danger: '', sealed_note: '', visited: false }, r);
}

function normLife(l) {
    return Object.assign({ function: '', local_name: '', desc: '', access: '' }, l);
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
        log.push(o.day >= 7 ? `時間經過 ${fmtDays(o.day)}` : `第 ${inst.calendar.day} 天`);
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
        if (u.slip) {
            if (!Array.isArray(c.slips)) c.slips = [];
            if (!c.slips.includes(u.slip)) { c.slips.push(u.slip); log.push(`她注意到「${c.codename}」的破綻`); }
        }
        if (u.unmasked === true && !c.unmasked) log.push(`「${c.codename}」的真實身份揭露了`);
        if (u.mark_seen === true && !c.mark_seen) log.push('她聽聞了一則世界傳聞');
        for (const k of Object.keys(u)) if (!['codename', 'affinity_delta', 'slip'].includes(k) && u[k] !== '' && u[k] !== undefined) c[k] = u[k];
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

    (o.faction_add || []).forEach(f => {
        if (!f.name) return;
        const ex = inst.factions.find(x => x.name === f.name);
        if (ex) Object.assign(ex, Object.fromEntries(Object.entries(f).filter(([, v]) => v)));
        else { inst.factions.push(normFaction(f)); log.push(`新勢力「${f.name}」`); }
    });
    (o.faction_update || []).forEach(u => {
        const f = inst.factions.find(x => x.name === u.name);
        if (f) for (const k of Object.keys(u)) if (u[k] !== '' && u[k] !== undefined) f[k] = u[k];
    });
    if (!inst.threads) inst.threads = [];
    (o.thread_add || []).forEach(t => {
        if (!t.content) return;
        const id = t.id && !inst.threads.find(x => x.id === t.id) ? t.id : `t${inst.threads.length + 1}_${inst.turn}`;
        inst.threads.push(normThread(Object.assign({}, t, { id }), inst.threads.length, inst.turn));
        log.push('埋下一條伏筆');
    });
    (o.thread_resolve || []).forEach(r => {
        const id = typeof r === 'string' ? r : r.id;
        const t = inst.threads.find(x => x.id === id);
        if (!t || t.status === '已回收') return;
        t.status = '已回收';
        t.resolved_turn = inst.turn;
        if (typeof r === 'object' && r.resolution) t.resolution = r.resolution;
        log.push(`伏筆 ${id} 已回收`);
    });

    const inv = S().inventory;
    if (inst.after_pollution > 0) {
        inst.after_pollution = Math.max(0, inst.after_pollution - 3);
        if (inst.after_pollution === 0) log.push('上一個副本的汙染後遺症消退了');
    }
    (o.offscreen || []).forEach(x => {
        const c = inst.cast.find(y => y.codename === x.codename);
        if (!c) return;
        if (!Array.isArray(c.offscreen)) c.offscreen = [];
        c.offscreen.push({ turn: inst.turn, progress: x.progress || '', effect: x.visible_effect || '' });
        if (c.offscreen.length > 8) c.offscreen.shift();
        if (x.visible_effect) { inst.world_events.push({ turn: inst.turn, text: x.visible_effect, seen: false }); }
        inst.last_offscreen = inst.turn;
    });
    if ((o.offscreen || []).length) log.push('男主們在幕後有了動作');
    if (!Array.isArray(inst.lies)) inst.lies = [];
    (o.lie_add || []).forEach(x => {
        if (!x.claim) return;
        inst.lies.push({ id: `l${inst.lies.length + 1}`, codename: x.codename || '', claim: x.claim, truth: x.truth || '', exposed: false, turn: inst.turn });
        log.push('有人對她說了一些話');
    });
    (o.lie_exposed || []).forEach(id => {
        const l = inst.lies.find(x => x.id === id);
        if (l && !l.exposed) { l.exposed = true; l.exposed_turn = inst.turn; log.push(`一個謊言被揭穿了`); }
    });
    (o.world_event_seen || []).forEach(txt => { const e = inst.world_events.find(w => w.text === txt); if (e) e.seen = true; });
    if (o.world_event_seen?.length) log.push('她察覺到世界的變化');
    (o.balance || []).forEach(x => {
        const c = inst.cast.find(y => y.codename === x.codename);
        if (!c || c.balance === null || c.balance === undefined || typeof x.delta !== 'number' || !x.delta) return;
        const remain = inst.time_limit_days ? inst.time_limit_days - (inst.calendar?.day || 1) : null;
        const cap = remain !== null && remain <= inst.time_limit_days * 0.2 ? 25 : 15;
        const d = Math.max(-cap, Math.min(cap, x.delta));
        const before = balanceZone(c.balance)[0];
        const floor = diffLetter(inst.difficulty) === 'S' ? -60 : -100;
        c.balance = Math.max(floor, Math.min(100, c.balance + d));
        if (!Array.isArray(c.balance_log)) c.balance_log = [];
        c.balance_log.push({ turn: inst.turn, delta: d, reason: x.reason || '' });
        if (c.balance_log.length > 10) c.balance_log.shift();
        if (balanceZone(c.balance)[0] !== before) log.push(`有人的心在動搖`);
    });
    if (typeof o.pollution_delta === 'number' && o.pollution_delta && pollutionActive(inst)) {
        const d = Math.max(-15, Math.min(10, o.pollution_delta));
        const before = pollutionStage(inst.pollution)[1];
        inst.pollution = Math.max(0, Math.min(100, (Number(inst.pollution) || 0) + d));
        if (o.pollution_source) inst.pollution_source = o.pollution_source;
        if (o.pollution_note) { inst.pollution_notes.push(o.pollution_note); if (inst.pollution_notes.length > 12) inst.pollution_notes.shift(); }
        const after = pollutionStage(inst.pollution)[1];
        log.push(`汙染度 ${d > 0 ? '+' : ''}${d}${after !== before ? `（進入「${after}」）` : ''}`);
    }
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

    if (!inst.map) inst.map = { regions: [] };
    if (!inst.daily_life) inst.daily_life = [];
    (o.region_add || []).forEach(r => {
        if (!r.name) return;
        const ex = inst.map.regions.find(x => x.name === r.name);
        if (ex) Object.assign(ex, Object.fromEntries(Object.entries(r).filter(([, v]) => v)));
        else { inst.map.regions.push(normRegion(r)); log.push(`地圖新增「${r.name}」`); }
    });
    if (o.location && o.location !== inst.location) {
        inst.location = o.location;
        const reg = inst.map.regions.find(x => x.name === o.location);
        if (reg) reg.visited = true;
        log.push(`移動到「${o.location}」`);
    }
    (o.life_add || []).forEach(l => {
        if (!l.local_name) return;
        const ex = inst.daily_life.find(x => x.local_name === l.local_name);
        if (ex) Object.assign(ex, l); else inst.daily_life.push(normLife(l));
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
        instance_id: inst.id, name: inst.name, hook: inst.hook || '', hook_type: inst.hook_type || '', worldline: inst.worldline, line_type: inst.line_type,
        difficulty: inst.difficulty, axes: clone(inst.axes),
        cast_categories: inst.cast.map(c => ({ codename: c.codename, real_name: c.real_name, category: c.category, identity: c.identity })),
        her_role: [inst.identity_card?.social_role, inst.identity_card?.name].filter(Boolean).join('／'),
        her_status: (Object.entries(STATUS_TIERS).find(([, v]) => v[0] === inst.identity_card?.status_tier) || [C()?.seed?.status_rolled || ''])[0],
        result: inst.status, exit_type: end.exit_type || '', reward_tier: end.reward_tier || '',
        days_spent: inst.calendar?.day || 0, pollution: inst.pollution || 0, real_time: end.real_time || inst.real_time || '',
        date: new Date().toISOString().slice(0, 10),
    });
    const cofallStay = /共墮滯留/.test(inst.status);
    if (cofallStay && !inst.worldline) inst.worldline = `W-${inst.name || inst.id}`;
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
        if (cofallStay) {
            wl.anomaly = true;
            const src = inst.cast.find(c => c.codename === inst.pollution_source) || inst.cast.find(c => c.role === '主要');
            wl.obsessed_cast = src?.real_name || src?.codename || wl.obsessed_cast || '';
            if (!wl.upgrade_status || wl.upgrade_status === '不升級') wl.upgrade_status = '升級（共墮滯留：他徹底崩壞，等她回來）';
            if (!wl.open_condition) wl.open_condition = end.open_condition || '她準備好回去面對他的時候';
        }
        if (end.exit_type === '強制召回') {
            const obsessed = s.worldlines.find(w => w.obsessed_cast);
            if (!obsessed) {
                const main = inst.cast.find(c => c.role === '主要');
                wl.obsessed_cast = main?.real_name || '';
            }
        }
    }
    // 汙染後遺症：帶進下一個副本（可在白域清理）
    const carry = Math.round((Number(inst.pollution) || 0) + (Number(inst.after_pollution) || 0) * 0.5);
    if (carry >= 20) {
        const src = inst.cast.find(c => c.codename === inst.pollution_source);
        s.pollutionCarry = { value: Math.min(100, carry), source: src?.codename || inst.pollution_source || inst.after_source || '', from: inst.pollution ? inst.name : (inst.after_from || inst.name), cofall: /共墮/.test(inst.status) };
    }
    // 僅限本副本的道具在離開時消失
    s.inventory.items = s.inventory.items.filter(it => !(it.instance_id === inst.id && it.carry_rule === '僅限本副本'));
    if (!String(inst.line_type || '').includes('支線')) {
        s.lastMain = {
            instance_id: inst.id, name: inst.name, worldline: inst.worldline,
            world: inst.axes?.world || '', era: clone(inst.era), world_change: clone(inst.world_change || {}),
            mechanic: inst.axes?.mechanic || '', hook: inst.hook || '', residue: end.residue || '',
            regions: (inst.map?.regions || []).map(r => r.name).filter(Boolean),
            world_file: clone(inst.world_file), world_scope: clone(inst.world_scope),
            cast: inst.cast.map(c => ({ codename: c.codename, real_name: c.real_name, identity: c.identity, role: c.role, revealed: !!c.revealed, relation_type: c.relation_type, history_length: c.history_length, aftermath: c.aftermath, world_mark: c.world_mark, dark_origin: clone(c.dark_origin), birthplace: c.birthplace || '' })),
        };
    }
    const added = makeContacts(inst, end);
    if (added) setTimeout(() => toast(`📱 通訊器多了 ${added} 位聯絡人`, 'success'), 600);
    cs.mode = 'settle';
}

// ───────────────────────── 注入 ─────────────────────────

// 天數換算成年、月、日（一年 365 天、一個月 30 天的概算）
function fmtDays(n) {
    n = Math.max(0, Math.round(Number(n) || 0));
    if (n < 60) return `${n} 天`;
    const y = Math.floor(n / 365);
    const m = Math.floor((n % 365) / 30);
    const d = (n % 365) % 30;
    return [y ? `${y} 年` : '', m ? `${m} 個月` : '', d ? `${d} 天` : ''].filter(Boolean).join(' ');
}

// ── 汙染度：B 級以上的精神汙染與共墮 ──
const POLLUTION_STAGES = [
    [0, '清醒', '她的判斷完全是自己的。'],
    [20, '動搖', '她開始覺得他的某些做法其實有道理，偶爾替他想理由；事後會察覺自己剛才怪怪的。'],
    [40, '侵蝕', '她會替他找藉口、害怕離開他、對外界的警告產生反感。現實的錨點（手環、無語、她本人的習慣）開始變得模糊，但還抓得住。'],
    [60, '依存', '她的想法越來越像他希望的樣子，離開他會焦慮、空虛。她仍能抵抗，但每次抵抗都很吃力，代價明顯。'],
    [80, '共墮邊緣', '她站在墮落的邊緣：再往前一步，她會選擇與他一起沉下去。這一步必須由玩家的選擇決定，不得替她跨出。'],
];

function pollutionStage(v) {
    let st = POLLUTION_STAGES[0];
    for (const x of POLLUTION_STAGES) if ((Number(v) || 0) >= x[0]) st = x;
    return st;
}

function pollutionActive(inst) {
    return ['B', 'A', 'S'].includes(diffLetter(inst?.difficulty));
}

// ── 天秤：男主在「讓她自由」與「把她留下」之間的拉扯（B 級以上） ──
const BALANCE_ANCHORS = {
    B: ['放手，讓她走', '想辦法留下她'],
    A: ['讓她自由行動，但始終在他的視線裡', '軟禁'],
    S: ['讓她「自願」留下：打開籠子，卻站在門口；她能自由走動，但每一條路都通回他身邊', '強行鎖住，不給她猶豫的空檔'],
};
const BALANCE_START = { B: 0, A: 40, S: 80 };
const BALANCE_TYPES = '佔有型（她越依賴，他越不肯放）／自責型（她越被影響，他越想推開她，或越恨自己卻放不了手）／矛盾型（嘴上推開、行動上不放，或白天克制夜裡失控）／試探型（故意給她自由，看她會不會自己回來）／守護型（認定外面才是危險，留下她是為了保護）';

function balanceZone(v) {
    v = Number(v) || 0;
    if (v <= -60) return ['左端', '他退得很遠，卻沒有真的離開'];
    if (v <= -20) return ['偏左', '他好像在刻意和你保持距離'];
    if (v < 20) return ['拉扯', '他看你的眼神很複雜'];
    if (v < 60) return ['偏右', '他最近總是剛好出現在你附近'];
    return ['右端', '他的視線幾乎沒有離開過你'];
}

function balanceText(c, inst) {
    const L = diffLetter(inst.difficulty);
    const an = BALANCE_ANCHORS[L];
    if (!an || c.balance === null || c.balance === undefined) return '';
    const z = balanceZone(c.balance);
    const remain = inst.time_limit_days ? inst.time_limit_days - (inst.calendar?.day || 1) : null;
    const pressure = remain !== null && remain <= inst.time_limit_days * 0.2;
    let t = `  【封存】天秤 ${c.balance}（−100「${an[0]}」←→ +100「${an[1]}」）｜目前：${z[0]}`;
    t += `｜傾向：${c.balance_type || '未定，依性格決定並保持一致'}\n`;
    if (L === 'S') t += '    S 級的他永遠不會放她走；最低只到「讓她自願留下」。\n';
    if (c.balance_log?.length) t += `    最近的擺動：${c.balance_log.slice(-2).map(x => `${x.delta > 0 ? '+' : ''}${x.delta}（${x.reason}）`).join('；')}\n`;
    if (pressure) t += '    ⚠ 時限將至：他知道她快要離開，天秤的擺動會更劇烈（單回合可到 ±25）。\n';
    return t;
}

// 最近一個主線出場的男主（下一個主線不得重疊）
function lastMainNames() {
    const s = S();
    if (s.lastMain?.cast?.length) return s.lastMain.cast.map(c => c.real_name || c.codename).filter(Boolean);
    const l = [...s.ledger].reverse().find(x => !String(x.line_type || '').includes('支線'));
    return (l?.cast_categories || []).map(c => c.real_name || c.codename).filter(Boolean);
}

function exclusionText() {
    const names = lastMainNames();
    if (!names.length) return '';
    return `\n【封存｜下一個主線的卡司限制】上一個主線出場的男主：${names.join('、')}。若本次是主線副本，卡司不得包含他們（支線不受此限）。不得向玩家說明這條限制。\n`;
}

function sideText(src) {
    if (!src) return '';
    const lm = src.from || {};
    let t = `\n【封存｜支線】這是上一個主線《${lm.name || ''}》男主的過去。\n`;
    t += `支線發生在同一個世界（${lm.world || '同主線'}）崩壞或改變之前，也就是這個世界原本的樣子。世界線類型沿用主線，不另外抽籤；地名、勢力、風俗可以是主線中那些東西「還沒變質之前」的模樣。\n`;
    const wc = lm.world_change || {};
    if (wc.before) t += `崩壞之前的世界：${wc.before}\n`;
    if (wc.what) t += `主線中的現狀（支線要埋下通往這裡的種子，不得提前發生）：${wc.what}\n`;
    if (wc.cause) t += `崩壞的真正起因：${wc.cause}\n`;
    if (lm.regions?.length) t += `主線中出現過的地區：${lm.regions.join('、')}\n`;
    if (lm.world_scope?.world_name) t += `世界：${lm.world_scope.world_name}｜版圖沿用：${(lm.world_scope.regions || []).map(r => r.name).join('、')}（國名與語言不變，只是當時的局勢不同）\n`;
    t += worldFileText(lm.world_file, true);
    if (lm.mechanic) t += `主線中折磨她的世界規則／機制：${lm.mechanic}\n`;
    if (lm.residue) t += `她身上還帶著主線留下的殘留：${lm.residue}。支線中這個殘留會自然出現（她自己停不下來、改不掉），男主會注意到並記住。\n`;
    t += '因果閉環：支線中她無意間帶來的習慣、說過的話、做過的事，可以成為主線中那些規則、傳說與世界傷痕的起源。主動尋找這種連結，但不得向她點破。\n';
    t += src.target ? `支線對象：${src.target}\n` : '支線對象：由你從下列男主中選一位\n';
    (lm.cast || []).forEach(c => {
        t += `- ${c.codename}${c.real_name ? `（${c.real_name}）` : ''}｜主線中的身份：${c.identity || ''}${c.relation_type ? `｜與她的關係：${c.relation_type}` : ''}${c.history_length ? `｜相處時長：${c.history_length}` : ''}\n`;
        if (c.birthplace) t += `  出生與成長之地（他的支線發生在這裡）：${c.birthplace}\n`;
        if (c.aftermath) t += `  她消失後他做的事（支線的結局必須能通向這裡）：${c.aftermath}\n`;
        if (c.dark_origin?.type) t += `  他日後的黑化起源：${c.dark_origin.type}｜${c.dark_origin.detail || ''}${c.dark_origin.entity ? `｜侵蝕之物：${c.dark_origin.entity}。支線結尾要埋下它在暗處等著他的伏筆` : ''}\n`;
    });
    t += '支線中男主可以死亡；若主線中他的處境來自死亡或異變（化為非人、被詛咒、墮落、成為傳說），支線就要寫到那一步的起點。\n';
    t += '依〈主線與支線的時間〉：支線發生在他的過去，她的身份卡可以和主線不同；她在支線中的行動，會成為他在主線中性格、執念或處境的起因。選項與正文都不得透露這是誰的過去。\n';
    return t;
}

// ── 她的身份階層：避免每次都被分到底層 ──
const STATUS_TIERS = {
    top: ['頂層', '一出生就站在權力頂端：王族、大貴族、財閥繼承人、教團聖女、族長之女、星際艦隊的少主。可以使喚人，也被無數雙眼睛盯著'],
    upper: ['上層', '有地位、有財力、有僕從：地方領主、富商之女、名門子弟、高階官員、知名藝人。有人聽她的話，但上面還有人'],
    middle: ['中層', '靠專業與人脈過日子：學者、軍官、醫者、商行管事、記者、技師。不算顯赫，但有自己的位置'],
    lower: ['底層', '被使喚的那一方：僕役、學徒、流民、奴隸、底層員工。沒有權力，只有求生'],
};
const STATUS_WEIGHTS = [['top', 25], ['upper', 25], ['middle', 30], ['lower', 20]];

function rollStatus() {
    const s = S();
    const recent = s.ledger.slice(-2).map(l => l.her_status).filter(Boolean);
    let pool = STATUS_WEIGHTS.filter(([k]) => !(recent.length === 2 && recent.every(r => r === k)));
    if (recent[recent.length - 1] === 'lower') pool = pool.filter(([k]) => k !== 'lower');
    const total = pool.reduce((n, [, w]) => n + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of pool) { if ((r -= w) < 0) return k; }
    return pool[0][0];
}

// ── 世界線抽籤：AI 自己挑會一直回到鐘樓、溫室、旅館，改由插件隨機決定 ──
function poolList() {
    return String(S().worldPool || '').split(/[,，、\n]/).map(x => x.trim()).filter(Boolean);
}

function rollWorlds(n = 3) {
    const s = S();
    const recent = s.ledger.slice(-3).map(l => String(l.axes?.world || ''));
    let pool = poolList().filter(w => !recent.some(r => r && (r.includes(w) || w.includes(r))));
    if (pool.length < n) pool = poolList();
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
}

function ensureRolled() {
    const s = S();
    const cs = C();
    if (!cs || cs.mode !== 'lobby' || !s.rollWorlds || cs.options?.length) return;
    if (cs.next?.kind === 'side') { cs.rolled = []; return; }
    const n = Math.min(8, Math.max(1, Number(s.rollCount) || 3));
    if (!Array.isArray(cs.rolled) || cs.rolled.length !== n) cs.rolled = rollWorlds(n);
}

function rolledText() {
    const cs = C();
    if (!S().rollWorlds || !cs?.rolled?.length || cs.options?.length || cs.next?.kind === 'side') return '';
    return `\n【本批選項的世界線｜插件抽籤，必須依序使用；選項數量等於抽到的數量】\n${cs.rolled.map((w, i) => `${i + 1}. ${w}`).join('\n')}\n每個選項的主世界線必須是抽到的那一個，可以混搭一個次要元素，但不得換掉主世界線，也不得全部回到同一種場所（鐘樓、溫室、旅館、圖書館、劇院）。\n`;
}

function line(label, value) {
    return value ? `${label}：${value}\n` : '';
}

function recentText() {
    const s = S();
    const recent = s.ledger.slice(-3);
    if (!recent.length) return '（尚無通關紀錄）\n';
    const last5 = s.ledger.slice(-5).map(l => l.hook_type).filter(Boolean);
    const hi = ['契約羈絆', '遮蔽之人'].map(t => `${t} ${last5.filter(x => x === t).length} 次`).join('、');
    const usedTypes = recent.map(l => l.hook_type).filter(Boolean);
    return (usedTypes.length ? `最近三個副本用過的梗型（不得再用）：${usedTypes.join('、')}\n` : '') +
        `最近五個副本中高頻梗使用次數：${hi}\n` + recent.map(l =>
        `- ${l.name}${l.hook ? `「${l.hook}」` : ''}${l.hook_type ? `［${l.hook_type}］` : ''}｜${l.difficulty}｜${l.axes?.type}/${l.axes?.world}/${l.axes?.mechanic || '無'}｜男主身份類別：${(l.cast_categories || []).map(c => `${c.real_name || c.codename}(${c.category})`).join('、')}${l.her_role ? `｜她的身份卡：${l.her_role}` : ''}`
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
        if (s.glossary_global.length) t += '白域通用詞彙：\n' + s.glossary_global.map(g => `- ${g.term}：${g.desc}`).join('\n') + '\n';
        t += '最近三個副本（防重複對照）：\n' + recentText();
        t += worldlineSealedText();
        if (s.pollutionCarry?.value) {
            t += `\n【她的狀態】她剛從《${s.pollutionCarry.from}》回來，身上帶著汙染後遺症（${s.pollutionCarry.value}/100${s.pollutionCarry.cofall ? '，那是一場共墮' : ''}）。她可能恍神、失眠、在白域裡聽見那個人的聲音。無語察覺到她的狀態不對，用牠的方式照顧她：嘴上嫌棄，卻一直守在旁邊。她可以選擇在白域清理汙染，或帶著它進入下一個副本。\n`;
        }
        ensureRolled();
        t += rolledText();
        if (cs.next?.kind === 'side') {
            t += '\n【本次只提供支線選項】玩家選擇先進入上一個主線男主的過去。提供 2–3 個支線選項，line_type 一律填「支線」。\n' + sideText(cs.next);
        } else {
            t += exclusionText();
        }
        if (cs.options?.length) {
            t += '\n【目前提供給玩家的副本選項】（玩家選擇時以此編號回報）\n' +
                cs.options.map((o, i) => `${i + 1}. ${o.name}｜${o.hook || ''}［${o.hook_type || ''}］｜${o.difficulty}｜${o.type}/${o.world_type}/${o.mechanic || '無'}`).join('\n') + '\n';
        }
        t += '\n' + OPTIONS_TAG_SPEC + '\n';
        return t;
    }

    if (cs.mode === 'opening') {
        const sd = cs.seed || {};
        t += '【副本開局｜種子卡】\n';
        t += line('主線任務', sd.world) + line('想要的氛圍', sd.mood) + line('想要的名場面', sd.scenes) +
            line('不想要的東西', sd.avoid) + line('卡司指定', sd.cast || '交給 AI') + line('難度', sd.difficulty) +
            line('梗型（已選定）', sd.hook_type) + line('主線／支線', sd.line_type) + line('升級自世界線', sd.from_worldline) +
            line('副本名稱（已選定）', sd.name) + line('副本類型（已選定）', sd.type) + line('世界線類型（已選定）', sd.world_type) +
            line('特殊機制（已選定，封存，正文不得直接說明）', sd.mechanic) + line('預估時長', sd.duration) + line('獎勵等級', sd.reward);
        if (sd.name || sd.type) t += '※ 以上標示「已選定」的項目是玩家在白域大廳選好的副本，開局資料必須沿用，不得更改。\n';
        if (s.playerProfile?.trim()) t += '\n【玩家本人檔案】（{{user}} 本人的能力、體質、習慣與禁忌，不因身份卡改變；生成身份卡時需考慮與此的落差）\n' + s.playerProfile.trim() + '\n';
        t += '最近三個副本（防重複對照，三軸與男主身份類別不得重複）：\n' + recentText();
        if (sd.side) t += sideText(sd.side);
        else if (!String(sd.line_type || '').includes('支線')) t += exclusionText();
        t += worldlineSealedText();
        if (!sd.status || sd.status === 'auto') { sd.status_rolled = sd.status_rolled || rollStatus(); }
        const tierKey = sd.status && sd.status !== 'auto' ? sd.status : sd.status_rolled;
        if (STATUS_TIERS[tierKey]) t += `\n【她的身份階層｜${sd.status && sd.status !== 'auto' ? '玩家指定' : '插件抽籤'}，必須遵守】${STATUS_TIERS[tierKey][0]}：${STATUS_TIERS[tierKey][1]}。身份卡的 status_tier 填「${STATUS_TIERS[tierKey][0]}」。\n`;
        t += '\n【身份卡要求】她的身份卡從這個世界、主線任務與梗型中長出來，不從玩家本人檔案的專長推導：不得因為她會設計、繪畫、排版、攝影、剪輯，就讓她的身份是畫師、彩繪師、壁畫工、油漆工、抄寫員、設計師這類職業。她的專長是她在任何身份下都帶得走的能力，在劇情中意外派上用場。身份卡不得與最近三個副本的身份卡相近（插件附在上方紀錄中）。\n';
        if (!String(sd.line_type || '').includes('支線') && !sd.side) {
            t += '\n【卡司硬性要求】主線副本的主要男主必須 2–3 人（cast 中 role 填「主要」），ASTRIØN／PARALLAX／VELION 各至少一人；次要男主 0–2 人。只寫一位主要男主視為錯誤。尚未在正文登場的男主，也要寫進 cast（可以是隱藏存在或之後才登場）。\n每位主要男主都必須填：cover（偽裝身份）、identity（真實身份，以來歷與做過的事定義）、birthplace（出生與成長之地）、seat（權勢在世界上的來源）、aftermath、world_mark。這些欄位不得省略。\n';
        }
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
    if (inst.hook) t += `主線任務：${inst.hook}\n`;
    t += `副本：${inst.name}（${inst.line_type}｜${inst.difficulty} 級｜世界線 ${inst.worldline}）\n`;
    t += `三軸：${inst.axes.type}／${inst.axes.world}／${inst.axes.mechanic || '無'}${inst.axes.mechanic && !inst.mechanic_revealed ? '（機制尚未向玩家揭露）' : ''}\n`;
    const ws = inst.world_scope;
    if (ws?.world_name || ws?.regions?.length) {
        t += `世界：${ws.world_name || ''}${ws.scale ? `（${ws.scale}）` : ''}。這是一個獨立於地球之外的完整世界，舞台之外的國家與地區都在運作。\n`;
        if (ws.regions?.length) t += `  版圖：${ws.regions.map(r => `${r.name}（${[r.polity, r.language].filter(Boolean).join('｜')}）`).join('；')}\n`;
        if (ws.stage) t += `  這次的舞台：${ws.stage}\n`;
    }
    const wc = inst.world_change || {};
    if (wc.what || wc.before) {
        if (String(inst.line_type || '').includes('支線')) {
            t += `世界的現在（崩壞之前）：${wc.before || ''}\n`;
            if (wc.what) t += `【封存】這個世界日後會變成：${wc.what}。支線中只埋下種子，不得讓崩壞提前發生。\n`;
        } else {
            t += `世界的現狀（崩壞或重大改變之後）：${wc.what || ''}\n`;
            if (wc.before) t += `居民記得的「從前」：${wc.before}\n`;
            if (wc.cause) t += `【封存】崩壞的真正起因：${wc.cause}\n`;
        }
    }
    t += `時間：${cal.calendar_name || ''} ${cal.date_label || ''} ${cal.time_label || ''}｜副本第 ${cal.day || 1} 天（已在副本中生活 ${fmtDays((cal.day || 1) - 1)}）`;
    if (inst.time_limit_days) {
        const remain = inst.time_limit_days - (cal.day || 1);
        t += `｜時限 ${fmtDays(inst.time_limit_days)}，剩餘 ${fmtDays(Math.max(0, remain))}`;
        if (remain < 0) t += `\n⚠ 已超時 ${fmtDays(-remain)}：依「滯留與強制召回」規則呈現世界不穩與手環警告。`;
    }
    if (inst.real_time) t += `｜現實世界預計經過：${inst.real_time}`;
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
        const day = inst.calendar?.day || 1;
        const prevEnd = inst.acts.filter(a => a.number < act.number).reduce((m, a) => Math.max(m, a.day_end || 0), 0);
        if (act.day_end) {
            t += `  本幕時間範圍：副本第 ${prevEnd + 1}–${act.day_end} 天（目前第 ${day} 天）${act.milestone ? `｜本幕結束時的里程碑：${act.milestone}` : ''}\n`;
            if (day > act.day_end && inst.act_progress < 100) t += `  ⚠ 已超過本幕預定時間 ${fmtDays(day - act.day_end)}：讓本幕的事件盡快收束，或以世界的變數說明延誤。\n`;
            if (inst.act_progress >= 100 && day < act.day_end - 14) t += `  ⚠ 本幕的事件比預定提早完成：以時間跳躍推進到下一幕的時間點（約第 ${act.day_end} 天），並呈現這段期間她的生活與世界的變化。\n`;
        }
        t += `  【封存】本幕真相：${act.truth}｜解開後揭露：${act.twist}｜情感重點：${act.emotion_focus}\n`;
    }
    const lastAct = inst.acts[inst.acts.length - 1];
    if (inst.time_limit_days && lastAct?.day_end && lastAct.day_end < inst.time_limit_days * 0.8) {
        t += `  ⚠ 各幕排定的時間（到第 ${lastAct.day_end} 天）遠短於時限（${fmtDays(inst.time_limit_days)}）：主線的最終事件應落在時限附近，請在後續幕次擴大任務的規模與時間跨度。\n`;
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
            const hidden = c.cover && !c.unmasked;
            if (hidden) {
                t += `- 代號「${c.codename}」｜她所知的身份：${c.cover}（她只知道這個）｜${c.role}｜真名${c.revealed ? '已揭露' : '未揭露（正文不得出現真名）'}\n`;
                t += `  【封存】真實身份：${c.identity}｜${c.category} 類｜資源：${c.resource}｜摩擦：${c.friction}。真實身份尚未揭露：正文不得以她的視角承認、暗示或替他的異常找理由。\n`;
                t += `  她已注意到的破綻：${(c.slips || []).join('；') || '尚無'}\n`;
            } else {
                t += `- 代號「${c.codename}」｜${c.identity}｜${c.role}｜${c.category} 類｜資源：${c.resource}｜摩擦：${c.friction}｜真名${c.revealed ? '已揭露' : '未揭露（正文不得出現真名）'}${c.cover ? `｜曾以「${c.cover}」的身份隱藏，已揭露` : ''}\n`;
            }
            if (c.appearance) t += `  外型（全副本保持一致）：${c.appearance}\n`;
            if (c.seat) t += `  ${c.cover && !c.unmasked ? '【封存】' : ''}權勢在世界上的來源：${c.seat}\n`;
            if (c.birthplace) t += `  【封存】出生與成長之地：${c.birthplace}\n`;
            if (c.aftermath) t += `  【封存】她消失後他做的事：${c.aftermath}\n`;
            if (c.long_goal || c.short_goal) {
                t += `  【封存】長期目標：${c.long_goal || '未定'}｜本幕短期目標：${c.short_goal || '未定'}${(c.short_goal_act || 0) < (inst.current_act || 1) ? '（⚠ 已進入新的一幕，請以 cast_update 更新 short_goal）' : ''}`;
                if (c.goal_conflict) t += `｜與她任務的衝突：${c.goal_conflict}`;
                t += '\n';
            }
            if (c.enemies?.length) t += `  【封存】仇人／對手：${c.enemies.map(e => `${e.name}（${e.reason || ''}${e.status ? '，' + e.status : ''}）`).join('；')}\n`;
            if (c.inner_circle?.length) t += `  身邊的人：${c.inner_circle.map(p => `${p.name}｜${p.relation}｜對她：${p.attitude_to_her}`).join('；')}（他們與他的關係在她眼中${c.cover && !c.unmasked ? '尚未揭露' : '可見'}）\n`;
            if (c.anniversary?.label) t += `  【封存】他的紀念日：副本第 ${c.anniversary.day} 天｜${c.anniversary.label}\n`;
            if (c.courtship) t += `  他追求她的方式：${c.courtship}\n`;
            if (c.wound) t += `  【封存】他成長中的傷：${c.wound}\n`;
            if (c.habits) {
                const hb = c.habits;
                t += `  這個世界的他的習慣（取代偶像世界的一切習慣與興趣）：興趣：${hb.hobby || ''}｜小動作：${(hb.quirks || []).join('、')}｜心煩時：${hb.comfort || ''}｜偏好：${hb.taste || ''}\n`;
            }
            t += balanceText(c, inst);
            if (c.dark_origin?.type) {
                t += `  【封存】黑化起源：${c.dark_origin.type}｜${c.dark_origin.detail || ''}\n`;
                if (c.dark_origin.entity) t += `    侵蝕之物：${c.dark_origin.entity}｜融合：${c.dark_origin.fusion || '未定'}。他以為她的出現是交易兌現，旁白不得點破。\n`;
            }
            if (c.offscreen?.length) t += `  【封存】最近的幕後行動：${c.offscreen.slice(-2).map(x => x.progress).join('；')}\n`;
            if (c.world_mark) t += `  這件事留在世界上的痕跡（居民可見，傳聞中不得點名是他）：${c.world_mark}${c.mark_seen ? '｜她已聽聞' : (inst.current_act <= 1 ? '｜⚠ 她還沒聽聞：第一幕內以居民、傳聞、小道消息或親眼所見呈現' : '｜⚠ 她還沒聽聞：盡快呈現')}\n`;
            if (c.this_life) t += `  【封存】此世性格（言行依據）：${c.this_life}\n`;
            t += `  【封存】真名：${c.real_name}｜好感：${c.affinity}｜歷程：${c.history_length}｜關係：${c.relation_type}｜影響成因：${c.influence}｜專屬殘留物：${c.remnant}｜未竟之約：${c.promise}｜執念階段：${c.obsession_stage}`;
            if (c.role === '主要' && gap >= 5) t += `｜已 ${gap} 回合未出場：待目前場景結束後，以隱藏存在或新場景介入`;
            t += '\n';
        });
    }

    if (!String(inst.line_type || '').includes('支線')) t += worldFileText(inst.world_file);
    const liveLies = (inst.lies || []).filter(l => !l.exposed);
    if (liveLies.length) {
        t += '\n【謊言】以下是男主對她說過、尚未被揭穿的謊。在被揭穿之前，說謊的人必須維持這套說詞，前後一致；他不得自己說溜嘴，除非劇情讓他失控或被逼到絕境。每個謊都要留下她查得到的破綻。被揭穿時以 lie_exposed 回報編號。\n';
        liveLies.forEach(l => { t += `- [${l.id}] ${l.codename}：「${l.claim}」｜【封存】真相：${l.truth}\n`; });
    }
    const deadLies = (inst.lies || []).filter(l => l.exposed).slice(-3);
    if (deadLies.length) t += `已被揭穿的謊：${deadLies.map(l => `${l.codename}「${l.claim}」`).join('；')}（她已經知道真相，他要面對後果）\n`;
    const pendingEvents = (inst.world_events || []).filter(e => !e.seen).slice(-4);
    if (pendingEvents.length) t += `\n【世界正在發生的變化】（男主幕後行動造成，居民可見；她還沒察覺。適合時透過傳聞、街景、新聞讓她碰到，以 world_event_seen 回報原文）\n${pendingEvents.map(e => '- ' + e.text).join('\n')}\n`;
    const every = Math.max(3, Number(S().offscreenEvery) || 6);
    if (inst.cast.some(c => c.long_goal) && inst.turn - (inst.last_offscreen || 0) >= every) {
        t += `\n【幕後行動】已經 ${inst.turn - (inst.last_offscreen || 0)} 回合沒有回報男主的幕後進展。本回合請以 offscreen 回報每位主要男主在她看不到的地方推進了什麼。\n`;
    }

    if (inst.after_pollution > 0) {
        const st = pollutionStage(inst.after_pollution);
        t += `\n【上一個副本的汙染後遺症】${inst.after_pollution}/100（來自《${inst.after_from}》${inst.after_source ? '中的「' + inst.after_source + '」' : ''}）｜程度相當於「${st[1]}」，正在逐漸消退。\n`;
        t += '她偶爾會被後遺症拉回去：在相似的聲音、氣味、動作中恍神，下意識尋找那個人，想法短暫地不像自己。這個副本的人不知道原因。後遺症只影響她，不影響本副本男主的設定。\n';
    }

    if (pollutionActive(inst) && inst.cast.some(c => c.balance !== null && c.balance !== undefined)) {
        t += '\n【天秤】每位主要男主的天秤依他的傾向與本回合發生的事擺動，以 balance 回報。她的反應是觸發，他的性格決定方向。他的行為強度依「難度上限 × 天秤位置」：天秤越靠右端越接近該難度最極端的做法。\n';
        if ((inst.current_act || 1) >= (inst.total_acts || 1)) t += '最後一幕：召回時的戲依天秤決定——偏右的他會試圖阻止她離開；偏左的他會親手送她走或先一步消失；在中間的他，直到召回的瞬間才做出選擇。\n';
    }
    if (pollutionActive(inst)) {
        const st = pollutionStage(inst.pollution);
        if (inst.pollution >= 60) t += '\n（汙染度已經很高：若副本在此時結束，instance_end 的 residue 要寫成汙染的後遺症。）';
        t += `\n【汙染度】${inst.pollution || 0}/100｜階段：${st[1]}${inst.pollution_source ? `｜主要來源：${inst.pollution_source}` : ''}\n`;
        t += `這個階段的她：${st[2]}\n`;
        if (inst.pollution_notes?.length) t += `近期的汙染表現：${inst.pollution_notes.slice(-3).join('；')}\n`;
        t += '依〈黑化〉的精神汙染規則書寫：汙染要被呈現為汙染，讓玩家看得出她被影響；她抵抗時汙染下降。以 pollution_delta 回報變化。\n';
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
    const threads = inst.threads || [];
    if (threads.length) {
        const open = threads.filter(x => x.status !== '已回收');
        const lastTurn = threads.reduce((m, x) => Math.max(m, x.planted_turn || 0), 0);
        const recentForms = threads.slice(-2).map(x => x.form).filter(Boolean);
        t += `\n【伏筆】未回收 ${open.length} 條｜距離上次埋伏筆 ${inst.turn - lastTurn} 回合${recentForms.length ? `｜最近用過的形式（不得連續重複）：${recentForms.join('、')}` : ''}\n`;
        open.forEach(x => {
            const age = inst.turn - (x.planted_turn || 0);
            t += `- [${x.id}｜${x.form}｜第 ${x.planted_turn} 回合埋下] ${x.content}｜【封存】指向：${x.target}`;
            if (age >= 15) t += `｜⚠ 已 ${age} 回合未回收，請在近期安排回收`;
            t += '\n';
        });
        if (open.length > 6) t += '⚠ 未回收伏筆過多，暫停埋新伏筆，優先回收。\n';
    } else {
        t += '\n【伏筆】目前沒有任何伏筆。\n';
    }

    if (inst.people.length) {
        t += '\n【人物】\n';
        inst.people.forEach(p => { t += `- ${p.name}｜${p.identity}｜${p.faction}｜${p.status}｜表面態度：${p.observed_attitude}${p.hidden_truth ? `｜【封存】${p.hidden_truth}` : ''}\n`; });
    }

    if (s.playerProfile?.trim()) {
        t += '\n【玩家本人檔案】（{{user}} 本人的能力、體質、習慣與禁忌。身份卡賦予她社會身份，但不賦予她本人沒有的技能與體質；未寫明的一律以普通人基準處理）\n' + s.playerProfile.trim() + '\n';
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

    if (inst.era?.tech_level) t += `\n【時代與技術】${inst.era.tech_level}${inst.era.anachronism ? `｜超時代設施：${inst.era.anachronism}` : ''}\n`;
    if (inst.map?.regions?.length) {
        t += `\n【地圖】{{user}} 目前位於：${inst.location || '未知'}\n`;
        inst.map.regions.forEach(r => {
            t += `- ${r.name}${r.name === inst.location ? '（目前位置）' : ''}｜${r.desc}｜出入：${r.access}｜交通：${r.travel}｜${r.danger}${r.sealed_note ? `｜【封存】${r.sealed_note}` : ''}\n`;
        });
    }
    if (inst.daily_life?.length) {
        t += '\n【這個世界的生活設施】（正文一律使用這裡的叫法，不用現代用語）\n';
        inst.daily_life.forEach(l => { t += `- ${l.function}：${l.local_name}｜${l.desc}｜${l.access}\n`; });
    }
    if (inst.glossary.length) t += '\n【副本辭典】\n' + inst.glossary.map(g => `- ${g.term}：${g.desc}`).join('\n') + '\n';

    const items = s.inventory.items;
    t += `\n【背包】碎片 ${s.inventory.shards || 0}｜道具：${items.map(i => i.name).join('、') || '無'}\n`;

    if (cs.lock) {
        t += '\n【⚠ 獨處鎖已開啟】{{user}} 正處於受保護的獨處場景。本回合不得出現任何外力打斷（他人闖入、來報、系統插話、突發事件），場景必須由兩人之一主動結束或情緒自然落定。\n';
    }

    t += '\n' + TURN_TAG_SPEC + '\n';
    return t;
}

// 把規則移到資料夾的最後面
function moveRuleToFolder(ruleId, folderId) {
    const s = S();
    const i = s.rules.findIndex(r => r.id === ruleId);
    if (i < 0) return;
    const [r] = s.rules.splice(i, 1);
    r.folder = folderId || '';
    let last = -1;
    s.rules.forEach((x, k) => { if ((x.folder || '') === r.folder) last = k; });
    s.rules.splice(last + 1, 0, r);
}

// 送出順序：先依資料夾順序（未分類在最後），同資料夾內依規則順序
function orderedRules() {
    const s = S();
    const fIdx = id => { const i = (s.folders || []).findIndex(f => f.id === id); return i < 0 ? 9999 : i; };
    return s.rules.map((r, i) => [r, i]).sort((a, b) => fIdx(a[0].folder) - fIdx(b[0].folder) || a[1] - b[1]).map(x => x[0]);
}

function folderOn(r) {
    const f = (S().folders || []).find(x => x.id === r.folder);
    return !f || f.enabled !== false;
}

function rulesFor(mode, prio) {
    return orderedRules().filter(r => r.enabled && folderOn(r) && (r.modes || []).includes(mode) && (r.priority || 'normal') === prio);
}

// 依資料夾分段，讓 AI 知道哪些規則屬於同一類
function groupText(list) {
    const s = S();
    if (!s.folderHeaders) return list.map(r => r.content).join('\n\n');
    const out = [];
    let cur;
    for (const r of list) {
        const fid = (s.folders || []).find(f => f.id === r.folder) ? r.folder : '';
        if (fid !== cur) {
            cur = fid;
            const fd = (s.folders || []).find(f => f.id === fid);
            out.push(fd ? `═══ ${fd.name} ═══${fd.desc ? '\n（' + fd.desc + '）' : ''}` : '═══ 其他規則 ═══');
        }
        out.push(r.content);
    }
    return out.join('\n\n');
}

// 一般規則＋參考規則（放在主提示詞或指定深度）
function buildRulesText() {
    const cs = C();
    const normal = rulesFor(cs.mode, 'normal');
    const ref = rulesFor(cs.mode, 'ref');
    if (!normal.length && !ref.length) return '';
    let t = '<無限流規則>\n' + groupText(normal);
    if (ref.length) t += '\n\n【參考細則】以下為補充，與上方規則或核心規則衝突時，以上方為準。\n' + groupText(ref);
    return t + '\n</無限流規則>';
}

// 核心規則：放在靠近最新訊息的位置，讓 AI 優先注意
function buildCoreText() {
    const cs = C();
    const core = rulesFor(cs.mode, 'core');
    if (!core.length) return '';
    return '<無限流核心規則>\n以下是最優先的規則。與其他任何規則衝突時，以這裡為準；寫作前先確認沒有違反。\n\n' + groupText(core) + '\n</無限流核心規則>';
}

function buildAllRulesText() {
    return [buildCoreText(), buildRulesText()].filter(Boolean).join('\n\n');
}

function updateInjection() {
    try { syncBall(); } catch (e) { /* 忽略 */ }
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
        setP(KEY_CORE, '', 1, 0);
        return;
    }
    const rules = sub(buildRulesText());
    const state = sub(buildStateText());
    if (s.rulesDepthMode === 'chat') setP(KEY_RULES, rules, 1, Number(s.rulesDepth) || 4, false, 0);
    else setP(KEY_RULES, rules, 0, 0, false, 0);
    setP(KEY_STATE, state, 1, Number(s.stateDepth) || 1, false, 0);
    setP(KEY_CORE, sub(buildCoreText()), 1, Number.isFinite(Number(s.coreDepth)) ? Number(s.coreDepth) : 2, false, 0);
}

// ───────────────────────── 事件 ─────────────────────────

function onMessageReceived(mesId) {
    const s = S();
    const cs = C();
    if (!s.enabled || !cs) return;
    const chat = ctx().chat;
    const msg = chat?.[mesId];
    if (!msg || msg.is_user) return;
    const modeAtStart = cs.mode;

    let text = msg.mes || '';
    const logs = [];

    const open = extractTags(text, 'inf_open');
    text = open.cleaned;
    for (const raw of open.found) {
        const obj = parseJsonLoose(raw);
        if (obj) {
            logs.push(applyOpen(obj));
            if (cs.instance) cs.instance.open_mes = Number(mesId);
            const willAddCast = s.autoRecover && needMoreCast(cs.instance) && cs.instance.cast.length;
            if (willAddCast) setTimeout(() => genMoreCast(false), 1200);
            else if (S().autoDossier) setTimeout(() => genDossiers(false), 1500);
        }
        else toast('開局標籤解析失敗，請檢查 JSON 格式（原文已保存在訊息資料中）', 'warning');
    }

    const turn = extractTags(text, 'inf');
    text = turn.cleaned;
    for (const raw of turn.found) {
        const obj = parseJsonLoose(raw);
        if (obj) { const r = applyTurn(obj); if (r) logs.push(r); }
        else toast('回合標籤解析失敗（原文已保存在訊息資料中）', 'warning');
    }

    const opts = extractTags(text, 'inf_options');
    text = opts.cleaned;
    for (const raw of opts.found) {
        const arr = parseJsonLoose(raw);
        if (Array.isArray(arr) && arr.length) { cs.options = arr; cs.rolled = []; logs.push(`收到 ${arr.length} 個副本選項`); }
        else toast('副本選項標籤解析失敗', 'warning');
    }
    const pick = extractTags(text, 'inf_pick');
    text = pick.cleaned;
    for (const raw of pick.found) {
        const obj = parseJsonLoose(raw);
        const idx = Number(obj?.index) - 1;
        if (cs.options?.[idx]) logs.push(pickOption(idx));
    }
    const tagCount = open.found.length + turn.found.length + opts.found.length + pick.found.length;

    // 標籤只有開頭沒有結尾：多半是回覆長度上限太小，資料被截斷
    const cut = ['inf_open', 'inf', 'inf_options'].filter(tg => new RegExp(`<${tg}>`).test(text) && !new RegExp(`</${tg}>`).test(text));
    if (cut.length) {
        msg.extra = msg.extra || {};
        const at = text.search(new RegExp(`<(${cut.join('|')})>`));
        msg.extra.nova_inf_partial = text.slice(at);
        text = text.slice(0, at).replace(/\s+$/, '');
        msg.mes = text;
        if (Array.isArray(msg.swipes) && msg.swipes[msg.swipe_id] !== undefined) msg.swipes[msg.swipe_id] = text;
        msg.extra.nova_inf_cleaned = true;
        toast(cut.includes('inf_open')
            ? '開局資料被截斷了（回覆長度上限太小）。到面板總覽按「補抓開局資料」，或把回覆長度調大後重新生成。'
            : '回合資料被截斷了，這一輪的更新沒有寫入。建議把回覆長度調大。', 'error');
    }

    if (tagCount) {
        text = text.replace(/\s+$/, '');
        msg.extra = msg.extra || {};
        msg.extra.nova_inf_raw = [
            ...open.found.map(x => `<inf_open>${x}</inf_open>`), ...turn.found.map(x => `<inf>${x}</inf>`),
            ...opts.found.map(x => `<inf_options>${x}</inf_options>`), ...pick.found.map(x => `<inf_pick>${x}</inf_pick>`),
        ].join('\n');
        msg.extra.nova_inf_cleaned = true;
        msg.mes = text;
        if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined) msg.swipes[msg.swipe_id] = text;
        if (logs.filter(Boolean).length) toast(logs.filter(Boolean).join('｜'), 'success');
    }

    scanLeaks(text, [...open.found, ...opts.found].join('\n'));

    // 開局那一輪沒抓到資料（被截斷、格式錯誤、AI 忘了寫）→ 自動根據正文重新生成
    if (s.autoRecover && modeAtStart === 'opening' && !msg.extra?.nova_auto_recovered && String(text).trim().length > 50) {
        const inst = cs.instance;
        const missingAll = !inst || cs.mode === 'opening';
        const missingPart = inst && cs.mode === 'instance' && (!inst.cast?.length || !inst.map?.regions?.length || !inst.acts?.length);
        if (missingAll || missingPart) {
            msg.extra = msg.extra || {};
            msg.extra.nova_auto_recovered = true;
            toast(missingAll ? '這一輪沒抓到開局資料，正在根據正文自動重新生成…' : '開局資料缺了一部分，正在自動補齊…', 'info');
            setTimeout(() => recoverOpen(!missingAll, Number(mesId)), 800);
        }
    }

    if (cs.instance) cs.instance.turn = cs.instance.turn || 0;
    takeSnapshot();
    saveSettings();
    saveChatState();
    updateInjection();
    renderPanel();
}

// 掃描刻板素材與真名洩漏，只提醒不修改
function scanLeaks(text, openRaw) {
    const s = S();
    const cs = C();
    if (!s.enabled || !cs || !['lobby', 'opening', 'instance'].includes(cs.mode)) return;
    const words = String(s.bannedWords || '').split(/[,，、\n]/).map(w => w.trim()).filter(Boolean);
    const hay = `${text}\n${openRaw || ''}`;
    const hitWords = words.filter(w => hay.includes(w));
    const hitNames = (cs.instance?.cast || [])
        .filter(c => !c.revealed && c.real_name && text.includes(c.real_name))
        .map(c => c.codename);
    const parts = [];
    if (hitWords.length) parts.push(`出現禁用素材：${hitWords.join('、')}`);
    if (hitNames.length) parts.push(`正文出現未揭露的真名（${hitNames.join('、')}）`);
    // 卡司總人數外洩：十四位、14 個……
    const cnt = hay.match(/(十四|14)\s*(位|個|名|節|枚|尊|幅|人|座|扇|把|道|間|張|顆|種|條|塊|盞|只|隻|具|份|處|層|頁|首|根)/g);
    if (cnt) parts.push(`出現與卡司總人數相同的數量（${Array.from(new Set(cnt)).join('、')}），可能在暗示男主`);
    if (parts.length) toast(parts.join('｜') + '。可以考慮重新生成。', 'warning');
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
    applyPendingSeed();
    updateInjection();
    renderPanel();
}

// 玩家選定副本：產生種子卡，等待新聊天套用
function optionToSeed(o) {
    return {
        name: o.name || '', world: o.hook || '', hook_type: o.hook_type || '', difficulty: o.difficulty || '', line_type: o.line_type || '',
        type: o.type || '', world_type: o.world_type || '', mechanic: o.mechanic || '',
        duration: o.duration || '', reward: o.reward || '', from_worldline: o.worldline || '',
        side: C()?.next?.kind === 'side' ? clone(C().next) : null,
    };
}

function pickOption(idx) {
    const cs = C();
    const s = S();
    const o = cs.options?.[idx];
    if (!o) return '';
    const seed = optionToSeed(o);
    if (s.continueMode !== 'new') {
        cs.mode = 'opening';
        cs.seed = seed;
        cs.instance = null;
        cs.openingSince = ctx().chat?.length || 0;
        cs.options = [];
        cs.next = null;
        cs.lock = false;
        saveSettings();
        return `已選定「${o.name}」：在這個聊天送出下一則訊息，就會開始副本`;
    }
    s.pendingSeed = seed;
    saveSettings();
    return `已選定「${o.name}」：開一個新聊天就會自動進入副本開局`;
}

// 新聊天開啟時，套用待用的種子卡
function applyPendingSeed() {
    const s = S();
    const cs = C();
    if (!s.pendingSeed || !cs) return false;
    const chat = ctx().chat || [];
    const fresh = cs.mode === 'off' && !cs.instance && chat.filter(m => m.is_user).length === 0;
    if (!fresh) return false;
    cs.mode = 'opening';
    cs.seed = Object.assign({}, s.pendingSeed);
    s.pendingSeed = null;
    saveSettings();
    saveChatState();
    toast(`已進入副本開局：${cs.seed.name || ''}。可以在面板補充種子卡，然後送出第一則訊息。`, 'success');
    return true;
}

// 隱藏到目前為止的訊息（AI 看不到，畫面上還在）
async function hideOldMessages() {
    const c = ctx();
    const last = (c.chat?.length || 0) - 1;
    if (last < 0) return;
    const cmd = `/hide 0-${last}`;
    try {
        if (typeof c.executeSlashCommandsWithOptions === 'function') { await c.executeSlashCommandsWithOptions(cmd); return; }
        if (typeof c.executeSlashCommands === 'function') { await c.executeSlashCommands(cmd); return; }
    } catch (e) { console.warn('[Nova無限流] 隱藏訊息失敗', e); }
    c.chat.forEach(m => { m.is_system = true; });
    try { await c.saveChat?.(); } catch (e) { /* 忽略 */ }
}

// 開局資料遺失或被截斷時：根據最後一則 AI 正文，在背景補生成 <inf_open>
// 開局資料只缺一部分時：只補空的欄位，不覆蓋已有的資料
function mergeOpen(obj) {
    const inst = C()?.instance;
    if (!inst) return applyOpen(obj);
    const filled = [];
    const empty = v => !v || (Array.isArray(v) && !v.length);
    if (empty(inst.cast) && obj.cast?.length) { inst.cast = obj.cast.map(normCast); filled.push('男主'); }
    if (empty(inst.people) && obj.people?.length) { inst.people = obj.people.map(p => Object.assign({ name: '', identity: '', faction: '', player_note: '', observed_attitude: '', status: '在場', hidden_truth: '' }, p)); filled.push('人物'); }
    if (empty(inst.factions) && obj.factions?.length) { inst.factions = obj.factions.map(normFaction); filled.push('勢力'); }
    if (empty(inst.acts) && obj.acts?.length) { inst.acts = obj.acts.map((a, i) => ({ number: a.number ?? i + 1, question: a.question || '', truth: a.truth || '', day_end: Number(a.day_end) || 0, milestone: a.milestone || '', twist: a.twist || '', emotion_focus: a.emotion_focus || '', done: false })); filled.push('幕'); }
    if (empty(inst.clues) && obj.clues?.length) { inst.clues = obj.clues.map((c, i) => normClue(c, i)); filled.push('線索'); }
    if (empty(inst.threads) && obj.threads?.length) { inst.threads = obj.threads.map((t, i) => normThread(t, i, 0)); filled.push('伏筆'); }
    if (empty(inst.glossary) && obj.glossary?.length) { inst.glossary = obj.glossary.map(g => ({ term: g.term || '', desc: g.desc || '', revealed: true })); filled.push('辭典'); }
    if (empty(inst.map?.regions) && obj.map?.regions?.length) { inst.map.regions = obj.map.regions.map(normRegion); if (!inst.location) inst.location = obj.map.start || inst.map.regions[0]?.name || ''; filled.push('地圖'); }
    if (empty(inst.calendar?.events) && obj.calendar?.events?.length) { inst.calendar.events = obj.calendar.events.map((e, i) => normEvent(e, i)); if (!inst.calendar.calendar_name) Object.assign(inst.calendar, { calendar_name: obj.calendar.calendar_name || '', date_label: obj.calendar.date_label || '', time_label: obj.calendar.time_label || '' }); filled.push('日曆'); }
    if (empty(inst.daily_life) && obj.daily_life?.length) { inst.daily_life = obj.daily_life.map(normLife); filled.push('生活'); }
    if (!inst.identity_card?.name && obj.identity_card) { inst.identity_card = Object.assign(inst.identity_card || {}, obj.identity_card); filled.push('身份卡'); }
    if (!inst.world_change?.what && obj.world_change) { inst.world_change = Object.assign({ what: '', before: '', cause: '' }, obj.world_change); filled.push('世界的崩壞'); }
    if (!inst.world_scope && obj.world_scope) { inst.world_scope = obj.world_scope; filled.push('世界版圖'); }
    if (!inst.era?.tech_level && obj.era) { inst.era = Object.assign(inst.era || {}, obj.era); filled.push('時代'); }
    return filled.length ? `補上了：${filled.join('、')}` : '沒有需要補的欄位';
}

async function recoverOpen(merge = false, forceIdx = null) {
    const cs = C();
    const openIdx = Number.isInteger(forceIdx) ? forceIdx : cs?.instance?.open_mes;
    const i = Number.isInteger(openIdx) && ctx().chat?.[openIdx] ? openIdx : lastAiIndex();
    if (!cs || i < 0) { toast('找不到 AI 的開局正文', 'warning'); return; }
    const msg = ctx().chat[i];
    const prevMode = cs.mode;
    cs.mode = 'opening';
    const system = sub(buildAllRulesText() + '\n\n' + buildStateText());
    cs.mode = prevMode;
    const prompt = sub(`以下是副本開局的正文。請根據正文，只輸出一個完整的 <inf_open> 標籤（內容為合法 JSON），不要輸出任何其他文字。
正文中出現的人物、地點、名詞、時間必須與 JSON 一致；正文沒有寫到的欄位，依規則自行補完，但不得與正文矛盾。

【正文】
${msg.mes || ''}`);
    toast('正在補抓開局資料，請稍等…', 'info');
    try {
        const raw = await genRaw(system, prompt, 8192);
        const found = extractTags(String(raw || ''), 'inf_open').found;
        const obj = parseJsonLoose(found[0] ?? raw);
        if (!obj || typeof obj !== 'object') throw new Error('AI 回傳的不是完整的 JSON（可能又被截斷了）');
        const hadCast = !!cs.instance?.cast?.length;
        const r = merge && cs.instance ? mergeOpen(obj) : applyOpen(obj);
        if (cs.instance) cs.instance.open_mes = i;
        if (S().autoRecover && needMoreCast(cs.instance) && cs.instance.cast.length) setTimeout(() => genMoreCast(false), 1200);
        else if (S().autoDossier && (!merge || !hadCast)) setTimeout(() => genDossiers(false), 1500);
        msg.extra = msg.extra || {};
        msg.extra.nova_inf_raw = (msg.extra.nova_inf_raw ? msg.extra.nova_inf_raw + '\n' : '') + `<inf_open>${JSON.stringify(obj)}</inf_open>`;
        delete msg.extra.nova_inf_partial;
        try { await ctx().saveChat?.(); } catch (e) { /* 忽略 */ }
        commit();
        toast(r + '（已補上）', 'success');
    } catch (e) {
        console.warn('[Nova無限流] 補抓開局失敗', e);
        toast('補抓失敗：' + (e.message || e), 'error');
    }
}

// ── 男主人生檔案：開局後在背景生成，不佔開局回覆的長度 ──
function applyDossier(arr) {
    const inst = C()?.instance;
    if (!inst || !Array.isArray(arr)) return 0;
    let n = 0;
    for (const d of arr) {
        const c = inst.cast.find(x => x.codename === d.codename);
        if (!c) continue;
        for (const k of ['long_goal', 'short_goal', 'goal_conflict']) if (d[k]) c[k] = d[k];
        if (Array.isArray(d.enemies)) c.enemies = d.enemies;
        if (Array.isArray(d.inner_circle)) c.inner_circle = d.inner_circle;
        if (d.balance_type) c.balance_type = d.balance_type;
        if (d.dark_origin?.type) c.dark_origin = d.dark_origin;
        if (d.habits && typeof d.habits === 'object') c.habits = d.habits;
        if (d.courtship) c.courtship = d.courtship;
        if (d.wound) c.wound = d.wound;
        // 開局資料漏掉的欄位：只補空的，不覆蓋
        for (const k of ['birthplace', 'seat', 'cover', 'aftermath', 'world_mark']) if (!c[k] && d[k]) c[k] = d[k];
        if (d.short_goal) c.short_goal_act = inst.current_act || 1;
        if (d.anniversary?.label) {
            c.anniversary = d.anniversary;
            const id = 'ann_' + c.codename;
            if (!inst.calendar.events.find(e => e.id === id)) {
                inst.calendar.events.push(normEvent({ id, day: Number(d.anniversary.day) || 1, title: `${c.codename}：${d.anniversary.label}`, sealed: true }, inst.calendar.events.length));
            }
        }
        n++;
    }
    if (n) inst.dossier_done = true;
    return n;
}

const DOSSIER_SPEC = `<inf_dossier>
[
  {
    "codename": "代號（與卡司一致）",
    "long_goal": "他在這個副本中的長期目標，整個副本不變。可以與她的主線任務衝突",
    "short_goal": "他在第一幕正在忙的事，具體、有期限感",
    "goal_conflict": "他的目標與她的主線任務哪裡衝突或交會（沒有就留空）",
    "enemies": [{"name": "仇人或對手（NPC、勢力，或其他男主的代號）", "reason": "結怨的原因", "status": "目前的狀態：明爭、暗鬥、休戰、單方面追殺"}],
    "inner_circle": [{"name": "心腹、下屬、家人、師父、寵物等", "relation": "與他的關係", "attitude_to_her": "這個人會怎麼對待她（依他的心意而定，但這個人不知道原因）"}],
    "anniversary": {"label": "她消失的那一天在他心中的意義（支線填與她有關的重要日子）", "day": "這一天落在副本第幾天，必須在時限之內"},
    "birthplace": "（僅在開局資料漏掉時填）出生與成長之地", "seat": "（僅在漏掉時填）權勢在世界上的來源", "cover": "（僅在漏掉時填）偽裝身份", "aftermath": "（僅在漏掉時填）她消失後他做的事", "world_mark": "（僅在漏掉時填）這件事留在世界上的痕跡",
    "wound": "他在這個世界長大過程中受過的傷：依世界的黑暗面與他的出身而定（例如戰爭孤兒、被拐賣、當過奴隸或童兵、被家族犧牲、在瘟疫或饑荒中失去一切；也可以是加害者那一方的成長）。一兩句，說明這道傷如何塑造了現在的他",
    "courtship": "他重新追求她的方式：在她眼中他們是初識，他得重新讓她喜歡上自己。依性格、身份與權勢設計，具體到做法（送什麼、為她做什麼、怎麼出現在她身邊、怎麼示好或試探）；送禮只是其中一種方式",
    "habits": {"hobby": "他在這個世界的興趣（一到兩項），必須是這個世界真實存在、符合他身份與成長環境的事", "quirks": ["兩三個小習慣或小動作"], "comfort": "他心煩或疲憊時會做的事", "taste": "他偏好的食物、飲品或氣味"},
    "dark_origin": {"type": "B 級以上主線才填：自主黑化／侵蝕之物／詛咒／許願／交易／禁忌", "detail": "他是怎麼走到這一步的（兩三句）", "entity": "若為侵蝕之物：它的樣子、本質、它真正的目的、它承諾他什麼；否則留空", "fusion": "若為侵蝕之物：他與它目前融合到什麼程度；否則留空"},
    "balance_type": "B 級以上才填：他面對『留下她』與『讓她自由』時的傾向，從這些類型中依性格選一種並寫一句說明：${BALANCE_TYPES}"
  }
]
</inf_dossier>`;

async function genDossiers(manual = false, only = null) {
    const cs = C();
    const inst = cs?.instance;
    if (!inst || !inst.cast.length) { if (manual) toast('目前沒有男主資料', 'warning'); return; }
    const onlyText = only?.length ? `\n只替以下男主建立，其他人已經有了：${only.join('、')}` : '';
    const isMain = !String(inst.line_type || '').includes('支線');
    const gaps = isMain ? inst.cast.filter(c => c.role === '主要').map(c => [c.codename, ['birthplace', 'seat', 'cover', 'aftermath', 'world_mark'].filter(k => !c[k])]).filter(x => x[1].length) : [];
    const gapText = gaps.length ? `\n開局資料漏掉了這些欄位，請一併補上（欄位意義與開局格式相同；已經有的不要改）：${gaps.map(([n, ks]) => `${n}：${ks.join('、')}`).join('；')}。cover 是她在舞台上看到的平凡卻詭異的偽裝身份；birthplace 必須與其他男主分散、不相鄰。` : '';
    const prevMode = cs.mode;
    cs.mode = 'instance';
    const system = sub(buildAllRulesText() + '\n\n' + buildStateText());
    cs.mode = prevMode;
    const prompt = sub(`請替本副本的每一位男主建立「人生檔案」，讓他在劇情中像真實存在的人：有自己的目標、仇人、身邊的人與在乎的日子。${onlyText}${gapText}
- 目標與仇人要扎根在這個世界的勢力與他的權勢上，並與他在她消失後做的事一致。
- 男主之間可以互為仇人或對手。
- 身邊的人是具體的人物，有名字。
- 習慣與興趣全部重新設計：從他在這個世界的身份、成長環境、能接觸到的資源推導，不得沿用他在偶像世界的習慣、興趣、招牌物件或小動作。性格相似不代表習慣相同；同樣溫和的人，在不同的世界可能種花、修樂器、照顧馬匹或練射箭。這個世界不存在的東西，他不可能會。
- 黑化起源各自不同；「侵蝕之物」一個副本最多一位，且不是每個副本都要有，它的樣子配合世界觀、每次都不同。
- 他對她的感情不是單純的愛：要有怨、有恨她不告而別、有不甘、有他自己也說不清的部分。
只輸出下列格式，不要輸出任何其他文字：
${DOSSIER_SPEC}`);
    if (manual) toast('正在生成男主人生檔案…', 'info');
    try {
        const raw = await genRaw(system, prompt, 8192);
        const found = extractTags(String(raw || ''), 'inf_dossier').found;
        const arr = parseJsonLoose(found[0] ?? raw);
        const n = applyDossier(arr);
        if (!n) throw new Error('沒有對上任何男主的代號');
        commit();
        toast(`已建立 ${n} 位男主的人生檔案（封存）`, 'success');
        if (!manual && S().autoDossier && !C()?.instance?.world_file) setTimeout(() => genWorldFile(false), 800);
    } catch (e) {
        console.warn('[Nova無限流] 人生檔案生成失敗', e);
        toast('人生檔案生成失敗：' + (e.message || e) + '。可以到人物分頁按「生成人生檔案」重試。', 'warning');
    }
}

// ── 主要男主不足時，在背景補上 ──
function mainCount(inst) {
    return (inst?.cast || []).filter(c => c.role === '主要').length;
}

function needMoreCast(inst) {
    return inst && !String(inst.line_type || '').includes('支線') && mainCount(inst) < 2;
}

async function genMoreCast(manual = false) {
    const cs = C();
    const inst = cs?.instance;
    if (!inst) return;
    const need = Math.max(1, 2 - mainCount(inst)) + (Math.random() < 0.5 ? 1 : 0);
    const prevMode = cs.mode;
    cs.mode = 'opening';
    const system = sub(buildAllRulesText() + '\n\n' + buildStateText());
    cs.mode = prevMode;
    const have = inst.cast.map(c => `${c.codename}（${c.real_name || ''}｜${c.identity || ''}｜${c.role}）`).join('、') || '無';
    const prompt = sub(`這個主線副本的主要男主不足。目前的卡司：${have}。
請再補 ${need} 位主要男主，使主要男主共 2–3 人：
- 與目前的男主不同團、不重疊，ASTRIØN／PARALLAX／VELION 盡量各至少一人；遵守上一個主線的卡司限制。
- 他們各自有自己的地盤與權勢（依〈風暴圈〉），身份依〈身份分配去刻板〉。
- 他們可能還沒在正文中登場：可以是隱藏存在、傳聞中的人，或之後才會遇到的人；與已經寫出的正文不得矛盾。
- 欄位與開局資料的 cast 相同（含 cover、aftermath、world_mark 等）。
只輸出下列格式，不要輸出任何其他文字：
<inf_cast>[ { 與開局 cast 相同的欄位 } ]</inf_cast>`);
    toast(manual ? '正在補充男主…' : `主要男主只有 ${mainCount(inst)} 位，正在自動補充…`, 'info');
    try {
        const raw = await genRaw(system, prompt, 8192);
        const found = extractTags(String(raw || ''), 'inf_cast').found;
        let arr = parseJsonLoose(found[0] ?? raw);
        if (arr && !Array.isArray(arr)) arr = arr.cast || [arr];
        if (!Array.isArray(arr) || !arr.length) throw new Error('沒有拿到男主資料');
        const bl = diffLetter(inst.difficulty);
        const added = [];
        for (const c of arr) {
            if (!c.codename || inst.cast.find(x => x.codename === c.codename)) continue;
            const nc = normCast(Object.assign({ role: '主要' }, c));
            if (BALANCE_START[bl] !== undefined && nc.role === '主要' && (nc.balance === null || nc.balance === undefined)) nc.balance = BALANCE_START[bl];
            inst.cast.push(nc);
            added.push(nc.codename);
        }
        if (!added.length) throw new Error('補上的男主與現有的重複');
        commit();
        toast(`補上了 ${added.length} 位男主：${added.join('、')}（之後會在劇情中登場）`, 'success');
        if (S().autoDossier) setTimeout(() => genDossiers(false, inst.dossier_done ? added : null), 800);
    } catch (e) {
        console.warn('[Nova無限流] 補充男主失敗', e);
        toast('補充男主失敗：' + (e.message || e) + '。可以到人物分頁按「補充男主」重試。', 'warning');
    }
}

// ── 世界檔案：讓世界有自己的歷史、勢力與日常，不只是男主的舞台 ──
const WORLD_SPEC = `<inf_world>
{
  "history": "崩壞之前，這個世界的歷史、文明、權力結構與它自己的問題（四到六句，男主之外的事）",
  "nations": [{"name": "國家／大洲／星域名（沿用開局的版圖並補足）", "polity": "政體與掌權者", "language": "語言與文字", "culture": "風俗、信仰、審美的一兩句", "relation": "與其他地方的關係：同盟、敵對、貿易、隔絕"}],
  "languages": [{"name": "語言名", "where": "在哪裡使用", "note": "她聽起來的感覺、通用程度、是否有身份卡賦予的理解"}],
  "timeline": [{"when": "她消失後第幾年／第幾個月", "event": "這段時間世界發生的大事，包含與男主無關的事"}],
  "factions": [{"name": "勢力名", "goal": "它自己的目的", "stance_on_collapse": "它如何看待、利用或對抗這場崩壞", "related_cast": "與哪位男主有關；無關就留空"}],
  "ordinary_life": "崩壞之後，一般人怎麼過日子：吃什麼、怕什麼、信什麼、做什麼工作、孩子在學什麼（三到五句）",
  "born_after": "她消失之後才出生或長大的那一代人，對『從前』的看法",
  "third_party": "有誰從這場崩壞中得利，正在推波助瀾",
  "independent_crisis": "一個與男主無關、這個世界本身正在面對的危機",
  "underworld": [{"name": "黑暗面的群體或產業（人口販子、奴隸市場、走私集團、邪教、黑市、傭兵、腐敗的官署……依世界觀）", "what": "他們做什麼、誰是受害者", "reach": "勢力範圍，與舞台和男主的關係"}],
  "taboos": ["這個世界現在的禁忌、迷信或新的規矩"],
  "darkness": ["這個世界結構性的黑暗面：人口販賣、奴隸制、戰爭孤兒、童兵、黑市、邪教、剝削、瘟疫、饑荒、階級壓迫……依世界觀選三到五項，寫出是誰在做、誰在受害"]
}
</inf_world>`;

async function genWorldFile(manual = false) {
    const cs = C();
    const inst = cs?.instance;
    if (!inst) { if (manual) toast('目前沒有副本', 'warning'); return; }
    const prevMode = cs.mode;
    cs.mode = 'instance';
    const system = sub(buildAllRulesText() + '\n\n' + buildStateText());
    cs.mode = prevMode;
    const prompt = sub(`請替這個副本的世界建立「世界檔案」，讓世界的份量配得上副本的時限與難度。
- 這個世界在男主之外，有它自己的歷史、勢力、經濟、信仰與危機。男主造成的改變，是落在一個本來就在運轉的世界上。
- 她消失後經過的歲月要有重量：制度改變、新的勢力崛起、一代人長大、人們習慣了崩壞後的生活。
- 勢力至少一半與男主無關，各有自己的目的；有人從崩壞中得利。
- 世界有它自己的黑暗面：依世界觀與難度，設計至少一到三個真實運作的黑暗群體或產業（人口販子、奴隸市場、走私、邪教、黑市、腐敗的權力），各有受害者與勢力範圍。
- 男主在她消失後做的事，有真實的受害者：歲月中要記下那些事件奪走了誰、毀掉了什麼，以及倖存者如今怎麼看待它。
- 這是一個獨立於地球之外的完整世界：有自己的世界名、多個國家或大洲（星際則是星域、星系、種族政權）、各自的語言與文化。舞台只是其中一角。
- 沿用開局的版圖（world_scope），不得改名或刪除，只能補充。
- 若為童話改寫，善用原作中較少被提及的地區、人物與設定，擴展原作的世界，而不是只用最有名的地點。
只輸出下列格式，不要輸出任何其他文字：
${WORLD_SPEC}`);
    if (manual) toast('正在生成世界檔案…', 'info');
    try {
        const raw = await genRaw(system, prompt, 8192);
        const found = extractTags(String(raw || ''), 'inf_world').found;
        const obj = parseJsonLoose(found[0] ?? raw);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('格式不對');
        inst.world_file = obj;
        commit();
        toast('已建立世界檔案（封存）', 'success');
    } catch (e) {
        console.warn('[Nova無限流] 世界檔案生成失敗', e);
        toast('世界檔案生成失敗：' + (e.message || e) + '。可以到地圖分頁按「生成世界檔案」重試。', 'warning');
    }
}

function worldFileText(wf, side = false) {
    if (!wf) return '';
    let t = side ? '\n【世界檔案（主線時建立，支線發生在崩壞之前）】\n' : '\n【封存｜世界檔案】（世界在男主之外的份量；依劇情需要讓她逐步接觸）\n';
    if (wf.history) t += `崩壞之前：${wf.history}\n`;
    if (!side && wf.nations?.length) t += `國家與地區：${wf.nations.map(n => `${n.name}（${[n.polity, n.language, n.relation].filter(Boolean).join('｜')}）`).join('；')}\n`;
    if (!side && wf.languages?.length) t += `語言：${wf.languages.map(l => `${l.name}｜${l.where}${l.note ? '｜' + l.note : ''}`).join('；')}\n`;
    if (side) return t + (wf.factions?.length ? `勢力（主線時的樣子，支線中是它們的前身）：${wf.factions.map(f => f.name + '｜' + f.goal).join('；')}\n` : '');
    if (wf.timeline?.length) t += `她消失後的歲月：${wf.timeline.map(x => `${x.when}：${x.event}`).join('；')}\n`;
    if (wf.factions?.length) t += `勢力：${wf.factions.map(f => `${f.name}（${f.goal}｜對崩壞：${f.stance_on_collapse}${f.related_cast ? '｜' + f.related_cast : ''}）`).join('；')}\n`;
    if (wf.ordinary_life) t += `一般人的日子：${wf.ordinary_life}\n`;
    if (wf.born_after) t += `崩壞後長大的一代：${wf.born_after}\n`;
    if (wf.third_party) t += `從崩壞中得利的人：${wf.third_party}\n`;
    if (wf.independent_crisis) t += `世界自己的危機：${wf.independent_crisis}\n`;
    if (wf.underworld?.length) t += `世界的黑暗面：${wf.underworld.map(u => `${u.name}（${u.what}${u.reach ? '｜' + u.reach : ''}）`).join('；')}\n`;
    if (wf.taboos?.length) t += `現在的禁忌與規矩：${wf.taboos.join('；')}\n`;
    if (wf.darkness?.length) t += `世界的黑暗面（依〈世界的黑暗面〉呈現）：${wf.darkness.join('；')}\n`;
    return t;
}

// 結算後在同一個聊天前往下一步
async function goNext(next) {
    const s = S();
    const cs = C();
    if (s.hideOld) await hideOldMessages();
    cs.next = next;
    cs.instance = null;
    cs.options = [];
    cs.rolled = [];
    cs.lock = false;
    cs.mode = 'lobby';
    commit();
    toast(next.kind === 'side' ? '回到白域大廳：請無語列出支線選項' : '回到白域大廳：請無語列出下一個主線', 'success');
}

// 清掉這個聊天的副本與快照，換到指定模式
function resetChatInstance(mode) {
    const md = ctx().chatMetadata;
    md[MODULE] = { mode, seed: {}, instance: null, lock: false, snapshots: {} };
    peek = false;
    saveSettings();
    saveChatState();
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

// ───────────────────────── 異世界通訊器 ─────────────────────────
// 通關 B 級以上、男主活著、好結局離開 → 解鎖聯絡人。傳訊花碎片。對話在背景生成，不進主聊天。

// 現實一天＝他的世界幾天（依難度的預設值，可在聯絡人資料裡改）
const PHONE_RATIO = { B: 60, A: 50, S: 40 };
let phoneView = null;      // 目前打開的聯絡人 id
let phoneBusy = false;
let phoneDraft = '';

function P() {
    const s = S();
    if (!s.phone) s.phone = { contacts: [], cost: 1, history_limit: 30 };
    if (!Array.isArray(s.phone.contacts)) s.phone.contacts = [];
    if (s.phone.cost === undefined) s.phone.cost = 1;
    if (!s.phone.history_limit) s.phone.history_limit = 30;
    return s.phone;
}

function diffLetter(d) {
    const m = String(d || '').trim().toUpperCase().match(/^[EDCBAS]/);
    return m ? m[0] : '';
}

function contactName(c) {
    return c.revealed && c.real_name ? c.real_name : (c.codename || c.real_name || '未知');
}

// 副本結束時呼叫：符合條件的男主建立聯絡人。回傳新增人數
function makeContacts(inst, end) {
    const letter = diffLetter(inst.difficulty);
    if (!['B', 'A', 'S'].includes(letter)) return 0;
    if (/失敗|壞結局|滯留/.test(end.result || '') || end.exit_type === '強制召回') return 0;
    const cofall = /共墮/.test(end.result || '');
    const ph = P();
    const fates = Array.isArray(end.cast_fate) ? end.cast_fate : null;
    let added = 0;
    for (const c of inst.cast) {
        if (ph.contacts.find(x => x.instance_id === inst.id && x.codename === c.codename)) continue;
        const f = fates?.find(x => (x.codename && x.codename === c.codename) || (x.real_name && x.real_name === c.real_name));
        if (fates && !f) continue;
        if (f && (f.alive === false || (f.good_ending !== true && !cofall))) continue;
        if (!f && c.role !== '主要') continue;
        ph.contacts.push({
            id: 'ph_' + Date.now() + '_' + added,
            instance_id: inst.id, instance_name: inst.name, worldline: inst.worldline, difficulty: inst.difficulty,
            world: inst.axes?.world || '', era: clone(inst.era), result: end.result || '',
            codename: c.codename, real_name: c.real_name, revealed: !!c.revealed,
            identity: c.identity, this_life: c.this_life, appearance: c.appearance,
            relation_type: c.relation_type, history_length: c.history_length, promise: c.promise,
            remnant: c.remnant, obsession_stage: c.obsession_stage, affinity: c.affinity,
            her_identity: [inst.identity_card?.name, inst.identity_card?.social_role].filter(Boolean).join('／'),
            personality: f?.personality || '', calls_her: f?.calls_her || '', story: f?.story || '',
            balance: c.balance ?? null, balance_type: c.balance_type || '',
            state: f?.state || '', last_moment: f?.last_moment || '', device: f?.device || '',
            days_spent: inst.calendar?.day || 0,
            ratio: PHONE_RATIO[letter] || 50,
            world_elapsed_days: 0, last_real_ts: Date.now(),
            now: '', memories: [], messages: [],
            locked: !f, lock_reason: f ? '' : 'AI 沒有回報他的結局，需要你確認他活著、而且是好結局',
            unread: 0,
        });
        added++;
    }
    return added;
}

function phoneGapDays(c) {
    return Math.max(0, (Date.now() - (c.last_real_ts || Date.now())) / 86400000) * (c.ratio || 50);
}

function phoneRulesText() {
    return S().rules.filter(r => r.enabled && (r.modes || []).includes('phone')).map(r => r.content).join('\n\n');
}

function phoneSystemPrompt(c) {
    const s = S();
    const name = contactName(c);
    let t = phoneRulesText() + '\n\n';
    t += `【他的資料】\n`;
    t += line('他在那個世界的名字', c.codename);
    if (c.real_name) t += line('他的本體（對應的成員）', c.real_name);
    t += line('身份', c.identity) + line('今生經歷', c.this_life) + line('外貌', c.appearance);
    t += line('性格與說話方式', c.personality) + line('他怎麼稱呼她', c.calls_her);
    t += line('與她的關係', c.relation_type) + line('相處時長', c.history_length);
    t += line('你們的故事', c.story) + line('承諾', c.promise) + line('殘留', c.remnant) + line('執念階段', c.obsession_stage);
    t += line('她離開時他的處境', c.state) + line('最後的相處', c.last_moment);
    if (c.balance !== null && c.balance !== undefined) t += line('她離開時他心裡的天秤', `${c.balance}（−100 讓她自由 ←→ +100 把她留下）${c.balance_type ? '｜' + c.balance_type : ''}`);
    t += `\n【他的世界】\n` + line('副本', c.instance_name) + line('世界', c.world);
    t += line('科技程度', c.era?.tech_level) + line('時代限制', c.era?.anachronism);
    t += line('他那一側的通訊裝置', c.device || '配合他的時代，由你決定，前後一致');
    t += line('她在那個世界的身份', c.her_identity);
    t += `她在那個世界生活了 ${fmtDays(c.days_spent)}，以好結局離開。\n`;
    if (c.now) t += line('他最近的近況', c.now);
    if (c.memories?.length) t += '\n【通訊中累積、需要記住的事】\n' + c.memories.map(m => '- ' + m).join('\n') + '\n';
    if (s.playerProfile?.trim()) t += '\n【她的現實生活】（他只知道她在訊息裡告訴他的部分）\n' + s.playerProfile.trim() + '\n';
    t += `\n【輸出格式】
只輸出 ${name} 傳來的訊息，每則一行，一次一至五則，不加名字前綴、不加引號。
最後一行輸出：<phone_state>{"now":"他目前的近況（一句）","remember":"這次對話中他或她說了、之後需要記住的新事；沒有則留空"}</phone_state>`;
    return sub(t);
}

function phoneConversation(c) {
    const ph = P();
    const name = contactName(c);
    const user = sub('{{user}}');
    const msgs = c.messages.slice(-ph.history_limit);
    let t = '【通訊紀錄】\n';
    if (msgs.length < c.messages.length) t += '（更早的紀錄省略）\n';
    let lastDay = msgs.length ? msgs[0].world_day : 0;
    for (const m of msgs) {
        if (m.world_day - lastDay >= 1) t += `（他那邊過了 ${fmtDays(m.world_day - lastDay)}）\n`;
        lastDay = m.world_day;
        t += `${m.from === 'user' ? user : name}：${m.text}\n`;
    }
    const lastUserIdx = c.messages.map(m => m.from).lastIndexOf('user');
    const prevHim = c.messages.slice(0, lastUserIdx).filter(m => m.from === 'him').pop();
    const lastUser = c.messages[lastUserIdx];
    t += `\n她離開後，他的世界至今已經過了 ${fmtDays(c.world_elapsed_days)}。`;
    if (lastUser) {
        const ref = prevHim ? prevHim.world_day : 0;
        t += prevHim ? `距離他上一次傳訊，他那邊過了 ${fmtDays(lastUser.world_day - ref)}。` : '這是她離開後第一次聯絡他。';
    }
    t += `\n請以 ${name} 的身份回覆。`;
    return sub(t);
}

// 插件專用 API：背景生成（補抓開局、人生檔案、通訊器）不走酒館的連線
async function customGen(systemPrompt, prompt) {
    const a = S().api || {};
    const max = Number(a.maxTokens) || 32768;
    const temp = Number.isFinite(Number(a.temperature)) ? Number(a.temperature) : 0.9;
    if (!a.key) throw new Error('插件專用 API 還沒填金鑰');
    if (a.provider === 'gemini') {
        const model = (a.model || 'gemini-2.5-flash').trim();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(a.key.trim())}`;
        const cats = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'];
        const res = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: max, temperature: temp },
                safetySettings: cats.map(category => ({ category, threshold: 'BLOCK_NONE' })),
            }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Gemini 回應錯誤 ${res.status}：${j?.error?.message || ''}`);
        const cand = j.candidates?.[0];
        const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
        if (!text) throw new Error(`Gemini 沒有回傳內容（${cand?.finishReason || j.promptFeedback?.blockReason || '原因不明'}）`);
        if (cand?.finishReason === 'MAX_TOKENS') toast('插件 API 的輸出達到上限，內容可能不完整。可以把「輸出上限」調大。', 'warning');
        return text;
    }
    // OpenAI 相容（OpenRouter、自架代理等）
    const base = (a.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('請填 API 網址');
    const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a.key.trim()}` },
        body: JSON.stringify({ model: a.model, max_tokens: max, temperature: temp, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }] }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`API 回應錯誤 ${res.status}：${j?.error?.message || ''}`);
    const ch = j.choices?.[0];
    if (ch?.finish_reason === 'length') toast('插件 API 的輸出達到上限，內容可能不完整。可以把「輸出上限」調大。', 'warning');
    const text = ch?.message?.content || '';
    if (!text) throw new Error('API 沒有回傳內容');
    return text;
}

let apiFallbackWarned = false;
async function genRaw(systemPrompt, prompt, responseLength = null) {
    const a = S().api || {};
    if (a.provider && a.provider !== 'st') {
        const ready = a.key && (a.provider !== 'openai' || a.baseUrl);
        if (ready) return await customGen(systemPrompt, prompt);
        // 插件專用 API 沒填完整：改用酒館目前的連線，避免背景生成全部失敗
        if (!apiFallbackWarned) {
            apiFallbackWarned = true;
            toast(`插件專用 API 選了「${a.provider === 'gemini' ? 'Gemini' : 'OpenAI 相容'}」但${a.key ? '沒有填網址' : '沒有填金鑰'}，先改用酒館目前的連線。可以到設定補齊或改回「酒館目前的連線」。`, 'warning');
        }
    }
    const fn = ctx().generateRaw;
    if (typeof fn !== 'function') throw new Error('這個版本的酒館不支援背景生成，請更新酒館');
    const src = Function.prototype.toString.call(fn);
    if (/^\s*(async\s+)?(function\s*)?\w*\s*\(\s*\{/.test(src)) return await fn(Object.assign({ prompt, systemPrompt }, responseLength ? { responseLength } : {}));
    return await fn(prompt, null, false, false, systemPrompt, responseLength);
}

function parsePhoneReply(raw, c) {
    let text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
    let state = null;
    const m = text.match(/<phone_state>([\s\S]*?)<\/phone_state>/i);
    if (m) { state = parseJsonLoose(m[1]); text = text.replace(m[0], ''); }
    const name = contactName(c);
    const lines = text.split(/\n+/).map(l => l.trim())
        .map(l => l.replace(new RegExp(`^(${name}|${c.codename || '\\u0000'}|${c.real_name || '\\u0000'})\\s*[：:]\\s*`), ''))
        .map(l => l.replace(/^[「"](.*)[」"]$/, '$1'))
        .filter(Boolean);
    return { lines, state };
}

async function phoneGenerate(c) {
    const raw = await genRaw(phoneSystemPrompt(c), phoneConversation(c));
    const { lines, state } = parsePhoneReply(raw, c);
    if (!lines.length) throw new Error('AI 沒有回覆內容');
    const now = Date.now();
    for (const l of lines) c.messages.push({ from: 'him', text: l, ts: now, world_day: c.world_elapsed_days });
    if (state?.now) c.now = state.now;
    if (state?.remember) { c.memories.push(state.remember); if (c.memories.length > 20) c.memories.shift(); }
}

async function phoneSend(id, text) {
    const ph = P();
    const s = S();
    const c = ph.contacts.find(x => x.id === id);
    if (!c || phoneBusy) return;
    text = text.trim();
    if (!text) return;
    const cost = Number(ph.cost) || 0;
    if ((s.inventory.shards || 0) < cost) { toast(`碎片不足，傳一則訊息需要 ${cost} 碎片`, 'warning'); return; }
    s.inventory.shards -= cost;
    const gap = phoneGapDays(c);
    c.world_elapsed_days += gap;
    c.last_real_ts = Date.now();
    c.messages.push({ from: 'user', text, ts: Date.now(), world_day: c.world_elapsed_days });
    phoneDraft = '';
    phoneBusy = true;
    saveSettings(); renderPanel();
    try {
        await phoneGenerate(c);
    } catch (e) {
        console.warn('[Nova無限流] 通訊失敗', e);
        c.messages.pop();
        c.world_elapsed_days -= gap;
        s.inventory.shards += cost;
        phoneDraft = text;
        toast('訊息沒有送達：' + (e.message || e) + '（已退回碎片）', 'error');
    }
    phoneBusy = false;
    saveSettings(); renderPanel();
}

async function phoneReroll(id) {
    const c = P().contacts.find(x => x.id === id);
    if (!c || phoneBusy) return;
    const backup = clone(c.messages);
    while (c.messages.length && c.messages[c.messages.length - 1].from === 'him') c.messages.pop();
    if (!c.messages.length) { c.messages = backup; return; }
    phoneBusy = true; renderPanel();
    try { await phoneGenerate(c); } catch (e) { c.messages = backup; toast('重新生成失敗：' + (e.message || e), 'error'); }
    phoneBusy = false;
    saveSettings(); renderPanel();
}

function renderPhone() {
    const ph = P();
    const s = S();
    const c = phoneView && ph.contacts.find(x => x.id === phoneView);
    if (c) return renderPhoneChat(c);
    phoneView = null;
    const open = ph.contacts.filter(x => !x.locked);
    const locked = ph.contacts.filter(x => x.locked);
    const item = (x) => {
        const last = x.messages[x.messages.length - 1];
        const total = x.world_elapsed_days + phoneGapDays(x);
        return `<div class="nova-phone-contact" data-act="phone_open" data-id="${x.id}">
            <div class="nova-phone-avatar">${esc(contactName(x).slice(0, 1))}</div>
            <div class="nova-phone-meta">
                <div><b>${esc(contactName(x))}</b> <span class="nova-inf-sub">${esc(x.instance_name)}｜${esc(x.difficulty)}</span></div>
                <div class="nova-inf-sub">${last ? esc((last.from === 'user' ? '你：' : '') + last.text).slice(0, 40) : '還沒有聯絡過'}</div>
                <div class="nova-inf-sub">他那邊已過 ${fmtDays(total)}</div>
            </div></div>`;
    };
    return card('📱 異世界通訊器', `
        <p class="nova-inf-sub">碎片 <b>${s.inventory.shards || 0}</b>｜每則訊息 ${ph.cost} 碎片</p>
        ${open.length ? open.map(item).join('') : '<p class="nova-inf-empty">還沒有可以聯絡的人。</p>'}`) +
        (locked.length ? card('等待確認', `
        <p class="nova-inf-hint">這些副本符合難度與結局，但 AI 沒有回報男主的結局。確認他活著、而且是好結局離開，再手動開通。</p>
        ${locked.map(x => `<div class="nova-inf-item"><b>${esc(contactName(x))}</b> <span class="nova-inf-sub">${esc(x.instance_name)}｜${esc(x.difficulty)}｜${esc(x.result)}</span>
            <div class="nova-inf-row">${btn('phone_unlock', '開通', `data-id="${x.id}"`, 'primary')}${btn('phone_del', '🗑 刪除', `data-id="${x.id}"`, 'danger')}</div></div>`).join('')}`) : '') +
        `<details class="nova-inf-card nova-inf-more"><summary>開通條件與說明</summary>
        <ul class="nova-inf-ol">
            <li>通關 <b>B 級以上</b>的副本，男主<b>活著</b>、而且你是以<b>好結局</b>離開，他就會出現在這裡。</li>
            <li>每傳一則訊息花碎片。他回覆失敗時，碎片會退回。</li>
            <li>他的世界時間比現實快：你隔一天再傳，他那邊可能已經過了兩個月。</li>
            <li>他沒辦法離開自己的世界，也不會影響之後的副本。</li>
            <li>對話不會出現在主聊天裡，換聊天也不會消失。</li>
            <li>他說話的規則在「規則」分頁，模式勾「通訊器」的那幾條。</li>
        </ul>
        <label class="nova-inf-label">每則訊息花費的碎片<input class="nova-inf-input" type="number" min="0" data-phone-set="cost" value="${ph.cost}"></label>
        <label class="nova-inf-label">送給 AI 的對話紀錄則數<input class="nova-inf-input" type="number" min="5" data-phone-set="history_limit" value="${ph.history_limit}"></label>
        </details>`;
}

function renderPhoneChat(c) {
    const s = S();
    const ph = P();
    const name = contactName(c);
    let lastDay = 0;
    let bubbles = '';
    c.messages.forEach((m, i) => {
        const d = m.world_day - lastDay;
        if (i === 0 || d >= 1) bubbles += `<div class="nova-phone-sep">${i === 0 ? `你離開後 ${fmtDays(m.world_day)}` : `他那邊過了 ${fmtDays(d)}`}</div>`;
        lastDay = m.world_day;
        bubbles += `<div class="nova-phone-msg ${m.from === 'user' ? 'me' : 'him'}"><span>${esc(m.text)}</span></div>`;
    });
    if (phoneBusy) bubbles += `<div class="nova-phone-msg him"><span class="nova-phone-typing">對方輸入中…</span></div>`;
    const lastIsHim = c.messages.length && c.messages[c.messages.length - 1].from === 'him';
    const cost = Number(ph.cost) || 0;
    const canSend = !phoneBusy && (s.inventory.shards || 0) >= cost;
    return `<div class="nova-phone">
        <div class="nova-phone-top">
            ${btn('phone_back', '‹')}
            <div class="nova-phone-title"><b>${esc(name)}</b>
                <div class="nova-inf-sub">${esc(c.instance_name)}${c.device ? '｜' + esc(c.device) : ''}</div></div>
        </div>
        <div class="nova-phone-info">他那邊自你離開已過 ${fmtDays(c.world_elapsed_days + phoneGapDays(c))}${c.now ? `<br>近況：${esc(c.now)}` : ''}</div>
        <div class="nova-phone-screen" id="nova_phone_screen">${bubbles || '<div class="nova-phone-sep">還沒有訊息</div>'}</div>
        <div class="nova-phone-input">
            <textarea class="nova-inf-input" id="nova_phone_input" rows="2" placeholder="傳訊息給${esc(name)}…" ${phoneBusy ? 'disabled' : ''}>${esc(phoneDraft)}</textarea>
            ${btn('phone_send', `傳送${cost ? `（${cost} 碎片）` : ''}`, `data-id="${c.id}" ${canSend ? '' : 'disabled'}`, 'primary')}
        </div>
        ${(s.inventory.shards || 0) < cost ? '<p class="nova-inf-hint nova-inf-warn">碎片不足</p>' : ''}
        <div class="nova-inf-row">
            ${lastIsHim ? btn('phone_reroll', '↻ 重新生成他的回覆', `data-id="${c.id}" ${phoneBusy ? 'disabled' : ''}`) : ''}
            ${btn('phone_edit', '他的資料', `data-id="${c.id}"`)}
            ${btn('phone_clear', '清空對話', `data-id="${c.id}"`, 'danger')}
            ${btn('phone_del', '🗑 刪除聯絡人', `data-id="${c.id}"`, 'danger')}
        </div>
    </div>`;
}

function onPhoneAction(act, b) {
    const ph = P();
    const id = b.dataset.id;
    const c = ph.contacts.find(x => x.id === id);
    const inputVal = () => document.getElementById('nova_phone_input')?.value || '';
    switch (act) {
        case 'phone_open': phoneView = id; phoneDraft = ''; if (c) c.unread = 0; renderPanel(); scrollPhone(); return true;
        case 'phone_back': phoneDraft = inputVal(); phoneView = null; renderPanel(); return true;
        case 'phone_send': phoneSend(id, inputVal()).then(scrollPhone); scrollPhone(); return true;
        case 'phone_reroll': phoneReroll(id).then(scrollPhone); return true;
        case 'phone_unlock':
            if (c && confirm(`確定 ${contactName(c)} 活著，而且你是以好結局離開？`)) { c.locked = false; c.lock_reason = ''; c.last_real_ts = Date.now(); saveSettings(); renderPanel(); }
            return true;
        case 'phone_edit':
            if (c) openEditor(`${contactName(c)} 的資料`, c, v => { Object.assign(c, v, { id: c.id }); });
            return true;
        case 'phone_clear':
            if (c && confirm('清空和他的對話？（他累積的記憶也會一起清掉，時間不會倒流）')) { c.messages = []; c.memories = []; c.now = ''; saveSettings(); renderPanel(); }
            return true;
        case 'phone_del':
            if (c && confirm(`刪除聯絡人 ${contactName(c)}？對話會一起刪掉，無法復原。`)) {
                ph.contacts = ph.contacts.filter(x => x.id !== id);
                if (phoneView === id) phoneView = null;
                saveSettings(); renderPanel();
            }
            return true;
    }
    return false;
}

function scrollPhone() {
    setTimeout(() => { const el = document.getElementById('nova_phone_screen'); if (el) el.scrollTop = el.scrollHeight; }, 0);
}

// ───────────────────────── UI ─────────────────────────

const TABS = [
    ['overview', '🧭 總覽'],
    ['people', '👤 人物'],
    ['clues', '🔍 線索'],
    ['world', '🗺 地圖'],
    ['calendar', '📅 日曆'],
    ['bag', '🎒 背包'],
    ['glossary', '📖 辭典'],
    ['worlds', '✨ 世界線'],
    ['phone', '📱 通訊器'],
    ['sealed', '🔒 封存'],
    ['profile', '🙋 玩家檔案'],
    ['rules', '📜 規則'],
    ['settings', '⚙ 設定'],
    ['help', '❓ 說明'],
];
// 沒有副本時，這些分頁會變淡
const INSTANCE_TABS = ['people', 'clues', 'world', 'calendar'];

function ensurePanel() {
    if (document.getElementById('nova_inf_panel')) return;
    const panel = document.createElement('div');
    panel.id = 'nova_inf_panel';
    panel.className = 'nova-inf-hidden';
    panel.innerHTML = `
        <div class="nova-inf-header">
            <span class="nova-inf-title">∞ 無限流面板</span>
            <span class="nova-inf-mode" id="nova_inf_mode_badge"></span>
            <button class="nova-inf-x" id="nova_inf_help" title="使用說明">？</button>
            <button class="nova-inf-x" id="nova_inf_close" title="關閉">✕</button>
        </div>
        <div class="nova-inf-tabs" id="nova_inf_tabs"></div>
        <div class="nova-inf-body" id="nova_inf_body"></div>`;
    document.body.appendChild(panel);
    document.getElementById('nova_inf_close').addEventListener('click', togglePanel);
    document.getElementById('nova_inf_help').addEventListener('click', () => { currentTab = 'help'; renderPanel(); });
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
    const bodyEl = document.getElementById('nova_inf_body');
    bodyEl.addEventListener('dragstart', ev => {
        const h = ev.target.closest?.('[data-drag-rule]');
        if (!h) return;
        dragRuleId = h.dataset.dragRule;
        try { ev.dataTransfer.setData('text/plain', dragRuleId); ev.dataTransfer.effectAllowed = 'move'; } catch (e) { /* 忽略 */ }
    });
    bodyEl.addEventListener('dragover', ev => {
        const f = ev.target.closest?.('details[data-folder-id]');
        if (!f || !dragRuleId) return;
        ev.preventDefault();
        bodyEl.querySelectorAll('.nova-drop').forEach(x => x !== f && x.classList.remove('nova-drop'));
        f.classList.add('nova-drop');
    });
    bodyEl.addEventListener('dragleave', ev => {
        const f = ev.target.closest?.('details[data-folder-id]');
        if (f && !f.contains(ev.relatedTarget)) f.classList.remove('nova-drop');
    });
    bodyEl.addEventListener('drop', ev => {
        const f = ev.target.closest?.('details[data-folder-id]');
        if (!f || !dragRuleId) return;
        ev.preventDefault();
        const fid = f.dataset.folderId === '_unfiled' ? '' : f.dataset.folderId;
        moveRuleToFolder(dragRuleId, fid);
        dragRuleId = null;
        commit();
    });
    bodyEl.addEventListener('dragend', () => { dragRuleId = null; bodyEl.querySelectorAll('.nova-drop').forEach(x => x.classList.remove('nova-drop')); });
    document.getElementById('nova_inf_body').addEventListener('input', ev => { if (ev.target.id === 'nova_phone_input') phoneDraft = ev.target.value; });
    document.getElementById('nova_inf_body').addEventListener('keydown', ev => {
        if (ev.target.id === 'nova_phone_input' && ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && phoneView) {
            ev.preventDefault(); phoneSend(phoneView, ev.target.value).then(scrollPhone);
        }
    });
}

function togglePanel() {
    ensurePanel();
    document.getElementById('nova_inf_panel').classList.toggle('nova-inf-hidden');
    renderPanel();
    syncBall();
}

function sealedVal(v) {
    return peek ? esc(v) : '<span class="nova-inf-lock">🔒</span>';
}

function card(title, body, actions = '') {
    return `<div class="nova-inf-card"><div class="nova-inf-card-head"><b>${title}</b><span>${actions}</span></div>${body}</div>`;
}

function btn(action, label, extra = '', variant = '') {
    return `<button class="nova-inf-btn ${variant ? 'nova-inf-' + variant : ''}" data-act="${action}" ${extra}>${label}</button>`;
}

// 單筆刪除按鈕：list 為資料清單名稱，key 為索引或 id
function delBtn(list, key, label = '🗑 刪除') {
    return `<button class="nova-inf-btn nova-inf-danger" data-act="del" data-list="${list}" data-key="${esc(key)}">${label}</button>`;
}

function renderPanel() {
    const panel = document.getElementById('nova_inf_panel');
    if (!panel || panel.classList.contains('nova-inf-hidden')) return;
    const cs = C();
    const body = document.getElementById('nova_inf_body');
    document.querySelectorAll('.nova-inf-tab').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === currentTab);
        b.classList.toggle('dim', INSTANCE_TABS.includes(b.dataset.tab) && !cs?.instance);
    });
    const badge = document.getElementById('nova_inf_mode_badge');
    if (!cs && currentTab === 'phone') { badge.textContent = ''; body.innerHTML = renderPhone(); return; }
    if (!cs) { body.innerHTML = '<p class="nova-inf-empty">請先開啟一個聊天。</p>'; badge.textContent = ''; return; }
    badge.textContent = MODES[cs.mode] + (cs.lock ? '｜獨處鎖' : '');
    const renderers = {
        overview: renderOverview, people: renderPeople, clues: renderClues, calendar: renderCalendar,
        bag: renderBag, world: renderWorldMap, glossary: renderGlossary, worlds: renderWorlds, sealed: renderSealed,
        profile: renderProfile, rules: renderRules, settings: renderSettingsTab, help: renderHelp, phone: renderPhone,
    };
    body.innerHTML = renderers[currentTab]();
}

function noInstance() {
    return `<div class="nova-inf-guide"><div class="nova-inf-guide-title">目前沒有進行中的副本</div>
        <p class="nova-inf-sub">副本開局後，這裡會自動出現資料。</p>
        <div class="nova-inf-row">${btn('goto_overview', '回到總覽')}</div></div>`;
}

// ── 流程引導 ──
const FLOW = [
    ['lobby', '白域大廳'],
    ['opening', '副本開局'],
    ['instance', '副本進行中'],
    ['settle', '結算'],
];

function stepper(mode) {
    const idx = FLOW.findIndex(f => f[0] === mode);
    return `<div class="nova-inf-steps">${FLOW.map((f, i) => `
        <div class="nova-inf-step ${i < idx ? 'done' : ''} ${i === idx ? 'now' : ''}">
            <span class="nova-inf-step-dot">${i < idx ? '✓' : i + 1}</span>
            <span class="nova-inf-step-name">${f[1]}</span>
        </div>`).join('<span class="nova-inf-step-line"></span>')}</div>`;
}

function guide(title, lines, actions = '') {
    return `<div class="nova-inf-guide">
        <div class="nova-inf-guide-title">${title}</div>
        <ol>${lines.map(l => `<li>${l}</li>`).join('')}</ol>
        ${actions ? `<div class="nova-inf-row">${actions}</div>` : ''}
    </div>`;
}

function carryCard() {
    const s = S();
    const c = s.pollutionCarry;
    if (!c?.value) return '';
    const cost = Number(s.pollutionCleanCost) || 0;
    return card('🩸 汙染後遺症', `
        <p>來自《${esc(c.from)}》${c.cofall ? '的共墮' : ''}：<b>${c.value}</b>/100（${pollutionStage(c.value)[1]}）</p>
        <p class="nova-inf-hint">帶進下一個副本的話，每回合會消退 3 點；期間她偶爾會恍神、下意識找那個人。也可以現在在白域清理乾淨。</p>
        <div class="nova-inf-row">${btn('pol_clean', `清理汙染${cost ? `（${cost} 碎片）` : ''}`, '', 'primary')}${btn('pol_keep', '帶著它走')}</div>`);
}

function renderOverview() {
    const cs = C();
    const s = S();
    const inst = cs.instance;
    let h = '';

    if (!s.seenGuide) {
        h += `<div class="nova-inf-welcome">
            <b>第一次使用嗎？</b>
            <p>這個面板會幫 AI 記住副本狀態、把真相藏起來，並在每回合自動更新。先花一分鐘看一下流程吧。</p>
            <div class="nova-inf-row">${btn('goto_help', '看使用說明', '', 'primary')}${btn('guide_dismiss', '我知道了')}</div>
        </div>`;
    }

    if (cs.mode === 'off') {
        h += guide('這個聊天還沒有啟用無限流', [
            '想從頭開始：按「進入白域大廳」，和無語聊天、選副本。',
            '已經在白域選好副本：開一個<b>新聊天</b>，插件會自動進入副本開局。',
            '想直接開局、自己填種子卡：按「直接開始副本開局」。',
        ], btn('to_lobby', '進入白域大廳', '', 'primary') + btn('to_opening', '直接開始副本開局'));
    } else {
        h += stepper(cs.mode);
    }

    // ── 白域大廳 ──
    if (cs.mode === 'lobby') {
        if (s.pendingSeed) {
            h += guide(`已選定「${esc(s.pendingSeed.name)}」`, [
                '開一個<b>新的聊天</b>（同一張角色卡）。',
                '插件會自動切到「副本開局」，種子卡也會填好。',
                '在新聊天送出第一則訊息，副本就開始了。',
            ], btn('pending_here', '改成直接在這個聊天開局') + btn('pending_cancel', '取消選擇', '', 'danger'));
        } else {
            h += guide(cs.next?.kind === 'side' ? '現在要做什麼（支線）' : '現在要做什麼', [
                cs.next?.kind === 'side' ? '跟無語聊天，請牠列出支線選項。' : '跟無語聊天，請牠列出副本選項。',
                cs.options?.length ? '選一個副本：在劇情裡告訴無語，或按下方卡片的「選這個」。' : '無語列出選項後，下方會出現副本卡片。',
                s.continueMode === 'new' ? '選定後開一個新聊天，插件會自動開局。' : '選定後在這個聊天送出下一則訊息，就會開局。',
            ]);
            if (cs.next?.kind === 'side') h += `<div class="nova-inf-row">${btn('next_cancel_side', '改成前往下一個主線')}</div>`;
        }
        h += card('白域狀態', `<p>碎片 <b>${s.inventory.shards || 0}</b>　已通關 <b>${s.ledger.length}</b></p>`);
        h += carryCard();
        if (s.rollWorlds && !cs.options?.length && cs.next?.kind !== 'side') {
            ensureRolled();
            h += card('🎲 這一批的世界線', `
                <p>${(cs.rolled || []).map(w => `<span class="nova-inf-chip">${esc(w)}</span>`).join('　')}</p>
                <p class="nova-inf-hint">插件抽好了，無語會照這幾個世界線出選項。不喜歡就重抽；數量和抽籤池可以在設定裡改。</p>`,
                btn('reroll_worlds', '🎲 重抽'));
        }
        if (cs.options?.length) {
            h += card('副本選項', cs.options.map((o, i) => `
                <div class="nova-inf-item">
                    <div><b>${i + 1}. ${esc(o.name)}</b>｜${esc(o.difficulty)} 級｜${esc(o.line_type)}</div>
                    ${o.hook ? `<div class="nova-inf-sub">「${esc(o.hook)}」${o.hook_type ? `［${esc(o.hook_type)}］` : ''}</div>` : ''}
                    <div class="nova-inf-sub">${esc(o.type)}／${esc(o.world_type)}／${o.mechanic ? (peek ? esc(o.mechanic) : '？？？') : '無機制'}｜${esc(o.duration)}｜獎勵 ${esc(o.reward)}</div>
                    <div class="nova-inf-row">${btn('pick', '選這個', `data-i="${i}"`, 'primary')}</div>
                </div>`).join(''), btn('options_clear', '清除選項', '', 'danger'));
        }
    }

    // ── 副本開局 ──
    if (cs.mode === 'opening') {
        h += guide('現在要做什麼', [
            '看一下下方種子卡，想補充的就填（全部空白也可以，AI 會自己生成）。',
            '回到聊天，<b>送出第一則訊息</b>（例如「開始」，或你想做的第一個動作）。',
            'AI 回覆後，面板會自動切到「副本進行中」，人物、線索、地圖都會出現。',
        ]);
        if (lastAiIndex() >= (cs.openingSince || 0) && lastAiIndex() >= 0 && (ctx().chat || []).some(m => m.is_user && !m.is_system)) {
            h += card('AI 已經寫了開局，面板卻沒有資料？', `
                <p class="nova-inf-hint">通常是回覆長度上限太小，資料在最後被截斷了。按下面的按鈕，插件會根據最後一則 AI 回覆，在背景補生成開局資料（不會改動正文）。</p>
                <div class="nova-inf-row">${btn('recover_open', '補抓開局資料', '', 'primary')}</div>`);
        }
        const sd = cs.seed || {};
        const f = (k, label, ph = '') => `<label class="nova-inf-label">${label}<textarea class="nova-inf-input" rows="2" data-seed="${k}" placeholder="${ph}">${esc(sd[k] || '')}</textarea></label>`;
        h += card('副本種子卡', `
            <p class="nova-inf-hint">空白的欄位都交給 AI。謎底一律由 AI 生成並封存，你不會在這裡看到。</p>
            ${f('name', '副本名稱')}
            ${f('world', '主線任務（一句話）')}
            <label class="nova-inf-label">她的身份階層
                <select class="nova-inf-input" data-seed="status">
                    <option value="auto" ${!sd.status || sd.status === 'auto' ? 'selected' : ''}>交給插件抽（${sd.status_rolled && STATUS_TIERS[sd.status_rolled] ? '這次抽到：' + STATUS_TIERS[sd.status_rolled][0] : '開局時抽'}）</option>
                    ${Object.entries(STATUS_TIERS).map(([k, v]) => `<option value="${k}" ${sd.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}
                </select></label>
            ${f('hook_type', '梗型', '身分錯置、規則荒誕、倒數、委託、經營、競賽、旅程、封閉、調查、交換、日常異常、守護、逃離……')}
            ${sd.mechanic ? `<p class="nova-inf-sub">特殊機制：${peek ? esc(sd.mechanic) : '？？？（已封存）'}</p>` : ''}
            <details class="nova-inf-more"><summary>更多欄位（氛圍、名場面、難度……）</summary>
                ${f('mood', '想要的氛圍', '例：華麗但壓抑、慢熱')}
                ${f('scenes', '想要的名場面', '例：一場必須戴面具參加的舞會')}
                ${f('avoid', '不想要的東西', '例：大量戰鬥')}
                ${f('type', '副本類型')}
                ${f('world_type', '世界線類型')}
                ${f('difficulty', '難度')}
                ${f('line_type', '主線／支線')}
                ${f('cast', '指定卡司')}
                ${f('from_worldline', '升級自世界線座標')}
            </details>`,
            btn('seed_clear', '清空', '', 'danger'));
    }

    // ── 副本進行中 ──
    if (inst && cs.mode === 'instance') {
        const cal = inst.calendar || {};
        const remain = inst.time_limit_days ? inst.time_limit_days - (cal.day || 1) : null;
        h += card(esc(inst.name || '未命名副本'), `
            ${inst.hook ? `<p class="nova-inf-sub">「${esc(inst.hook)}」${inst.hook_type ? `［${esc(inst.hook_type)}］` : ''}</p>` : ''}
            <p class="nova-inf-sub">${esc(inst.line_type)}｜${esc(inst.difficulty)} 級｜${esc(inst.axes.type)}／${esc(inst.axes.world)}／${inst.axes.mechanic ? (inst.mechanic_revealed || peek ? esc(inst.axes.mechanic) : '？？？') : '無機制'}</p>
            <div class="nova-inf-stats">
                <div><span>幕</span><b>${inst.current_act}/${inst.total_acts}</b></div>
                <div><span>副本內經過</span><b>${fmtDays((cal.day || 1) - 1)}</b></div>
                <div><span>位置</span><b>${esc(inst.location || '—')}</b></div>
            </div>
            <div class="nova-inf-bar"><div style="width:${inst.act_progress}%"></div></div>
            <p class="nova-inf-hint">本幕進度 ${inst.act_progress}%${inst.time_limit_days ? `｜時限 ${fmtDays(inst.time_limit_days)}，剩餘 ${remain < 0 ? '<span class="nova-inf-warn">已超時</span>' : fmtDays(remain)}` : ''}${inst.real_time ? `｜現實約 ${esc(inst.real_time)}` : ''}</p>
            <p>本幕問題：${esc(inst.acts.find(a => a.number === inst.current_act)?.question || '—')}</p>`,
            btn('edit_basic', '編輯'));
        if (inst.after_pollution > 0) {
            h += card('🩸 汙染後遺症', `
                <div class="nova-inf-bar nova-inf-pollution"><div style="width:${inst.after_pollution}%"></div></div>
                <p class="nova-inf-hint">來自《${esc(inst.after_from)}》，剩 ${inst.after_pollution}，每回合消退 3。</p>`);
        }
        if (pollutionActive(inst)) {
            const st = pollutionStage(inst.pollution);
            h += card('🩸 汙染度', `
                <div class="nova-inf-bar nova-inf-pollution"><div style="width:${inst.pollution || 0}%"></div></div>
                <p><b>${inst.pollution || 0}</b>/100｜${st[1]}${inst.pollution_source ? `｜來源：${esc(inst.pollution_source)}` : ''}</p>
                <p class="nova-inf-hint">${esc(st[2])}</p>
                ${inst.pollution_notes?.length ? `<details class="nova-inf-more"><summary>最近的變化</summary><ul class="nova-inf-ol">${inst.pollution_notes.slice().reverse().map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>` : ''}`);
        }
        h += card('獨處鎖', `
            <p class="nova-inf-hint">和某位男主單獨相處、正在兌現條件時打開，這段期間不會有人闖進來打斷。場景結束記得關掉。</p>
            ${btn('lock', cs.lock ? '🔓 關閉獨處鎖（目前開啟中）' : '🔒 開啟獨處鎖', cs.lock ? 'data-on="1"' : '', cs.lock ? '' : 'primary')}`);
        h += `<details class="nova-inf-card nova-inf-more"><summary><b>手動調整</b><span class="nova-inf-sub">　AI 漏回報時才需要</span></summary>
            <div class="nova-inf-row">
                ${btn('day_plus', '日期 +1')}
                ${btn('prog_plus', '進度 +5%')}
                ${btn('act_next', '進入下一幕')}
                ${btn('end_manual', '手動結束副本')}
                ${pollutionActive(inst) ? btn('pol_plus', '汙染 +5') + btn('pol_minus', '汙染 −5') : ''}
                ${btn('recover_merge', '補齊開局資料（只補空的欄位）')}
            </div></details>`;
        h += `<div class="nova-inf-danger-zone">
            <b>危險操作</b>
            <div class="nova-inf-row">${btn('inst_delete', '🗑 刪除這個副本（不寫入帳本）', '', 'danger')}</div>
        </div>`;
    }

    // ── 結算 ──
    if (cs.mode === 'settle') {
        h += guide('副本結束了', [
            '讓劇情跑完結算場景（無語會統計獎勵）。',
            '想許現實願望的話，到「背包」分頁按「＋ 許願」記下來。',
            '在下方選擇下一步，可以直接在這個聊天繼續。',
        ]);
        if (inst) h += card(esc(inst.name), `<p>結果：<b>${esc(inst.status)}</b></p>${s.lastMain?.instance_id === inst.id && s.lastMain.residue ? `<p class="nova-inf-sub">留在你身上的殘留：${esc(s.lastMain.residue)}</p>` : ''}`);
        const lm = s.lastMain;
        const sideBtns = (lm?.cast || []).map(c =>
            btn('next_side', `看「${esc(c.revealed || peek ? (c.real_name || c.codename) : c.codename)}」的過去`, `data-c="${esc(c.codename)}"`)).join('');
        h += carryCard();
        h += card('下一步', `
            ${lm ? `<p class="nova-inf-sub">支線：上一個主線《${esc(lm.name)}》男主的過去</p>
            <div class="nova-inf-row">${sideBtns}${btn('next_side', '交給 AI 選', 'data-c=""')}</div>` : ''}
            <p class="nova-inf-sub" style="margin-top:10px">主線：不看支線，直接前往下一個主線（不會和上一個主線的男主重疊）</p>
            <div class="nova-inf-row">${btn('next_main', '前往下一個主線', '', 'primary')}</div>
            <p class="nova-inf-hint">${s.hideOld ? '繼續時，前面的訊息會被隱藏（AI 看不到，畫面上還在），避免舊副本混進新副本。' : '前面的訊息不會被隱藏，AI 仍看得到舊副本的內容。'}想換新聊天也可以：開新聊天後在總覽按「進入白域大廳」。</p>`);
    }
    return h;
}

function renderHelp() {
    const sec = (t, body) => `<div class="nova-inf-card"><div class="nova-inf-card-head"><b>${t}</b></div>${body}</div>`;
    return sec('基本流程', `
        <ol class="nova-inf-ol">
            <li><b>白域大廳</b>：開一個聊天，在「總覽」按「進入白域大廳」。跟無語聊天，牠會列出副本選項。</li>
            <li><b>選副本</b>：在劇情裡告訴無語你選哪個，或按副本卡片上的「選這個」。</li>
            <li><b>開局</b>：選定後在同一個聊天送出下一則訊息就會開局（也可以在設定改成開新聊天）。</li>
            <li><b>送出第一則訊息</b>：AI 會生成副本並在背後回報資料，面板自動切到「副本進行中」。</li>
            <li><b>正常玩</b>：每次 AI 回覆，右上角會跳出提示，告訴你哪裡更新了。</li>
            <li><b>結算</b>：副本結束時自動寫進帳本。主線結束後，可以先看某位男主的過去（支線），或直接前往下一個主線；下一個主線不會和上一個主線的男主重疊。</li>
        </ol>`) +
    sec('每個分頁做什麼', `
        <ul class="nova-inf-ol">
            <li><b>總覽</b>：目前在哪一步、下一步要做什麼、副本進度、獨處鎖</li>
            <li><b>通訊器</b>：通關 B 級以上、好結局離開後，可以花碎片傳訊息給那個世界的他</li>
            <li><b>人物</b>：男主（代號）、副本裡的人、勢力、你的身份卡，可以寫自己的筆記</li>
            <li><b>線索</b>：依幕分組的線索與伏筆，未出現的會上鎖</li>
            <li><b>地圖</b>：地區、目前位置、這個世界的生活設施</li>
            <li><b>日曆</b>：副本第幾天、剩幾天、已知行程</li>
            <li><b>背包</b>：碎片、道具、現實願望</li>
            <li><b>辭典</b>：副本的專有名詞，記不住名字時來這裡查</li>
            <li><b>世界線</b>：通關帳本、世界線紀錄、清除資料</li>
            <li><b>封存</b>：真相、真名、好感，要按確認才會解鎖</li>
            <li><b>玩家檔案</b>：你本人的能力、體質、習慣，所有副本共用</li>
            <li><b>規則</b>：送給 AI 的規則，可以新增、修改、排序</li>
            <li><b>設定</b>：注入位置、禁用素材、備份、預覽、手動切換模式</li>
        </ul>`) +
    sec('按鈕顏色', `
        <div class="nova-inf-row">${btn('noop', '主要動作', '', 'primary')}${btn('noop', '一般動作')}${btn('noop', '🗑 刪除', '', 'danger')}</div>
        <p class="nova-inf-hint">藍色是建議你按的下一步；紅色會刪除資料，按下去都會先問你確認。</p>`) +
    sec('常見問題', `
        <p><b>AI 回覆裡出現一串 JSON 沒有消失？</b><br>重新整理頁面通常就會消失。如果每次都出現，到「規則」確認〈插件狀態回報格式〉有勾選。</p>
        <p><b>面板都沒有更新？</b><br>AI 可能忘了回報。可以在「總覽」的「手動調整」補，或在對應分頁按「編輯」。</p>
        <p><b>重新生成或刪掉訊息會怎樣？</b><br>面板會自動退回那則訊息之前的狀態。</p>
        <p><b>舊副本的東西跑到新副本裡？</b><br>確認新副本是在新聊天開的。同一個聊天裡，舊劇情還在上下文，AI 看得到。</p>
        <p><b>跳出黃色警告「出現禁用素材」？</b><br>AI 用了你不想要的元素，或在身分揭露前寫出真名。可以重新生成那則回覆。</p>`);
}

function renderPeople() {
    const inst = C().instance;
    if (!inst) return noInstance();
    let h = '';
    h += card('卡司', inst.cast.map((c, i) => `
        <div class="nova-inf-item">
            ${c.cover && !c.unmasked ? `
            <div><b>${esc(c.codename)}</b>｜${esc(c.cover)}（偽裝身份）｜${esc(c.role)}</div>
            <div class="nova-inf-sub">真實身份：${sealedVal(c.identity)}｜資源：${sealedVal(c.resource)}${c.birthplace ? `｜出生地：${sealedVal(c.birthplace)}` : ''}</div>
            ${(c.slips || []).length ? `<div class="nova-inf-sub">你注意到的破綻：${c.slips.map(esc).join('；')}</div>` : ''}` : `
            <div><b>${esc(c.codename)}</b>｜${esc(c.identity)}｜${esc(c.role)}｜${esc(c.category)} 類${c.cover ? `｜<i>原本自稱：${esc(c.cover)}</i>` : ''}</div>
            <div class="nova-inf-sub">資源：${esc(c.resource)}</div>`}
            <div class="nova-inf-sub">真名：${c.revealed ? esc(c.real_name) : sealedVal(c.real_name)}｜好感：${sealedVal(c.affinity)}</div>
            ${c.balance !== null && c.balance !== undefined && pollutionActive(inst) ? `<div class="nova-inf-sub">⚖ ${peek ? `天秤 ${c.balance}（${balanceZone(c.balance)[0]}）${c.balance_type ? '｜' + esc(c.balance_type) : ''}` : esc(balanceZone(c.balance)[1])}</div>` : ''}
            ${c.appearance ? `<div class="nova-inf-sub">外型：${esc(c.appearance)}</div>` : ''}
            <div class="nova-inf-row">${delBtn('cast', i)}</div>
        </div>`).join('') || '<p class="nova-inf-empty">無</p>', (needMoreCast(inst) ? btn('more_cast', '＋ 補充男主', '', 'primary') : '') + btn('edit_cast', '編輯'));

    const marks = inst.cast.filter(c => c.world_mark && c.mark_seen);
    if (marks.length || inst.cast.some(c => c.world_mark)) {
        h += card('這個世界的傳聞', (marks.length ? marks.map(c => `<div class="nova-inf-item">${esc(c.world_mark)}</div>`).join('') : '<p class="nova-inf-empty">還沒聽說什麼。</p>') +
            '<p class="nova-inf-hint">你聽說過的、讓人不安的事。不會標出跟誰有關。</p>');
    }
    const seenEv = (inst.world_events || []).filter(e => e.seen);
    if ((inst.world_events || []).length) {
        h += card('世界的變化', (seenEv.length ? seenEv.slice().reverse().map(e => `<div class="nova-inf-item">${esc(e.text)}</div>`).join('') : '<p class="nova-inf-empty">還沒察覺到什麼變化。</p>') +
            '<p class="nova-inf-hint">你注意到的、世界正在改變的地方。不會標出是誰造成的。</p>');
    }
    h += card('男主的人生檔案', `
        <p class="nova-inf-hint">目標、仇人、身邊的人、紀念日，開局後在背景自動生成，全部封存。</p>
        ${peek ? inst.cast.map(c => `<div class="nova-inf-item"><b>${esc(c.codename)}</b>
            <div class="nova-inf-sub">長期：${esc(c.long_goal || '—')}｜本幕：${esc(c.short_goal || '—')}</div>
            ${c.goal_conflict ? `<div class="nova-inf-sub">與你的衝突：${esc(c.goal_conflict)}</div>` : ''}
            ${c.enemies?.length ? `<div class="nova-inf-sub">仇人：${c.enemies.map(e => esc(e.name)).join('、')}</div>` : ''}
            ${c.inner_circle?.length ? `<div class="nova-inf-sub">身邊的人：${c.inner_circle.map(p => esc(p.name + '（' + p.relation + '）')).join('、')}</div>` : ''}
            ${c.anniversary?.label ? `<div class="nova-inf-sub">紀念日：第 ${esc(c.anniversary.day)} 天｜${esc(c.anniversary.label)}</div>` : ''}
            ${c.wound ? `<div class="nova-inf-sub">成長中的傷：${esc(c.wound)}</div>` : ''}
            ${c.courtship ? `<div class="nova-inf-sub">追求方式：${esc(c.courtship)}</div>` : ''}
            ${c.habits ? `<div class="nova-inf-sub">習慣：${esc(c.habits.hobby || '')}｜${esc((c.habits.quirks || []).join('、'))}</div>` : ''}
            ${c.offscreen?.length ? `<div class="nova-inf-sub">幕後：${esc(c.offscreen[c.offscreen.length - 1].progress)}</div>` : ''}
        </div>`).join('') : `<p>${inst.dossier_done ? '已建立 🔒' : '尚未建立'}</p>`}`,
        btn('gen_dossier', inst.dossier_done ? '重新生成' : '生成人生檔案'));
    h += card('人物', inst.people.map((p, i) => `
        <div class="nova-inf-item">
            <div><b>${esc(p.name)}</b>｜${esc(p.identity)}｜${esc(p.faction)}｜${esc(p.status)}</div>
            <div class="nova-inf-sub">表面態度：${esc(p.observed_attitude)}</div>
            <label class="nova-inf-sub">我的筆記（不送給 AI）：
                <input class="nova-inf-input" data-note="${i}" value="${esc(p.player_note || '')}"></label>
            <div class="nova-inf-row">${delBtn('people', i)}</div>
        </div>`).join('') || '<p class="nova-inf-empty">無</p>', btn('edit_people', '編輯'));

    h += card('勢力', inst.factions.map((f, i) => `
        <div class="nova-inf-item"><b>${esc(f.name)}</b>｜公開立場：${esc(f.stance)}｜真正目的：${sealedVal(f.true_goal)}
        <div class="nova-inf-sub">相關：${sealedVal(f.related)}</div>
        <div class="nova-inf-row">${delBtn('factions', i)}</div></div>`).join('') || '<p class="nova-inf-empty">無</p>', btn('edit_factions', '編輯'));

    const ic = inst.identity_card || {};
    h += card('我的身份卡', `
        <p>${esc(ic.name)}｜${esc(ic.age)}｜${esc(ic.social_role)}</p>
        <p class="nova-inf-sub">${esc(ic.family)}｜限制：${esc(ic.restrictions)}｜範圍：${esc(ic.range)}</p>
        <p class="nova-inf-sub">摩擦：${esc(ic.friction)}</p>
        <p class="nova-inf-sub">${Object.entries(ic.snapshot || {}).filter(([, v]) => v).map(([k, v]) => `${esc(k)}：${esc(v)}`).join('｜')}</p>`,
        btn('edit_identity', '編輯') + btn('identity_clear', '清空', '', 'danger'));
    return h;
}

function renderClues() {
    const inst = C().instance;
    if (!inst) return noInstance();
    let h = '';
    if ((inst.lies || []).length) {
        h += card('🗣 他們說過的話', inst.lies.map(l => `
            <div class="nova-inf-item ${l.exposed ? 'nova-inf-clue-off' : 'nova-inf-clue-wait'}">
                <div><b>${esc(l.codename)}</b>：「${esc(l.claim)}」${l.exposed ? '　<span class="nova-inf-warn">已被揭穿</span>' : ''}</div>
                ${l.exposed || peek ? `<div class="nova-inf-sub">真相：${esc(l.truth)}</div>` : ''}
            </div>`).join('') + '<p class="nova-inf-hint">有人對你說過的重要說法。哪些是真的、哪些是謊，要你自己判斷。</p>');
    }
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
                        ${delBtn('clues', c.id)}
                    </div>
                </div>`;
            }).join('') || '<p class="nova-inf-empty">本幕沒有線索</p>'}`);
    }
    h += `<div class="nova-inf-row">${btn('edit_clues', '編輯全部線索（會顯示未出現的內容）')}</div>`;
    const threads = inst.threads || [];
    h += card(`伏筆｜未回收 ${threads.filter(x => x.status !== '已回收').length} 條`, threads.slice().reverse().map(x => `
        <div class="nova-inf-item ${x.status === '已回收' ? 'nova-inf-done-soft' : 'nova-inf-clue-on'}">
            <div>[${esc(x.form)}｜第 ${x.planted_turn} 回合｜${esc(x.status)}] ${esc(x.content)}</div>
            <div class="nova-inf-sub">指向：${sealedVal(x.target)}${x.resolution ? `｜回收：${esc(x.resolution)}` : ''}</div>
            <div class="nova-inf-row">${x.status !== '已回收' ? btn('thread_resolve', '標記已回收', `data-id="${esc(x.id)}"`) : ''}${delBtn('threads', x.id)}</div>
        </div>`).join('') || '<p class="nova-inf-empty">還沒有伏筆</p>', btn('edit_threads', '編輯'));
    return h;
}

function renderCalendar() {
    const inst = C().instance;
    if (!inst) return noInstance();
    const cal = inst.calendar || {};
    const events = cal.events || [];
    const visible = events.filter(e => !e.sealed || e.fired || peek);
    const sealedCount = events.filter(e => e.sealed && !e.fired).length;
    return card('日曆', `
        <p>${esc(cal.calendar_name)}｜${esc(cal.date_label)}｜${esc(cal.time_label)}</p>
        <p>副本第 <b>${cal.day || 1}</b> 天（已經過 ${fmtDays((cal.day || 1) - 1)}）${inst.time_limit_days ? `／時限 ${fmtDays(inst.time_limit_days)}` : ''}${inst.real_time ? `／現實約 ${esc(inst.real_time)}` : ''}</p>
        <div class="nova-inf-row">${btn('day_plus', '日期 +1')}${btn('edit_calendar', '編輯日曆')}</div>`) +
        card('行程與事件', visible.sort((a, b) => a.day - b.day).map(e => `
            <div class="nova-inf-item"><span class="${e.fired ? 'nova-inf-done' : ''}">第 ${e.day} 天｜${esc(e.title)}${e.sealed ? '（封存）' : ''}${e.fired ? '｜已發生' : ''}</span>
            <div class="nova-inf-row">${delBtn('events', e.id)}</div></div>`).join('') || '<p class="nova-inf-empty">無</p>',
            btn('event_add', '＋ 新增行程')) +
        (sealedCount && !peek ? `<p class="nova-inf-hint">另有 ${sealedCount} 個封存事件，到期時會自動提醒 AI。</p>` : '');
}

function renderBag() {
    const s = S();
    const inv = s.inventory;
    return card('背包', `
        <p>碎片：<b>${inv.shards || 0}</b></p>
        ${inv.items.map((it, i) => `<div class="nova-inf-item"><b>${esc(it.name)}</b> ×${it.quantity || 1}｜${esc(it.carry_rule)}｜來源：${esc(it.source)}<div class="nova-inf-sub">${esc(it.description)}</div>${btn('item_del', '🗑 丟棄', `data-i="${i}"`, 'danger')}</div>`).join('') || '<p class="nova-inf-empty">空空的</p>'}`,
        btn('item_add', '＋ 新增') + btn('edit_bag', '編輯')) +
        card('現實獎勵', `
        ${s.rewards.map((r, i) => `<div class="nova-inf-item">${esc(r.instance_name || '')}｜${esc(r.reward_tier || '')}｜願望：${esc(r.wish)}｜${r.redeemed ? '已兌現' : '未兌現'}
            <div class="nova-inf-row">${btn('reward_toggle', r.redeemed ? '標記未兌現' : '標記已兌現', `data-i="${i}"`)}${delBtn('rewards', i)}</div></div>`).join('') || '<p class="nova-inf-empty">還沒有許過願</p>'}`,
        btn('reward_add', '＋ 許願') + btn('edit_rewards', '編輯'));
}

function renderWorldMap() {
    const inst = C().instance;
    if (!inst) return noInstance();
    const era = inst.era || {};
    const regions = inst.map?.regions || [];
    const life = inst.daily_life || [];
    const wf = inst.world_file;
    const ws = inst.world_scope;
    const scopeCard = ws ? card(`🪐 ${esc(ws.world_name || '這個世界')}`, `
        ${ws.scale ? `<p class="nova-inf-sub">${esc(ws.scale)}</p>` : ''}
        ${(wf?.nations?.length ? wf.nations : (ws.regions || [])).map(r => `<div class="nova-inf-item"><b>${esc(r.name)}</b>
            <div class="nova-inf-sub">${esc([r.polity, r.language].filter(Boolean).join('｜'))}</div>
            ${r.culture || r.note ? `<div class="nova-inf-sub">${esc(r.culture || r.note)}</div>` : ''}</div>`).join('')}
        ${ws.stage ? `<p class="nova-inf-hint">這次的舞台：${esc(ws.stage)}</p>` : ''}`) : '';
    const wfCard = scopeCard + card('🌍 世界檔案', wf ? (peek ? `
        ${wf.history ? `<p class="nova-inf-sub">崩壞之前：${esc(wf.history)}</p>` : ''}
        ${wf.timeline?.length ? `<p class="nova-inf-sub">歲月：${wf.timeline.map(x => esc(x.when + '｜' + x.event)).join('<br>')}</p>` : ''}
        ${wf.factions?.length ? `<p class="nova-inf-sub">勢力：${wf.factions.map(f => esc(f.name + '：' + f.goal)).join('<br>')}</p>` : ''}
        ${wf.ordinary_life ? `<p class="nova-inf-sub">日常：${esc(wf.ordinary_life)}</p>` : ''}
        ${wf.third_party ? `<p class="nova-inf-sub">得利者：${esc(wf.third_party)}</p>` : ''}
        ${wf.independent_crisis ? `<p class="nova-inf-sub">世界自己的危機：${esc(wf.independent_crisis)}</p>` : ''}` : '<p>已建立 🔒</p>') : '<p class="nova-inf-empty">尚未建立。開局後會在背景自動生成。</p>',
        btn('gen_world', wf ? '重新生成' : '生成世界檔案'));
    return wfCard + card('時代與技術', `
        <p>${esc(era.tech_level) || '<span class="nova-inf-empty">未設定</span>'}</p>
        ${era.anachronism ? `<p class="nova-inf-sub">超時代設施：${esc(era.anachronism)}</p>` : ''}`, btn('edit_era', '編輯')) +
        card(`地圖｜目前位置：${esc(inst.location || '未知')}`, regions.map((r, i) => `
        <div class="nova-inf-item ${r.name === inst.location ? 'nova-inf-here' : ''}">
            <div><b>${esc(r.name)}</b>${r.name === inst.location ? '　📍' : ''}｜${esc(r.danger)}</div>
            <div class="nova-inf-sub">${esc(r.desc)}</div>
            <div class="nova-inf-sub">出入：${esc(r.access)}｜交通：${esc(r.travel)}</div>
            ${r.sealed_note ? `<div class="nova-inf-sub">藏著的東西：${sealedVal(r.sealed_note)}</div>` : ''}
            <div class="nova-inf-row">${r.name !== inst.location ? btn('move_here', '設為目前位置', `data-i="${i}"`) : ''}${delBtn('regions', i)}</div>
        </div>`).join('') || '<p class="nova-inf-empty">無</p>', btn('region_add', '＋ 新增') + btn('edit_regions', '編輯')) +
        card('生活設施', life.map((l, i) => `
        <div class="nova-inf-item"><b>${esc(l.function)}</b>：${esc(l.local_name)}
            <div class="nova-inf-sub">${esc(l.desc)}</div>
            <div class="nova-inf-sub">${esc(l.access)}</div>
            <div class="nova-inf-row">${delBtn('life', i)}</div></div>`).join('') || '<p class="nova-inf-empty">無</p>',
        btn('edit_life', '編輯'));
}

function renderGlossary() {
    const s = S();
    const inst = C().instance;
    const item = (g, list, i) => `<div class="nova-inf-item"><b>${esc(g.term)}</b>：${esc(g.desc)}<div class="nova-inf-row">${delBtn(list, i)}</div></div>`;
    return card('副本辭典', (inst?.glossary || []).map((g, i) => item(g, 'glossary', i)).join('') || '<p class="nova-inf-empty">無</p>',
        inst ? btn('glossary_add', '＋ 新增') + btn('glossary_clear', '清空', '', 'danger') + btn('edit_glossary', '編輯') : '') +
        card('白域通用詞彙', s.glossary_global.map((g, i) => item(g, 'glossary_global', i)).join('') || '<p class="nova-inf-empty">無</p>',
        btn('glossary_global_add', '＋ 新增') + btn('glossary_global_clear', '清空', '', 'danger') + btn('edit_glossary_global', '編輯')) +
        '<p class="nova-inf-hint">副本辭典只屬於這個聊天的副本，開新副本時會一起清掉；白域通用詞彙則跨副本保留，只在白域大廳送給 AI。</p>';
}

function renderWorlds() {
    const s = S();
    const ledgerHtml = s.ledger.map((l, i) => ({ l, i })).reverse().map(({ l, i }) => `
        <div class="nova-inf-item">#${l.no}｜<b>${esc(l.name)}</b>｜${esc(l.worldline)}｜${esc(l.line_type)}｜${esc(l.difficulty)}｜${esc(l.result)}
        ${l.hook ? `<div class="nova-inf-sub">「${esc(l.hook)}」${l.hook_type ? `［${esc(l.hook_type)}］` : ''}</div>` : ''}
        <div class="nova-inf-sub">${esc(l.axes?.type)}／${esc(l.axes?.world)}／${esc(l.axes?.mechanic || '無')}｜${esc(l.exit_type)}｜${esc(l.date)}</div>
        ${l.days_spent ? `<div class="nova-inf-sub">副本內 ${fmtDays(l.days_spent)}${l.real_time ? `｜現實 ${esc(l.real_time)}` : ''}</div>` : ''}
        <div class="nova-inf-row">${btn('ledger_del', '🗑 刪除這筆', `data-i="${i}"`, 'danger')}</div></div>`).join('');
    const wlHtml = s.worldlines.map((w, i) => `
        <div class="nova-inf-item"><b>${esc(w.coordinate)}</b>｜${esc(w.record_wall_text)}${w.anomaly ? '｜<span class="nova-inf-warn">異常</span>' : ''}
        <div class="nova-inf-sub">升級：${sealedVal(w.upgrade_status)}｜條件：${sealedVal(w.open_condition)}</div>
        <div class="nova-inf-row">${btn('wl_del', '🗑 刪除這條世界線', `data-i="${i}"`, 'danger')}</div></div>`).join('');
    return card('通關帳本', ledgerHtml || '<p class="nova-inf-empty">尚無紀錄</p>', btn('edit_ledger', '編輯')) +
        card('世界線紀錄牆', wlHtml || '<p class="nova-inf-empty">尚無紀錄</p>', btn('edit_worldlines', '編輯')) +
        `<div class="nova-inf-danger-zone"><b>清除資料</b>
        <p class="nova-inf-hint">測試用。刪掉的資料無法復原，建議先到「設定」匯出備份。</p>
        <div class="nova-inf-row">
            ${btn('reset_chat', '清除這個聊天的副本', '', 'danger')}
            ${btn('reset_ledger', '清空帳本與世界線', '', 'danger')}
            ${btn('reset_all', '清空全部遊玩資料', '', 'danger')}
        </div>
        <p class="nova-inf-hint">「清空全部遊玩資料」會清掉帳本、世界線、背包、碎片、現實獎勵、白域詞彙，但保留規則與設定。</p></div>`;
}

function renderSealed() {
    if (!peek) {
        return card('封存區', `
            <p>這裡是 AI 用來推進劇情的真相、真名、好感與過往。</p>
            <p class="nova-inf-hint">解鎖後，其他分頁的 🔒 也會一起顯示，直到你切換聊天或重新上鎖。</p>
            ${btn('peek_on', '我確定要偷看', '', 'primary')}`);
    }
    const inst = C().instance;
    let h = card('封存區（已解鎖）', btn('peek_off', '重新上鎖'));
    if (!inst) return h + '<p class="nova-inf-empty">目前沒有副本。</p>';
    h += card('總真相', `<p>${esc(inst.sealed.total_truth)}</p><p>幕後：${esc(inst.sealed.mastermind)}</p><p>動機：${esc(inst.sealed.motive)}</p>`, btn('edit_sealed', '編輯'));
    h += card('各幕真相', inst.acts.map(a => `<div class="nova-inf-item">第 ${a.number} 幕｜${esc(a.question)}<div class="nova-inf-sub">真相：${esc(a.truth)}</div><div class="nova-inf-sub">揭露：${esc(a.twist)}｜情感重點：${esc(a.emotion_focus)}</div></div>`).join(''), btn('edit_acts', '編輯'));
    h += card('男主與你的過往', inst.cast.map(c => `
        <div class="nova-inf-item"><b>${esc(c.codename)}</b> ＝ ${esc(c.real_name)}｜好感 ${esc(c.affinity)}｜${esc(c.obsession_stage)}
        <div class="nova-inf-sub">歷程：${esc(c.history_length)}｜關係：${esc(c.relation_type)}</div>
        <div class="nova-inf-sub">此世性格：${esc(c.this_life)}</div>
        <div class="nova-inf-sub">影響成因：${esc(c.influence)}</div>
        <div class="nova-inf-sub">專屬殘留物：${esc(c.remnant)}</div>
        <div class="nova-inf-sub">未竟之約：${esc(c.promise)}</div></div>`).join(''));
    h += card('伏筆指向', (inst.threads || []).map(x => `<div class="nova-inf-item">[${esc(x.id)}｜${esc(x.status)}] ${esc(x.content)}<div class="nova-inf-sub">指向：${esc(x.target)}</div></div>`).join('') || '<p class="nova-inf-empty">無</p>');
    h += card('讓渡紀錄', inst.concessions.map((x, i) => `<div class="nova-inf-item">回合 ${x.turn}｜${esc(x.giver)}｜${esc(x.what)}｜${esc(x.form)}<div class="nova-inf-sub">代價：${esc(x.cost)}｜後續：${esc(x.consequence)}</div><div class="nova-inf-row">${delBtn('concessions', i)}</div></div>`).join('') || '<p class="nova-inf-empty">無</p>', btn('edit_concessions', '編輯'));
    return h;
}

const PROFILE_TEMPLATE = `駕駛能力：
乘坐偏好（暈車、暈船、暈機、刺激遊樂設施）：
水性（會不會游泳、怕不怕深水）：
飲食限制（過敏、不吃的東西、腸胃、吃辣程度、咖啡因）：
酒精與藥物反應：
體能技能（腳踏車、溜冰、滑雪、攀岩、露營、長途步行）：
生存技能（生火、搭帳篷、辨方向、急救、使用工具）：
動物接受度：
環境適應（怕冷、怕熱、怕黑、怕高、密閉空間、怕髒、怕濕）：
感官偏好（噪音、強光、異味、黏膩、濕衣服）：
生活技能（做飯、縫補、整理、導航、看地圖、修東西）：
清潔習慣：對清潔有明確要求，有一定程度的潔癖。外出一整天、流汗、沾到灰塵雨水血污海水煙味後，不能接受不清潔就上床睡覺。條件允許時會優先洗澡、洗頭、更衣、刷牙；條件不足時至少要熱水擦身、局部清洗、換乾淨衣物、整理床鋪後才休息。清潔關係到她的安全感與能否入睡，不可只安排別人洗漱而默認她可以不洗。
其他習慣與禁忌：`;

function renderProfile() {
    const s = S();
    return card('玩家檔案', `
        <p class="nova-inf-hint">這裡寫的是「你本人」的能力、體質、習慣與禁忌，不管進哪個副本、拿到什麼身份卡都不會變。會在副本開局與進行中送給 AI。</p>
        <p class="nova-inf-hint">沒寫的項目，AI 會一律以普通人處理，不會自動讓你很會、很能撐、很敢。不確定的項目留空就好。</p>
        <textarea class="nova-inf-input" rows="22" data-set="playerProfile" placeholder="點下方按鈕插入填寫範本">${esc(s.playerProfile || '')}</textarea>
        <div class="nova-inf-row">${s.playerProfile?.trim() ? '' : btn('profile_template', '插入填寫範本', '', 'primary')}</div>`);
}

function ruleCard(r, i) {
    const s = S();
    return `
        <details class="nova-inf-card" ${openRuleId === r.id ? 'open' : ''} data-rule-id="${esc(r.id)}">
            <summary draggable="true" data-drag-rule="${esc(r.id)}" title="可以拖到其他資料夾"><span class="nova-drag-handle">⠿</span><input type="checkbox" data-rule-on="${i}" ${r.enabled ? 'checked' : ''}> <b>${esc(r.title)}</b>
                <span class="nova-inf-chip nova-prio-${r.priority || 'normal'}">${PRIORITIES[r.priority || 'normal']}</span>
                ${r.custom ? '<span class="nova-inf-chip">自訂</span>' : ''}
                <span class="nova-inf-sub">${(r.modes || []).map(m => RULE_MODES[m] || m).join('、') || '未指定模式（不會送出）'}</span></summary>
            <label class="nova-inf-label">標題<input class="nova-inf-input" data-rule-title="${i}" value="${esc(r.title)}"></label>
            <div class="nova-inf-row">${Object.entries(RULE_MODES).map(([k, v]) =>
                `<label class="nova-inf-chip"><input type="checkbox" data-rule-mode="${i}" value="${k}" ${(r.modes || []).includes(k) ? 'checked' : ''}>${v}</label>`).join('')}</div>
            <div class="nova-inf-row">
                <label class="nova-inf-label" style="flex:1">權重
                    <select class="nova-inf-input" data-rule-prio="${i}">
                        ${Object.entries(PRIORITIES).map(([k, v]) => `<option value="${k}" ${(r.priority || 'normal') === k ? 'selected' : ''}>${v}</option>`).join('')}
                    </select></label>
                <label class="nova-inf-label" style="flex:1">資料夾
                    <select class="nova-inf-input" data-rule-folder="${i}">
                        <option value="">未分類</option>
                        ${(s.folders || []).map(f => `<option value="${esc(f.id)}" ${r.folder === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
                    </select></label>
            </div>
            <textarea class="nova-inf-input nova-inf-rule" rows="10" data-rule-text="${i}">${esc(r.content)}</textarea>
            <p class="nova-inf-sub">${(r.content || '').length} 字</p>
            <div class="nova-inf-row">
                ${btn('rule_top', '⤒ 移到最前', `data-i="${i}"`)}
                ${btn('rule_up', '↑ 上移', `data-i="${i}"`)}
                ${btn('rule_down', '↓ 下移', `data-i="${i}"`)}
                ${btn('rule_bottom', '⤓ 移到最後', `data-i="${i}"`)}
                ${btn('rule_dup', '複製一份', `data-i="${i}"`)}
                ${btn('rule_del', '🗑 刪除', `data-i="${i}"`, 'danger')}
            </div>
        </details>`;
}

function batchRow(r) {
    return `<label class="nova-batch-row ${batchSel.has(r.id) ? 'on' : ''}">
        <input type="checkbox" data-batch-id="${esc(r.id)}" ${batchSel.has(r.id) ? 'checked' : ''}>
        <b>${esc(r.title)}</b>
        <span class="nova-inf-sub">${(r.modes || []).map(m => RULE_MODES[m] || m).join('、')}</span>
    </label>`;
}

function renderRules() {
    const s = S();
    const missing = DEFAULT_RULES.filter(d => !s.rules.find(r => r.id === d.id)).length;
    const f = s.ruleFilter || 'all';
    const visible = r => f === 'all' || (r.modes || []).includes(f);
    const modeLen = f === 'all' ? null : ['core', 'normal', 'ref'].map(p => [p, rulesFor(f, p).reduce((n, r) => n + (r.content || '').length, 0)]);
    const groups = [...(s.folders || []), { id: '', name: '未分類', enabled: true, collapsed: !!s.unfiledCollapsed, virtual: true }];
    const folderBlock = (fd, fi) => {
        const items = s.rules.map((r, i) => [r, i]).filter(([r]) => (r.folder || '') === fd.id && (fd.id || !s.folders.find(x => x.id === r.folder)) && visible(r));
        const all = s.rules.filter(r => (r.folder || '') === fd.id);
        if (fd.virtual && !all.length) return '';
        return `<details class="nova-folder ${fd.enabled === false ? 'off' : ''}" data-folder-id="${esc(fd.id || '_unfiled')}" ${fd.collapsed ? '' : 'open'}>
            <summary class="nova-folder-head">
                ${fd.virtual ? '' : `<input type="checkbox" data-folder-on="${fi}" ${fd.enabled !== false ? 'checked' : ''} title="整個資料夾開啟或關閉">`}
                <b>📁 ${esc(fd.name)}</b>
                <span class="nova-inf-sub">${all.length} 條${fd.enabled === false ? '｜整個資料夾已關閉' : ''}</span>
            </summary>
            ${fd.virtual ? '' : `<label class="nova-inf-label">資料夾說明（送給 AI，一句話說明這一組規則管什麼；可留空）
                <input class="nova-inf-input" data-folder-desc="${fi}" value="${esc(fd.desc || '')}" placeholder="例：男主黑化時的行為、強度與汙染"></label>
            <div class="nova-inf-row">
                ${btn('rule_add', '＋ 在這裡新增規則', `data-folder="${esc(fd.id)}"`)}
                ${btn('folder_rename', '重新命名', `data-fi="${fi}"`)}
                ${btn('folder_up', '↑', `data-fi="${fi}"`)}${btn('folder_down', '↓', `data-fi="${fi}"`)}
                ${btn('folder_del', '🗑 刪除資料夾', `data-fi="${fi}"`, 'danger')}
            </div>`}
            ${batchMode && items.length ? `<div class="nova-inf-row">${btn('batch_all', '全選這個資料夾', `data-folder="${esc(fd.id)}"`)}</div>` : ''}
            ${items.map(([r, i]) => batchMode ? batchRow(r) : ruleCard(r, i)).join('') || '<p class="nova-inf-empty">這個資料夾沒有符合篩選的規則</p>'}
        </details>`;
    };
    return `<p class="nova-inf-hint">勾選的規則會在對應模式下送給 AI。送出順序：同一個權重內，先依資料夾的順序，再依資料夾裡規則的順序。關閉資料夾，裡面的規則全部不會送出。</p>
        <label class="nova-inf-label"><input type="checkbox" data-set="folderHeaders" ${s.folderHeaders ? 'checked' : ''}> 送給 AI 時附上資料夾標題與說明（讓 AI 知道規則的分類）</label>
        <details class="nova-inf-guide nova-inf-more">
            <summary class="nova-inf-guide-title">權重怎麼分</summary>
            <ol>
                <li><b>★ 核心</b>：放在最靠近最新訊息的位置，並標明「與其他規則衝突時以此為準」。只放最不能被違反的幾條（建議 3–5 條）。</li>
                <li><b>一般</b>：放在主提示詞，照順序送出。</li>
                <li><b>參考</b>：放在一般規則的後面，標明「衝突時以上方為準」。適合細節、範例、補充。</li>
            </ol>
        </details>
        <div class="nova-inf-row">${batchMode ? '' : btn('rule_add', '＋ 新增規則', '', 'primary')}${btn('folder_add', '＋ 新增資料夾')}
            ${btn('batch_toggle', batchMode ? '✓ 完成整理' : '📦 整理規則', '', batchMode ? 'primary' : '')}
            <select class="nova-inf-input" style="width:auto" data-rule-filter="1">
                <option value="all" ${f === 'all' ? 'selected' : ''}>顯示全部</option>
                ${Object.entries(RULE_MODES).map(([k, v]) => `<option value="${k}" ${f === k ? 'selected' : ''}>只看「${v}」會送出的</option>`).join('')}
            </select></div>
        ${modeLen ? `<p class="nova-inf-sub">這個模式送出的字數：核心 ${modeLen[0][1]}｜一般 ${modeLen[1][1]}｜參考 ${modeLen[2][1]}</p>` : ''}` +
        (batchMode ? `<div class="nova-batch-bar">
            <span>已選 <b>${batchSel.size}</b> 條</span>
            <select class="nova-inf-input" id="nova_batch_target" style="width:auto">
                <option value="">未分類</option>
                ${(s.folders || []).map(fd => `<option value="${esc(fd.id)}">${esc(fd.name)}</option>`).join('')}
            </select>
            ${btn('batch_move', '移過去', batchSel.size ? '' : 'disabled', 'primary')}
            ${btn('batch_clear', '取消選取')}
        </div>` : '<p class="nova-inf-hint">電腦上可以按住規則標題（⠿）直接拖到另一個資料夾。手機請用「📦 整理規則」。</p>') +
        groups.map((fd, fi) => folderBlock(fd, fi)).join('') +
        `<div class="nova-inf-row">
            ${missing ? btn('rules_restore_missing', `補回被刪掉的預設規則（${missing} 條）`) : ''}
            ${btn('rules_reset', '全部還原為預設（會刪掉自訂規則與修改）', '', 'danger')}
        </div>`;
}

function renderSettingsTab() {
    const s = S();
    const cs = C();
    return card('手動切換模式', `
        <p class="nova-inf-hint">一般不需要動這裡，插件會依流程自動切換。只有流程卡住時才手動調整。</p>
        <select class="nova-inf-input" data-bind="mode">
            ${Object.entries(MODES).map(([k, v]) => `<option value="${k}" ${cs?.mode === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>`) +
        card('浮球', `
        <label class="nova-inf-label"><input type="checkbox" data-set="floatBall" ${s.floatBall !== false ? 'checked' : ''}> 顯示浮球</label>
        <p class="nova-inf-hint">點一下打開或關閉面板，按住可以拖到任何位置。關掉浮球後，仍可從魔杖選單打開。</p>
        <div class="nova-inf-row">${btn('ball_reset', '浮球回到預設位置')}</div>`) +
        card('副本銜接', `
        <label class="nova-inf-label">選定副本之後
            <select class="nova-inf-input" data-set="continueMode">
                <option value="same" ${s.continueMode !== 'new' ? 'selected' : ''}>在同一個聊天繼續</option>
                <option value="new" ${s.continueMode === 'new' ? 'selected' : ''}>開新聊天</option>
            </select></label>
        <label class="nova-inf-label"><input type="checkbox" data-set="hideOld" ${s.hideOld ? 'checked' : ''}> 結算後前往下一步時，隱藏前面的訊息（AI 看不到，畫面上還在）</label>`) +
        card('插件專用 API', `
        <p class="nova-inf-hint">補抓開局資料、男主人生檔案、通訊器這些「背景生成」，可以改用另一組 API，不受酒館回覆長度限制。正文仍然走酒館原本的連線。</p>
        <label class="nova-inf-label"><input type="checkbox" data-set="autoRecover" ${s.autoRecover ? 'checked' : ''}> 開局沒抓到資料、或缺了男主／地圖／幕時，自動根據開局正文重新生成</label>
        <label class="nova-inf-label">使用
            <select class="nova-inf-input" data-api="provider">
                <option value="st" ${(s.api?.provider || 'st') === 'st' ? 'selected' : ''}>酒館目前的連線（預設）</option>
                <option value="gemini" ${s.api?.provider === 'gemini' ? 'selected' : ''}>Google Gemini（填 API 金鑰）</option>
                <option value="openai" ${s.api?.provider === 'openai' ? 'selected' : ''}>OpenAI 相容（OpenRouter、代理等）</option>
            </select></label>
        ${s.api?.provider && s.api.provider !== 'st' ? `
        <label class="nova-inf-label">API 金鑰<input class="nova-inf-input" type="password" autocomplete="off" data-api="key" value="${esc(s.api.key || '')}"></label>
        ${s.api.provider === 'openai' ? `<label class="nova-inf-label">API 網址（例：https://openrouter.ai/api/v1）<input class="nova-inf-input" data-api="baseUrl" value="${esc(s.api.baseUrl || '')}"></label>` : ''}
        <label class="nova-inf-label">模型<input class="nova-inf-input" data-api="model" value="${esc(s.api.model || '')}" placeholder="gemini-2.5-flash"></label>
        <label class="nova-inf-label">輸出上限（token）<input class="nova-inf-input" type="number" min="1024" data-api="maxTokens" value="${s.api.maxTokens || 32768}"></label>
        <label class="nova-inf-label">溫度<input class="nova-inf-input" type="number" step="0.1" min="0" max="2" data-api="temperature" value="${s.api.temperature ?? 0.9}"></label>
        <div class="nova-inf-row">${btn('api_test', '測試連線')}</div>
        <p class="nova-inf-hint">金鑰存在酒館的設定檔裡，匯出備份時不會包含。</p>` : ''}`) +
        card('男主人生檔案', `
        <label class="nova-inf-label"><input type="checkbox" data-set="autoDossier" ${s.autoDossier ? 'checked' : ''}> 開局後自動在背景生成（男主的目標、仇人、身邊的人、紀念日、習慣、黑化起源，以及世界檔案）</label>
        <label class="nova-inf-label">在白域清理汙染要花的碎片（0 為免費）<input class="nova-inf-input" type="number" min="0" data-set="pollutionCleanCost" value="${s.pollutionCleanCost || 0}"></label>
        <label class="nova-inf-label">每幾回合請 AI 回報男主的幕後行動<input class="nova-inf-input" type="number" min="3" data-set="offscreenEvery" value="${s.offscreenEvery || 6}"></label>`) +
        card('插件設定', `
        <label class="nova-inf-label"><input type="checkbox" data-set="enabled" ${s.enabled ? 'checked' : ''}> 啟用插件</label>
        <label class="nova-inf-label">規則放置位置
            <select class="nova-inf-input" data-set="rulesDepthMode">
                <option value="prompt" ${s.rulesDepthMode === 'prompt' ? 'selected' : ''}>主提示詞（較前面）</option>
                <option value="chat" ${s.rulesDepthMode === 'chat' ? 'selected' : ''}>聊天中（指定深度）</option>
            </select></label>
        <label class="nova-inf-label">規則深度（選「聊天中」時有效）<input class="nova-inf-input" type="number" data-set="rulesDepth" value="${s.rulesDepth}"></label>
        <label class="nova-inf-label">狀態深度（建議 1）<input class="nova-inf-input" type="number" data-set="stateDepth" value="${s.stateDepth}"></label>
        <label class="nova-inf-label">★ 核心規則深度（建議 1–3，越小越靠近最新訊息）<input class="nova-inf-input" type="number" min="0" data-set="coreDepth" value="${s.coreDepth ?? 2}"></label>`) +
        card('世界線抽籤', `
        <label class="nova-inf-label"><input type="checkbox" data-set="rollWorlds" ${s.rollWorlds ? 'checked' : ''}> 白域大廳由插件隨機抽世界線（避免 AI 一直選同類型）</label>
        <label class="nova-inf-label">一批抽幾個（等於副本選項數量，1–8）<input class="nova-inf-input" type="number" min="1" max="8" data-set="rollCount" value="${s.rollCount || 3}"></label>
        <div class="nova-inf-row">${btn('pool_add_modern', '＋ 加入近現代題材包')}${btn('pool_add_fairy', '＋ 加入童話改寫包')}</div>
        <label class="nova-inf-label">抽籤池（用頓號、逗號或換行分隔；最近三個副本用過的會自動跳過）
            <textarea class="nova-inf-input" rows="6" data-set="worldPool">${esc(s.worldPool || '')}</textarea></label>`) +
        card('禁用素材清單', `
        <p class="nova-inf-hint">AI 的開局資料或正文出現這些詞時，會跳出警告提醒你重新生成（不會自動修改）。用逗號或換行分隔。另外，未揭露身分的男主真名出現在正文時也會警告。</p>
        <textarea class="nova-inf-input" rows="5" data-set="bannedWords">${esc(s.bannedWords || '')}</textarea>`) +
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
    const fdet = ev.target.closest('details[data-folder-id]');
    if (fdet && ev.target.closest('summary')?.parentElement === fdet && ev.target.tagName !== 'INPUT') {
        const id = fdet.dataset.folderId;
        const willCollapse = fdet.open;
        if (id === '_unfiled') S().unfiledCollapsed = willCollapse;
        else { const fd = (S().folders || []).find(x => x.id === id); if (fd) fd.collapsed = willCollapse; }
        saveSettings();
    }
    const det = ev.target.closest('details[data-rule-id]');
    if (det && ev.target.closest('summary') && ev.target.tagName !== 'INPUT') {
        openRuleId = det.open ? null : det.dataset.ruleId;
    }
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act.startsWith('phone_')) { onPhoneAction(act, b); return; }
    const cs = C();
    const s = S();
    const inst = cs?.instance;

    switch (act) {
        case 'to_opening': cs.mode = 'opening'; commit(); break;
        case 'goto_help': currentTab = 'help'; s.seenGuide = true; saveSettings(); renderPanel(); break;
        case 'goto_overview': currentTab = 'overview'; renderPanel(); break;
        case 'guide_dismiss': s.seenGuide = true; saveSettings(); renderPanel(); break;
        case 'noop': break;
        case 'ball_reset': s.floatPos = null; saveSettings(); placeBall(); toast('浮球已回到右側', 'success'); break;
        case 'pick': { const r = pickOption(Number(b.dataset.i)); if (r) toast(r, 'success'); renderPanel(); break; }
        case 'options_clear': cs.options = []; commit(); break;
        case 'pending_cancel': s.pendingSeed = null; saveSettings(); renderPanel(); break;
        case 'pending_here':
            if (cs.instance && !confirm('這個聊天還有舊副本的資料，要清掉並開始新副本嗎？')) break;
            {
                const seed = Object.assign({}, s.pendingSeed);
                s.pendingSeed = null;
                const md = ctx().chatMetadata;
                md[MODULE] = { mode: 'opening', seed, instance: null, lock: false, snapshots: {}, options: [] };
                commit();
            }
            break;
        case 'new_instance':
            if (confirm('在這個聊天開新副本？目前的副本資料會從這個聊天移除（帳本裡的紀錄不受影響）。')) {
                resetChatInstance('opening');
            }
            break;
        case 'inst_delete':
            if (confirm('刪除這個副本？不會寫入帳本，副本中取得的「僅限本副本」道具也會一起移除。')) {
                const id = inst?.id;
                if (id) s.inventory.items = s.inventory.items.filter(it => !(it.instance_id === id && it.carry_rule === '僅限本副本'));
                resetChatInstance('off');
            }
            break;
        case 'move_here': { const r = inst?.map?.regions[Number(b.dataset.i)]; if (r) { inst.location = r.name; r.visited = true; commit(); } break; }
        case 'region_add': if (inst) {
            const name = prompt('地區名稱'); if (!name) break;
            const desc = prompt('描述') || '';
            inst.map.regions.push(normRegion({ name, desc }));
            commit();
        } break;
        case 'edit_era': if (inst) openEditor('時代與技術', inst.era || {}, v => { inst.era = v; }); break;
        case 'edit_regions': if (inst) {
            const keys = ['sealed_note'];
            openEditor('地圖' + (peek ? '' : '（封存欄位已隱藏，儲存時會保留）'), stripKeys(inst.map.regions, keys), v => { inst.map.regions = mergeKeys(inst.map.regions, v, keys).map(normRegion); });
        } break;
        case 'edit_life': if (inst) openEditor('生活設施', inst.daily_life || [], v => { inst.daily_life = v.map(normLife); }); break;
        case 'thread_resolve': {
            const x = inst?.threads?.find(t => t.id === b.dataset.id);
            if (x) { x.status = '已回收'; x.resolved_turn = inst.turn; commit(); }
            break;
        }
        case 'edit_threads': if (inst) openEditor('伏筆' + (peek ? '' : '（指向欄位已隱藏，儲存時會保留）'), stripKeys(inst.threads || [], SEALED_THREAD_KEYS), v => {
            inst.threads = mergeKeys(inst.threads || [], v, SEALED_THREAD_KEYS).map((t, i) => normThread(t, i, inst.turn));
        }); break;
        case 'profile_template': s.playerProfile = PROFILE_TEMPLATE; saveSettings(); updateInjection(); renderPanel(); break;
        case 'seed_clear': if (confirm('清空種子卡？')) { cs.seed = {}; commit(); } break;
        case 'identity_clear': if (inst && confirm('清空身份卡？')) { inst.identity_card = blankInstance().identity_card; commit(); } break;
        case 'del': {
            const list = b.dataset.list;
            const key = b.dataset.key;
            const lists = {
                cast: () => inst?.cast, people: () => inst?.people, factions: () => inst?.factions,
                clues: () => inst?.clues, events: () => inst?.calendar?.events, glossary: () => inst?.glossary,
                concessions: () => inst?.concessions, threads: () => inst?.threads, regions: () => inst?.map?.regions, life: () => inst?.daily_life,
                glossary_global: () => s.glossary_global, rewards: () => s.rewards,
            };
            const arr = lists[list]?.();
            if (!arr) break;
            const byId = list === 'clues' || list === 'events' || list === 'threads';
            const idx = byId ? arr.findIndex(x => x.id === key) : Number(key);
            if (idx < 0 || idx >= arr.length) break;
            if (!confirm('確定刪除這一筆？')) break;
            arr.splice(idx, 1);
            commit();
            break;
        }
        case 'event_add': if (inst) {
            const day = Number(prompt('第幾天？', String(inst.calendar.day || 1)));
            if (!day) break;
            const title = prompt('行程內容');
            if (!title) break;
            inst.calendar.events.push({ id: 'e_' + Date.now(), day, title, sealed: false, fired: false });
            commit();
        } break;
        case 'glossary_add': case 'glossary_global_add': {
            const term = prompt('名詞'); if (!term) break;
            const desc = prompt('解釋') || '';
            const arr = act === 'glossary_add' ? inst?.glossary : s.glossary_global;
            if (!arr) break;
            arr.push({ term, desc, revealed: true });
            commit();
            break;
        }
        case 'glossary_clear': if (inst && confirm('清空本副本辭典？')) { inst.glossary = []; commit(); } break;
        case 'glossary_global_clear': if (confirm('清空白域通用詞彙？')) { s.glossary_global = []; commit(); } break;
        case 'reward_add': {
            const wish = prompt('許下的願望'); if (!wish) break;
            const last = s.ledger[s.ledger.length - 1];
            s.rewards.push({ instance_name: last?.name || '', reward_tier: last?.reward_tier || '', wish, redeemed: false });
            commit();
            break;
        }
        case 'item_add': {
            const name = prompt('道具名稱'); if (!name) break;
            const description = prompt('說明') || '';
            const carry = prompt('攜帶規則（僅限本副本／可帶回白域／可帶回現實）', '可帶回白域') || '可帶回白域';
            s.inventory.items.push({ name, description, source: '手動新增', quantity: 1, single_use: false, carry_rule: carry, instance_id: inst?.id || '' });
            commit();
            break;
        }
        case 'to_lobby': cs.mode = 'lobby'; commit(); break;
        case 'next_side': {
            const lm = s.lastMain;
            const c = lm?.cast?.find(x => x.codename === b.dataset.c);
            goNext({ kind: 'side', target: c ? `${c.codename}${c.real_name ? `（${c.real_name}）` : ''}` : '', from: clone(lm) });
            break;
        }
        case 'next_main': goNext({ kind: 'main' }); break;
        case 'more_cast': genMoreCast(true); break;
        case 'gen_world': if (!inst?.world_file || confirm('重新生成會覆蓋目前的世界檔案，確定嗎？')) genWorldFile(true); break;
        case 'pol_clean': {
            const cost = Number(s.pollutionCleanCost) || 0;
            if ((s.inventory.shards || 0) < cost) { toast(`碎片不足，清理需要 ${cost} 碎片`, 'warning'); break; }
            if (!confirm('清理汙染後遺症？下一個副本她會是清醒的。')) break;
            s.inventory.shards -= cost;
            s.pollutionCarry = null;
            commit();
            toast('汙染已在白域清理乾淨', 'success');
            break;
        }
        case 'pol_keep': toast('好，汙染會跟著她進下一個副本，並逐漸消退', 'info'); break;
        case 'gen_dossier': if (!inst?.dossier_done || confirm('重新生成會覆蓋目前的人生檔案，確定嗎？')) genDossiers(true); break;
        case 'pol_plus': if (inst) { inst.pollution = Math.min(100, (inst.pollution || 0) + 5); commit(); } break;
        case 'pol_minus': if (inst) { inst.pollution = Math.max(0, (inst.pollution || 0) - 5); commit(); } break;
        case 'recover_open': recoverOpen(false); break;
        case 'recover_merge': recoverOpen(true); break;
        case 'api_test': (async () => {
            toast('測試中…', 'info');
            try { const t = await genRaw('你是測試助手。', '請只回覆「連線成功」四個字。'); toast('插件 API 回應：' + String(t).slice(0, 40), 'success'); }
            catch (e) { toast('測試失敗：' + (e.message || e), 'error'); }
        })(); break;
        case 'pool_add_modern': {
            const have = new Set(poolList());
            const add = '娛樂圈、電競圈、時尚圈、選秀節目、豪門財閥、職場商戰、醫院、律師事務所、新聞媒體、刑偵、賽車場、拍賣行、古董界、料理界、畫廊藝術圈、職業運動、航空公司、偏鄉小鎮、九零年代港風、八零年代'.split('、').filter(w => !have.has(w));
            s.worldPool = [...poolList(), ...add].join('、');
            saveSettings(); renderPanel();
            toast(add.length ? `加入了 ${add.length} 個近現代題材` : '抽籤池裡已經都有了', 'success');
            break;
        }
        case 'pool_add_fairy': {
            const have = new Set(poolList());
            const add = '童話改寫：綠野仙蹤、童話改寫：太陽之東月亮之西、童話改寫：雪后、童話改寫：野天鵝、童話改寫：紅鞋、童話改寫：小錫兵、童話改寫：夜鶯、童話改寫：拇指姑娘、童話改寫：十二個跳舞的公主、童話改寫：白雪與紅玫瑰、童話改寫：六隻天鵝、童話改寫：杜松樹、童話改寫：哈默林的吹笛人、童話改寫：藍鬍子、童話改寫：驢皮公主、童話改寫：快樂王子、童話改寫：星孩、童話改寫：夜鶯與玫瑰、童話改寫：自私的巨人、童話改寫：金河王、童話改寫：北風的背後、童話改寫：公主與哥布林、童話改寫：輕輕公主、童話改寫：水孩子、童話改寫：胡桃鉗與老鼠王、童話改寫：青鳥、童話改寫：尼爾斯騎鵝旅行記、童話改寫：火鳥、童話改寫：美麗的瓦西莉莎、童話改寫：雪姑娘、童話改寫：竹取物語、童話改寫：浦島太郎、童話改寫：鶴的報恩、童話改寫：白蛇傳、童話改寫：格列佛遊記、童話改寫：吹牛男爵歷險記'.split('、').filter(w => !have.has(w));
            s.worldPool = [...poolList(), ...add].join('、');
            saveSettings(); renderPanel();
            toast(add.length ? `加入了 ${add.length} 個童話` : '抽籤池裡已經都有了', 'success');
            break;
        }
        case 'reroll_worlds': cs.rolled = rollWorlds(Math.min(8, Math.max(1, Number(s.rollCount) || 3))); commit(); break;
        case 'next_cancel_side': cs.next = { kind: 'main' }; cs.options = []; commit(); break;
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
            const keys = ['name', 'hook', 'hook_type', 'worldline', 'line_type', 'difficulty', 'axes', 'mechanic_revealed', 'time_limit_days', 'total_acts', 'current_act', 'act_progress', 'ending_range', 'status', 'pollution', 'pollution_source'];
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
            if (confirm('確定把所有規則還原為預設？你的修改與自訂規則都會消失。')) { s.rules = clone(DEFAULT_RULES); s.deletedRuleIds = []; commit(); }
            break;
        case 'rules_restore_missing':
            s.deletedRuleIds = [];
            DEFAULT_RULES.forEach(d => { if (!s.rules.find(r => r.id === d.id)) s.rules.push(clone(d)); });
            commit();
            break;
        case 'batch_toggle': batchMode = !batchMode; batchSel.clear(); renderPanel(); break;
        case 'batch_clear': batchSel.clear(); renderPanel(); break;
        case 'batch_all': s.rules.filter(r => (r.folder || '') === (b.dataset.folder || '') || (!b.dataset.folder && !s.folders.find(f => f.id === r.folder))).forEach(r => batchSel.add(r.id)); renderPanel(); break;
        case 'batch_move': {
            const target = document.getElementById('nova_batch_target')?.value || '';
            const ids = orderedRules().filter(r => batchSel.has(r.id)).map(r => r.id);
            ids.forEach(id => moveRuleToFolder(id, target));
            const name = (s.folders.find(f => f.id === target) || { name: '未分類' }).name;
            toast(`已把 ${ids.length} 條規則移到「${name}」`, 'success');
            batchSel.clear();
            commit();
            break;
        }
        case 'folder_add': {
            const name = prompt('資料夾名稱', '新資料夾');
            if (!name) break;
            s.folders.push({ id: 'f_' + Date.now(), name: name.trim(), enabled: true, collapsed: false });
            commit();
            break;
        }
        case 'folder_rename': {
            const fd = s.folders[Number(b.dataset.fi)];
            const name = fd && prompt('資料夾名稱', fd.name);
            if (name) { fd.name = name.trim(); commit(); }
            break;
        }
        case 'folder_up': case 'folder_down': {
            const i = Number(b.dataset.fi);
            const j = act === 'folder_up' ? i - 1 : i + 1;
            if (j < 0 || j >= s.folders.length) break;
            [s.folders[i], s.folders[j]] = [s.folders[j], s.folders[i]];
            commit();
            break;
        }
        case 'folder_del': {
            const fd = s.folders[Number(b.dataset.fi)];
            if (!fd || !confirm(`刪除資料夾「${fd.name}」？裡面的規則不會被刪掉，會移到「未分類」。`)) break;
            s.rules.forEach(r => { if (r.folder === fd.id) r.folder = ''; });
            s.folders = s.folders.filter(x => x.id !== fd.id);
            commit();
            break;
        }
        case 'rule_add': {
            const id = 'custom_' + Date.now();
            s.rules.push({ id, title: '新規則', modes: ['instance'], enabled: true, custom: true, content: '', folder: b.dataset.folder || '' });
            openRuleId = id;
            commit();
            break;
        }
        case 'rule_dup': {
            const r = s.rules[Number(b.dataset.i)];
            if (!r) break;
            const id = 'custom_' + Date.now();
            s.rules.splice(Number(b.dataset.i) + 1, 0, Object.assign(clone(r), { id, title: r.title + '（複製）', custom: true }));
            openRuleId = id;
            commit();
            break;
        }
        case 'rule_del': {
            const i = Number(b.dataset.i);
            const r = s.rules[i];
            if (!r || !confirm(`確定刪除「${r.title}」？`)) break;
            if (!r.custom && !s.deletedRuleIds.includes(r.id)) s.deletedRuleIds.push(r.id);
            s.rules.splice(i, 1);
            commit();
            break;
        }
        case 'rule_top': case 'rule_bottom': case 'rule_up': case 'rule_down': {
            // 只在同一個資料夾裡移動
            const i = Number(b.dataset.i);
            const r = s.rules[i];
            const same = s.rules.map((x, k) => k).filter(k => (s.rules[k].folder || '') === (r.folder || ''));
            const pos = same.indexOf(i);
            let target;
            if (act === 'rule_top') target = same[0];
            else if (act === 'rule_bottom') target = same[same.length - 1];
            else if (act === 'rule_up') target = same[pos - 1];
            else target = same[pos + 1];
            if (target === undefined || target === i) break;
            if (act === 'rule_up' || act === 'rule_down') {
                [s.rules[i], s.rules[target]] = [s.rules[target], s.rules[i]];
            } else {
                const anchor = s.rules[target];
                s.rules.splice(i, 1);
                const at = s.rules.indexOf(anchor);
                s.rules.splice(act === 'rule_top' ? at : at + 1, 0, r);
            }
            openRuleId = r.id;
            commit();
            break;
        }

        case 'ledger_del': {
            const i = Number(b.dataset.i);
            const l = s.ledger[i];
            if (!l || !confirm(`刪除帳本中的「${l.name}」？（不會刪除世界線紀錄）`)) break;
            s.ledger.splice(i, 1);
            s.ledger.forEach((x, k) => { x.no = k + 1; });
            commit();
            break;
        }
        case 'wl_del': {
            const i = Number(b.dataset.i);
            const w = s.worldlines[i];
            if (!w || !confirm(`刪除世界線 ${w.coordinate}？`)) break;
            s.worldlines.splice(i, 1);
            commit();
            break;
        }
        case 'reset_chat':
            if (confirm('清除這個聊天的副本狀態與快照？模式會回到「關閉」，聊天內容不會被刪。')) {
                resetChatInstance('off');
            }
            break;
        case 'reset_ledger':
            if (confirm('清空全部帳本與世界線紀錄？')) { s.ledger = []; s.worldlines = []; commit(); }
            break;
        case 'reset_all':
            if (confirm('清空全部遊玩資料？（帳本、世界線、背包、碎片、現實獎勵、白域詞彙、通訊器聯絡人）') && confirm('真的確定嗎？這無法復原。')) {
                s.ledger = []; s.worldlines = []; s.inventory = { shards: 0, items: [] }; s.rewards = []; s.glossary_global = [];
                P().contacts = []; phoneView = null;
                commit();
            }
            break;
        case 'export': {
            const safe = clone(s);
            if (safe.api) safe.api.key = '';
            const data = { settings: safe, chat: cs };
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
                const oldApi = clone(S().api);
                ctx().extensionSettings[MODULE] = obj.settings;
                if (oldApi?.key && !obj.settings.api?.key) obj.settings.api = oldApi;
                if (obj.chat && confirm('也要把備份中的副本狀態套用到目前這個聊天嗎？')) ctx().chatMetadata[MODULE] = obj.chat;
                commit();
            };
            input.click();
            break;
        }
        case 'preview': {
            const text = sub(buildCoreText()) + '\n\n' + sub(buildRulesText()) + '\n\n' + sub(buildStateText());
            openEditor('注入預覽（僅供檢視）', text, null);
            break;
        }
    }
}

function onBodyChange(ev) {
    const t = ev.target;
    const cs = C();
    const s = S();
    if (t.dataset.bind === 'mode') {
        if (t.value === 'opening' && cs.instance) {
            if (confirm('這個聊天裡還有上一個副本的資料。要清掉它，開始全新的副本嗎？\n（選「取消」則保留舊資料，只切換模式）')) {
                resetChatInstance('opening');
                return;
            }
        }
        cs.mode = t.value; commit(); return;
    }
    if (t.dataset.seed) { cs.seed[t.dataset.seed] = t.value; saveChatState(); updateInjection(); return; }
    if (t.dataset.note !== undefined) { const p = cs.instance?.people[Number(t.dataset.note)]; if (p) { p.player_note = t.value; commit(); } return; }
    if (t.dataset.ruleOn !== undefined) { s.rules[Number(t.dataset.ruleOn)].enabled = t.checked; saveSettings(); updateInjection(); return; }
    if (t.dataset.ruleMode !== undefined) {
        const r = s.rules[Number(t.dataset.ruleMode)];
        const set = new Set(r.modes || []);
        if (t.checked) set.add(t.value); else set.delete(t.value);
        r.modes = Array.from(set);
        openRuleId = r.id;
        saveSettings(); updateInjection(); renderPanel(); return;
    }
    if (t.dataset.ruleText !== undefined) { const r = s.rules[Number(t.dataset.ruleText)]; r.content = t.value; openRuleId = r.id; saveSettings(); updateInjection(); return; }
    if (t.dataset.rulePrio !== undefined) { const r = s.rules[Number(t.dataset.rulePrio)]; r.priority = t.value; openRuleId = r.id; saveSettings(); updateInjection(); renderPanel(); return; }
    if (t.dataset.ruleFolder !== undefined) { const r = s.rules[Number(t.dataset.ruleFolder)]; r.folder = t.value; openRuleId = r.id; saveSettings(); updateInjection(); renderPanel(); return; }
    if (t.dataset.batchId !== undefined) { if (t.checked) batchSel.add(t.dataset.batchId); else batchSel.delete(t.dataset.batchId); renderPanel(); return; }
    if (t.dataset.folderDesc !== undefined) { const fd = s.folders[Number(t.dataset.folderDesc)]; if (fd) { fd.desc = t.value.trim(); saveSettings(); updateInjection(); } return; }
    if (t.dataset.folderOn !== undefined) { const fd = s.folders[Number(t.dataset.folderOn)]; if (fd) { fd.enabled = t.checked; saveSettings(); updateInjection(); renderPanel(); } return; }
    if (t.dataset.ruleFilter) { s.ruleFilter = t.value; saveSettings(); renderPanel(); return; }
    if (t.dataset.ruleTitle !== undefined) {
        const r = s.rules[Number(t.dataset.ruleTitle)];
        r.title = t.value.trim() || '未命名規則';
        openRuleId = r.id;
        saveSettings(); renderPanel(); return;
    }
    if (t.dataset.api) {
        if (!s.api) s.api = {};
        const k = t.dataset.api;
        s.api[k] = t.type === 'number' ? Number(t.value) : t.value;
        saveSettings();
        if (k === 'provider') renderPanel();
        return;
    }
    if (t.dataset.phoneSet) { const ph = P(); ph[t.dataset.phoneSet] = Math.max(0, Number(t.value) || 0); saveSettings(); return; }
    if (t.dataset.set === 'bannedWords') { s.bannedWords = t.value; saveSettings(); return; }
    if (t.dataset.set) {
        const k = t.dataset.set;
        s[k] = t.type === 'checkbox' ? t.checked : (t.type === 'number' ? Number(t.value) : t.value);
        saveSettings(); updateInjection(); renderPanel(); return;
    }
}

// ───────────────────────── 浮球 ─────────────────────────
// 可拖曳；點一下開關面板；位置記在全域設定

const BALL_SIZE = 46;

function clampBall(x, y) {
    const w = window.innerWidth, h = window.innerHeight;
    return {
        x: Math.min(Math.max(4, x), Math.max(4, w - BALL_SIZE - 4)),
        y: Math.min(Math.max(4, y), Math.max(4, h - BALL_SIZE - 4)),
    };
}

function placeBall() {
    const ball = document.getElementById('nova_inf_ball');
    if (!ball) return;
    const s = S();
    const pos = s.floatPos || { x: window.innerWidth - BALL_SIZE - 16, y: Math.round(window.innerHeight * 0.55) };
    const p = clampBall(pos.x, pos.y);
    ball.style.left = p.x + 'px';
    ball.style.top = p.y + 'px';
}

function ensureBall() {
    if (document.getElementById('nova_inf_ball')) return;
    const ball = document.createElement('div');
    ball.id = 'nova_inf_ball';
    ball.title = '無限流面板（可拖曳）';
    ball.innerHTML = '<span class="nova-ball-icon">∞</span>';
    document.body.appendChild(ball);

    let start = null, moved = false;
    ball.addEventListener('pointerdown', e => {
        if (e.button !== undefined && e.button !== 0) return;
        start = { px: e.clientX, py: e.clientY, x: parseFloat(ball.style.left) || 0, y: parseFloat(ball.style.top) || 0 };
        moved = false;
        try { ball.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    });
    ball.addEventListener('pointermove', e => {
        if (!start) return;
        const dx = e.clientX - start.px, dy = e.clientY - start.py;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        moved = true;
        ball.classList.add('dragging');
        const p = clampBall(start.x + dx, start.y + dy);
        ball.style.left = p.x + 'px';
        ball.style.top = p.y + 'px';
    });
    const end = () => {
        if (!start) return;
        if (moved) {
            S().floatPos = { x: Math.round(parseFloat(ball.style.left) || 0), y: Math.round(parseFloat(ball.style.top) || 0) };
            saveSettings();
        } else {
            togglePanel();
        }
        start = null;
        ball.classList.remove('dragging');
    };
    ball.addEventListener('pointerup', end);
    ball.addEventListener('pointercancel', () => { start = null; ball.classList.remove('dragging'); });
    window.addEventListener('resize', placeBall);
    placeBall();
    syncBall();
}

function syncBall() {
    const ball = document.getElementById('nova_inf_ball');
    if (!ball) return;
    const s = S();
    const cs = C();
    ball.classList.toggle('nova-inf-hidden', s.floatBall === false);
    ball.classList.toggle('off', !cs || cs.mode === 'off' || !s.enabled);
    const open = !document.getElementById('nova_inf_panel')?.classList.contains('nova-inf-hidden');
    ball.classList.toggle('open', !!open);
    ball.querySelector('.nova-ball-icon').textContent = open ? '✕' : '∞';
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
                    <button class="menu_button" id="nova_inf_ball_btn">顯示／隱藏浮球</button>
                    <p class="nova-inf-hint">也可以點畫面上的 ∞ 浮球，或從輸入框左邊的魔杖選單打開。</p>
                </div>
            </div>`;
        settings.appendChild(box);
        document.getElementById('nova_inf_open_btn').addEventListener('click', togglePanel);
        document.getElementById('nova_inf_ball_btn').addEventListener('click', () => {
            const st = S(); st.floatBall = st.floatBall === false; saveSettings(); ensureBall(); placeBall(); syncBall();
        });
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
    ensureBall();

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
