/* ============================================================
   CORE MACHINERY. Storage, identity, records, model access,
   research, writing pipeline and enforcement.
   ============================================================ */

var App = { user: null, account: null, page: 'home', tab: 'profiles', truncated: false };

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function uid(){ return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function nowIso(){ return new Date().toISOString(); }
function fmtDate(iso){ if(!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'}); }
function fmtDateTime(iso){ if(!iso) return ''; var d = new Date(iso); return d.toLocaleDateString('en-GB', {day:'numeric', month:'short'}) + ' ' + d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'}); }
function wordCount(s){ var m = String(s||'').trim().split(/\s+/).filter(Boolean); return m.length; }
function firstName(name){ return String(name||'').trim().split(/\s+/)[0] || 'there'; }
function fullEmail(body){ return String(body||'').trim() + '\n\n' + signoff() + '\n' + senderName(); }
function personalise(text, name){ var out = String(text||''); ['[First name]','[first name]'].forEach(function(tok){ out = out.split(tok).join(name ? firstName(name) : tok); }); return out; }

/* ---------- Store wrapper ---------- */
var Store = (function(){
  var PREFIX = 'eas_';
  var mem = {};
  var usable = true;
  try { localStorage.setItem(PREFIX + '__probe', '1'); localStorage.removeItem(PREFIX + '__probe'); }
  catch(e){ usable = false; }
  /* Account level data is shared by everyone who works the account: one
     contact list, one set of profile research, one set of edits. It is
     scoped to the account alone, never to the person, and every change to
     it is pushed to the shared store. Private data stays per person. */
  var ACCT_KEYS = ['contacts','approved','email_edits','rec_profiles'];
  var USER_ACCT_KEYS = ['assistant_chat'];
  var USER_KEYS = ['sender_name','model_choice'];
  function scope(key){
    if (ACCT_KEYS.indexOf(key) >= 0) return key + '@' + (App.account || 'hub');
    if (USER_ACCT_KEYS.indexOf(key) >= 0 && App.user) return key + '@' + (App.account || 'hub') + '@' + App.user;
    if (USER_KEYS.indexOf(key) >= 0 && App.user) return key + '@' + App.user;
    return key;
  }
  function rawKeys(){
    var out = [];
    if (usable){ try { for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length)); } } catch(e){} }
    for (var m in mem) if (out.indexOf(m) < 0) out.push(m);
    return out;
  }
  function rawGet(k){ if (usable) { try { return localStorage.getItem(k); } catch(e){} } return (k in mem) ? mem[k] : null; }
  function rawSet(k, v){ if (usable) { try { localStorage.setItem(k, v); return; } catch(e){} } mem[k] = v; }
  return {
    usable: function(){ return usable; },
    get: function(k){ return rawGet(PREFIX + scope(k)); },
    set: function(k, v){ rawSet(PREFIX + scope(k), String(v)); },
    getJSON: function(k, fallback){
      var v = rawGet(PREFIX + scope(k));
      if (v == null) return fallback;
      try { return JSON.parse(v); } catch(e){ return fallback; }
    },
    setJSON: function(k, v){ rawSet(PREFIX + scope(k), JSON.stringify(v)); },
    keys: rawKeys,
    /* Before 2.1.0 the account data was held per person. On first opening an
       account under 2.1.0, everything any person on this device held for it
       is gathered into the shared account copy, so nothing already done is
       lost. Runs once per account. */
    adoptLegacy: function(acct){
      var flag = PREFIX + 'adopted_v21@' + acct;
      if (rawGet(flag)) return false;
      var changed = false;
      var all = rawKeys();
      ACCT_KEYS.forEach(function(key){
        var target = PREFIX + key + '@' + acct;
        var legacy = all.filter(function(k){ return k.indexOf(key + '@' + acct + '@') === 0; });
        if (!legacy.length) return;
        var current = null;
        try { current = JSON.parse(rawGet(target)); } catch(e){}
        legacy.forEach(function(k){
          var v = null;
          try { v = JSON.parse(rawGet(PREFIX + k)); } catch(e){}
          if (v == null) return;
          if (key === 'contacts' || key === 'approved'){
            current = current || [];
            var have = {};
            current.forEach(function(c){ have[key === 'contacts' ? c.cid : c] = true; });
            v.forEach(function(c){ var id = key === 'contacts' ? c.cid : c; if (!have[id]){ current.push(c); have[id] = true; changed = true; } });
          } else {
            current = current || {};
            for (var pid in v){
              if (!current[pid] || JSON.stringify(v[pid]).length > JSON.stringify(current[pid]).length){ current[pid] = v[pid]; changed = true; }
            }
          }
        });
        if (current != null) rawSet(target, JSON.stringify(current));
      });
      rawSet(flag, nowIso());
      return changed;
    },
    migrate: function(){ /* No legacy data exists at the hub address. */ }
  };
})();

/* ---------- SHA-256 (pure JS, so elevation works in any context) ---------- */
function sha256(ascii){
  function rr(v, c){ return (v >>> c) | (v << (32 - c)); }
  var mathPow = Math.pow, maxWord = mathPow(2, 32), result = '';
  var words = [], asciiBitLength = ascii.length * 8;
  var hash = sha256.h = sha256.h || [], k = sha256.k = sha256.k || [], primeCounter = k.length;
  var isComposite = {};
  for (var candidate = 2; primeCounter < 64; candidate++){
    if (!isComposite[candidate]){
      for (var i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++){
    var j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  for (j = 0; j < words.length;){
    var w = words.slice(j, j += 16), oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++){
      var w15 = w[i - 15], w2 = w[i - 2];
      var a = hash[0], e = hash[4];
      var temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
      var temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (i = 0; i < 8; i++){
    for (j = 3; j + 1; j--){
      var b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

/* ---------- Identity and roles ---------- */
var SUPER_ADMINS = ['kayvee.pro@gmail.com','siva.prasad@futurebridge.com'];
var SEC_QUESTION = 'What was the make of your first car?';
var SEC_HASH = 'ac85892205b92e8cecdc87185a3fbf039f04b2a7751ccf0e8a1f547d53b9945a';

function answeredMap(){ return Store.getJSON('sa_answered', {}); }
function isSuper(){
  /* Membership of the fixed email list AND the answered flag, always tested together. */
  return SUPER_ADMINS.indexOf(App.user) >= 0 && answeredMap()[App.user] === true;
}

/* The hub user list: email -> { salt, hash, role: 'admin'|'read' }.
   Read is the default. Legacy records may carry levels/admins maps from the
   per-account era; userRole() maps any Full grant to Admin. */
function hubUsers(){ return Store.getJSON('hub_users', {}); }
function saveHubUsers(u){ Store.setJSON('hub_users', u); }
function randSalt(){
  var s = '';
  for (var i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
/* Owner accounts ship pre-provisioned so the first sign-in on any device
   works immediately. The password can and should be changed in Settings;
   a change overrides this seed everywhere through the shared store. */
var OWNER_SEED = { salt: 'fb2026seed', hash: 'ba9545581f701591077e4ebfc4318d338065686896aaa9b30b6fbdd83b20184f' };
function seedOwnerPasswords(){
  var users = hubUsers();
  var changed = false;
  SUPER_ADMINS.forEach(function(e){
    if (!users[e] || !users[e].hash){
      users[e] = { salt: OWNER_SEED.salt, hash: OWNER_SEED.hash, levels: (users[e] && users[e].levels) || {}, admins: (users[e] && users[e].admins) || {} };
      changed = true;
    }
  });
  if (changed) saveHubUsers(users);
}
function setUserPassword(email, pw){
  var users = hubUsers();
  var rec = users[email] || { levels: {}, admins: {} };
  rec.salt = randSalt();
  rec.hash = sha256(rec.salt + ':' + String(pw));
  users[email] = rec;
  saveHubUsers(users);
  Cloud.pushUser(email);
  return rec;
}
function checkPassword(email, pw){
  var rec = hubUsers()[email];
  if (!rec || !rec.hash) return false;
  return sha256(rec.salt + ':' + String(pw)) === rec.hash;
}
/* Three access levels, hub-wide. Super admin: the fixed email list plus the
   security answer, complete access. Admin: every studio, can research,
   generate, edit, review, approve and download the practice-review and
   approved mails, but cannot add contacts, import CSVs or touch hub
   settings. Read: account overviews plus contacts and their generated
   profiles, nothing else. Legacy per-account Full grants map to Admin. */
function userRole(){
  if (isSuper()) return 'super';
  var rec = hubUsers()[App.user];
  if (!rec) return '';
  if (rec.role === 'admin' || rec.role === 'read') return rec.role;
  /* Legacy record without a role: any Full grant means Admin. */
  var lv = rec.levels || {};
  for (var k in lv) if (lv[k] === 'full') return 'admin';
  return 'read';
}
function canFull(acctId){
  /* Tested at render time. The account and the role are always tested together. */
  var a = accountById(acctId);
  if (!a || a.type !== 'studio') return false;
  var r = userRole();
  return r === 'super' || r === 'admin';
}
function canRead(acctId){
  var a = accountById(acctId);
  if (!a) return false;
  var r = userRole();
  return r === 'super' || r === 'admin' || r === 'read';
}
function canUploadContacts(){ return isSuper(); }
function isAcctAdmin(acctId){ return isSuper(); }
function isAdmin(){ return isSuper(); }
function senderName(){ return Store.get('sender_name') || 'Sarah'; }
function signoff(){ return Store.get('signoff') || 'Best regards,'; }

/* ---------- Action log ---------- */
var Log = {
  add: function(action, detail){
    var entries = Store.getJSON('action_log', []);
    var e = { ts: nowIso(), actor: App.user || 'unknown', action: action, detail: String(detail || '') };
    entries.push(e);
    if (entries.length > 12000) entries = entries.slice(entries.length - 12000);
    Store.setJSON('action_log', entries);
    Cloud.pushLog(e);
  },
  all: function(){ return Store.getJSON('action_log', []); }
};

/* ---------- Extraction history ---------- */
var ExportHist = {
  all: function(){ return Store.getJSON('export_history', []); },
  add: function(kind, account, count, csv){
    var list = ExportHist.all();
    list.push({ ts: nowIso(), actor: App.user, account: account, kind: kind, count: count, csv: csv });
    if (list.length > 20) list = list.slice(list.length - 20);
    Store.setJSON('export_history', list);
    Log.add('export', kind + ': ' + count + ' items (' + account + ')');
  }
};

/* Fields that describe the screen, not the data: never synced, never
   overwritten by a pull. */
var TRANSIENT_FIELDS = ['sel','open','busy','editOpen','error','assistNote'];
function stripTransient(o){ var out = {}; for (var k in o) if (TRANSIENT_FIELDS.indexOf(k) < 0) out[k] = o[k]; return out; }

/* ---------- Central draft record ---------- */
var Central = {
  all: function(){ return Store.getJSON('central_record', []); },
  save: function(list){ Store.setJSON('central_record', list); },
  record: function(d){
    var list = Central.all();
    d.id = d.id || uid();
    d.account = d.account || App.account || '';
    d.author = App.user;
    d.ts = nowIso();
    d.status = d.status || 'generated';
    d.deleted = false;
    list.push(d);
    Central.save(list);
    Cloud.pushDraft(d);
    return d;
  },
  update: function(id, patch){
    var list = Central.all();
    for (var i = 0; i < list.length; i++){
      if (list[i].id === id){
        var textChanged = false;
        ['subject','body','inmail'].forEach(function(f){ if (f in patch && patch[f] !== list[i][f]) textChanged = true; });
        for (var k in patch) list[i][k] = patch[k];
        if (textChanged){ list[i].editedBy = App.user; list[i].editedAt = nowIso(); }
        list[i].updatedAt = nowIso();
        Central.save(list);
        Cloud.pushDraft(list[i]);
        return list[i];
      }
    }
    return null;
  },
  /* Approval is a stamped event: who, when, and the batch it belonged to.
     One approval action, whether 1 contact or 40 selected together, is one
     batch, so the Approved page can show each batch of the day separately. */
  approve: function(id, batchId){
    return Central.update(id, { status: 'approved', approvedAt: nowIso(), approvedBy: App.user, batchId: batchId || Central.newBatch() });
  },
  newBatch: function(){ return (App.account || 'hub') + ':' + nowIso(); },
  get: function(id){
    var list = Central.all();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
};

/* ---------- Shared cloud store (Firestore via REST) ----------
   The connection values live in config.js so that replacing this file
   never disturbs them. */
var Cloud = {
  status: { state: 'off', detail: 'The shared store is not configured.' },
  setStatus: function(state, detail){ Cloud.status = { state: state, detail: detail || '' }; },
  cfg: function(){
    return { pid: Store.get('fb_project') || DEFAULT_FB.project || '', key: Store.get('fb_key') || DEFAULT_FB.key || '' };
  },
  on: function(){ var c = Cloud.cfg(); return !!(c.pid && c.key); },
  url: function(col, id){
    var c = Cloud.cfg();
    return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(c.pid) + '/databases/(default)/documents/' + col + (id ? '/' + encodeURIComponent(id) : '') + '?key=' + encodeURIComponent(c.key) + (id ? '' : '&pageSize=300');
  },
  pushDraft: function(d){
    if (!Cloud.on()) return;
    fetch(Cloud.url('drafts', d.id), {
      method: 'PATCH', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ fields: { account: { stringValue: String(d.account || '') }, updatedAt: { stringValue: String(d.updatedAt || d.ts || '') }, json: { stringValue: JSON.stringify(d) } } })
    }).catch(function(){});
  },
  /* ----- Shared account data: contacts, profile research, edits ----- */
  docUrl: function(col, id){ return Cloud.url(col, id); },
  queryUrl: function(){
    var c = Cloud.cfg();
    return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(c.pid) + '/databases/(default)/documents:runQuery?key=' + encodeURIComponent(c.key);
  },
  pushDoc: function(col, id, acct, updatedAt, obj){
    if (!Cloud.on()) return Promise.resolve(false);
    return fetch(Cloud.url(col, id), {
      method: 'PATCH', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ fields: { account: { stringValue: String(acct) }, updatedAt: { stringValue: String(updatedAt || '') }, json: { stringValue: JSON.stringify(obj) } } })
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return null; }).then(function(b){ Cloud.setStatus('error', Cloud.explainError(b)); return false; });
      return true;
    }).catch(function(){ Cloud.setStatus('error', 'The shared store could not be reached, so the last change is held on this device only.'); return false; });
  },
  pushContact: function(acct, c){ return Cloud.pushDoc('contacts', acct + '__' + c.cid, acct, c.updatedAt, stripTransient(c)); },
  pushProfile: function(acct, pid, st){ return Cloud.pushDoc('profiles', acct + '__' + pid, acct, st.updatedAt, stripTransient(st)); },
  pushEdits: function(acct, edits){ return Cloud.pushDoc('edits', acct, acct, edits.updatedAt, edits); },
  queryByAccount: function(col, acct){
    if (!Cloud.on()) return Promise.resolve([]);
    return fetch(Cloud.queryUrl(), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: 'account' }, op: 'EQUAL', value: { stringValue: acct } } }, limit: 2000 } })
    }).then(function(r){ return r.json(); }).then(function(rows){
      if (rows && rows.error) throw { fb: rows };
      var out = [];
      (rows || []).forEach(function(row){
        var d = row && row.document;
        if (!d || !d.fields || !d.fields.json) return;
        try { out.push(JSON.parse(d.fields.json.stringValue)); } catch(e){}
      });
      return out;
    });
  },
  listAll: function(col){
    /* Every document in a collection, following page tokens. */
    var out = [];
    function page(token){
      return fetch(Cloud.url(col) + (token ? '&pageToken=' + encodeURIComponent(token) : '')).then(function(r){ return r.json(); }).then(function(data){
        if (data && data.error) throw { fb: data };
        (data && data.documents || []).forEach(function(d){ out.push(d); });
        return data && data.nextPageToken ? page(data.nextPageToken) : out;
      });
    }
    return page(null);
  },
  /* Pull everything the shared store holds for one account and merge it in.
     Newer wins, judged by updatedAt; a document this device holds that the
     store does not is pushed up, so a first sign in seeds the store. Returns
     a short report. */
  pullAccount: function(acct){
    if (!Cloud.on()) return Promise.resolve({ changed: false, note: 'The shared store is not configured; this device is working alone.' });
    var changed = false, pulled = 0, pushed = 0;
    return Cloud.queryByAccount('contacts', acct).then(function(cloud){
      var local = Store.getJSON('contacts', []);
      var byId = {};
      local.forEach(function(c, i){ byId[c.cid] = i; });
      var seen = {};
      cloud.forEach(function(cc){
        seen[cc.cid] = true;
        var i = byId[cc.cid];
        if (i == null){ if (!cc.deleted){ local.push(cc); changed = true; pulled++; } return; }
        if (String(cc.updatedAt || '') > String(local[i].updatedAt || '')){
          var keep = {};
          TRANSIENT_FIELDS.forEach(function(f){ if (f in local[i]) keep[f] = local[i][f]; });
          for (var f2 in keep) cc[f2] = keep[f2];
          local[i] = cc; changed = true; pulled++;
        } else if (String(local[i].updatedAt || '') > String(cc.updatedAt || '')){
          /* This device holds the newer copy, typically a change made while
             the store was unreachable. Send it up now. */
          Cloud.pushContact(acct, local[i]); pushed++;
        }
      });
      local = local.filter(function(c){ return !c.deleted; });
      Store.setJSON('contacts', local);
      local.forEach(function(c){ if (!seen[c.cid]){ if (!c.updatedAt) c.updatedAt = c.added || nowIso(); Cloud.pushContact(acct, c); pushed++; } });
      if (pushed) Store.setJSON('contacts', local);
      return Cloud.queryByAccount('profiles', acct);
    }).then(function(cloud){
      var ps = Store.getJSON('rec_profiles', {});
      var seen = {};
      cloud.forEach(function(st){
        if (!st || !st.pid) return;
        seen[st.pid] = true;
        var mine = ps[st.pid];
        if (!mine || String(st.updatedAt || '') > String(mine.updatedAt || '')){
          var keep = {};
          if (mine) TRANSIENT_FIELDS.forEach(function(f){ if (f in mine) keep[f] = mine[f]; });
          for (var f2 in keep) st[f2] = keep[f2];
          ps[st.pid] = st; changed = true; pulled++;
        } else if (String(mine.updatedAt || '') > String(st.updatedAt || '')){
          Cloud.pushProfile(acct, st.pid, mine); pushed++;
        }
      });
      Store.setJSON('rec_profiles', ps);
      for (var pid in ps){ if (!seen[pid] && Object.keys(ps[pid]).some(function(k){ return TRANSIENT_FIELDS.indexOf(k) < 0; })){ ps[pid].pid = pid; ps[pid].updatedAt = ps[pid].updatedAt || nowIso(); Cloud.pushProfile(acct, pid, ps[pid]); pushed++; } }
      if (pushed) Store.setJSON('rec_profiles', ps);
      return fetch(Cloud.url('edits', acct)).then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
    }).then(function(doc){
      var mine = Store.getJSON('email_edits', {});
      if (doc && doc.fields && doc.fields.json){
        try {
          var theirs = JSON.parse(doc.fields.json.stringValue);
          if (String(theirs.updatedAt || '') > String(mine.updatedAt || '')){ Store.setJSON('email_edits', theirs); changed = true; pulled++; }
          else if (Object.keys(mine).length > 1 && String(mine.updatedAt || '') > String(theirs.updatedAt || '')){ Cloud.pushEdits(acct, mine); pushed++; }
        } catch(e){}
      } else if (Object.keys(mine).length){ mine.updatedAt = mine.updatedAt || nowIso(); Store.setJSON('email_edits', mine); Cloud.pushEdits(acct, mine); pushed++; }
      return Cloud.listAll('drafts');
    }).then(function(docs){
      var local = Central.all();
      var byId = {};
      local.forEach(function(r, i){ byId[r.id] = i; });
      docs.forEach(function(d){
        try {
          var r = JSON.parse(d.fields.json.stringValue);
          if (!r || !r.id) return;
          var i = byId[r.id];
          if (i == null){ local.push(r); byId[r.id] = local.length - 1; changed = true; pulled++; }
          else if (String(r.updatedAt || r.ts || '') > String(local[i].updatedAt || local[i].ts || '')){ local[i] = r; changed = true; pulled++; }
        } catch(e){}
      });
      Central.save(local);
      App.lastSync = nowIso();
      Cloud.setStatus('ok', 'Connected. Account data synced ' + fmtDateTime(App.lastSync) + '.');
      return { changed: changed, note: pulled + ' item' + (pulled === 1 ? '' : 's') + ' pulled' + (pushed ? ', ' + pushed + ' pushed' : '') + '.' };
    }).catch(function(err){
      Cloud.setStatus('error', err && err.fb ? Cloud.explainError(err.fb) : 'The shared store could not be reached. Working from this device only until it can.');
      return { changed: false, note: Cloud.status.detail };
    });
  },
  pushLog: function(e){
    if (!Cloud.on()) return;
    fetch(Cloud.url('logs'), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ fields: { actor: {stringValue: e.actor}, action: {stringValue: e.action}, ts: {stringValue: e.ts}, detail: {stringValue: e.detail} } })
    }).catch(function(){});
  },
  explainError: function(body, fallback){
    var msg = body && body.error && body.error.message ? String(body.error.message) : (fallback || 'The shared store did not accept the request.');
    if (/PERMISSION_DENIED/i.test(msg)) return 'The shared store refused access. The Firestore test-mode rules have probably expired: open the Firebase console, Firestore Database, Rules, and set allow read, write: if true.';
    if (/API key not valid|API_KEY/i.test(msg)) return 'The shared store web API key is not valid. Check the key in Settings or in the file.';
    if (/project|NOT_FOUND/i.test(msg)) return 'The shared store project was not found. Check the project ID.';
    return 'The shared store returned an error: ' + msg.slice(0, 140);
  },
  pushUser: function(email){
    if (!Cloud.on()){ Cloud.setStatus('off', 'The shared store is not configured, so this user exists only on this device.'); return; }
    var rec = hubUsers()[email];
    var id = email.replace(/[^a-z0-9]/gi, '_');
    fetch(Cloud.url('users', id), {
      method: 'PATCH', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ fields: { json: { stringValue: JSON.stringify({ email: email, rec: rec }) } } })
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return null; }).then(function(b){ Cloud.setStatus('error', Cloud.explainError(b)); });
      Cloud.setStatus('ok', 'Access changes are reaching the shared store.');
    }).catch(function(){ Cloud.setStatus('error', 'The shared store could not be reached. Check the network or an ad blocker on firestore.googleapis.com.'); });
  },
  pushHubAccount: function(a){
    if (!Cloud.on()) return;
    if (JSON.stringify(a).length > 900000){
      Cloud.setStatus('error', 'The account "' + a.name + '" is larger than the shared store document limit, so it stays on this device. Trim the summary or source content to share it.');
      return;
    }
    fetch(Cloud.url('accounts', a.id), {
      method: 'PATCH', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ fields: { json: { stringValue: JSON.stringify(a) } } })
    }).then(function(r){
      if (!r.ok) return r.json().catch(function(){ return null; }).then(function(b){ Cloud.setStatus('error', Cloud.explainError(b)); });
    }).catch(function(){ Cloud.setStatus('error', 'The shared store could not be reached.'); });
  },
  refreshAccess: function(){
    /* Pull the user list and overview accounts before deciding levels. Cloud wins. */
    if (!Cloud.on()){ Cloud.setStatus('off', 'The shared store is not configured.'); return Promise.resolve(false); }
    var pulled = 0;
    return fetch(Cloud.url('users')).then(function(r){ return r.json(); }).then(function(data){
      if (data && data.error) throw { fb: data };
      var docs = (data && data.documents) || [];
      var users = hubUsers();
      for (var i = 0; i < docs.length; i++){
        try {
          var o = JSON.parse(docs[i].fields.json.stringValue);
          if (o.email && o.rec){ users[o.email] = o.rec; pulled++; }
        } catch(e){}
      }
      saveHubUsers(users);
      return fetch(Cloud.url('accounts'));
    }).then(function(r){ return r.json(); }).then(function(data){
      if (data && data.error) throw { fb: data };
      var docs = (data && data.documents) || [];
      var local = overviewAccounts();
      var byId = {};
      for (var i = 0; i < local.length; i++) byId[local[i].id] = i;
      for (var j = 0; j < docs.length; j++){
        try {
          var a = JSON.parse(docs[j].fields.json.stringValue);
          if (!a.id) continue;
          if (byId[a.id] != null) local[byId[a.id]] = a; else local.push(a);
        } catch(e){}
      }
      saveOverviewAccounts(local);
      Cloud.setStatus('ok', 'Connected. ' + pulled + ' user record' + (pulled === 1 ? '' : 's') + ' pulled from the shared store.');
      return true;
    }).catch(function(err){
      Cloud.setStatus('error', err && err.fb ? Cloud.explainError(err.fb) : 'The shared store could not be reached. Check the network or an ad blocker on firestore.googleapis.com.');
      return false;
    });
  },
  refresh: function(){
    if (!Cloud.on()) return Promise.resolve('The shared store is not configured. The studio is running local-only.');
    var report = [];
    return fetch(Cloud.url('drafts')).then(function(r){ return r.json(); }).then(function(data){
      var docs = (data && data.documents) || [];
      var local = Central.all();
      var byId = {};
      for (var i = 0; i < local.length; i++) byId[local[i].id] = i;
      var merged = 0;
      for (var j = 0; j < docs.length; j++){
        try {
          var d = JSON.parse(docs[j].fields.json.stringValue);
          if (byId[d.id] != null) local[byId[d.id]] = d; else local.push(d);
          merged++;
        } catch(e){}
      }
      Central.save(local);
      report.push(merged + ' drafts merged from the shared store (cloud wins on conflict).');
      return fetch(Cloud.url('logs'));
    }).then(function(r){ return r.json(); }).then(function(data){
      var docs = (data && data.documents) || [];
      var local = Log.all();
      var seen = {};
      for (var i = 0; i < local.length; i++) seen[local[i].actor + '|' + local[i].action + '|' + local[i].ts] = true;
      var added = 0;
      for (var j = 0; j < docs.length; j++){
        var f = docs[j].fields || {};
        var e = { actor: f.actor ? f.actor.stringValue : '', action: f.action ? f.action.stringValue : '', ts: f.ts ? f.ts.stringValue : '', detail: f.detail ? f.detail.stringValue : '' };
        var k = e.actor + '|' + e.action + '|' + e.ts;
        if (!seen[k]){ local.push(e); seen[k] = true; added++; }
      }
      local.sort(function(a, b){ return a.ts < b.ts ? -1 : 1; });
      Store.setJSON('action_log', local);
      report.push(added + ' log entries added.');
      return report.join(' ');
    }).catch(function(err){
      return 'The shared store refresh failed: ' + (err && err.message ? err.message : 'network error') + '. Check the project ID and key in Settings.';
    });
  }
};


/* ---------- HubSpot push ----------
   HubSpot blocks direct browser calls to its API for security, so the
   reliable direct route is a relay URL (a small forwarder holding the
   token). Without one, the studio attempts the direct call, and on the
   expected refusal falls back to the structured import file. */
function batchStamp(){
  /* Human readable and stable for the whole push: account plus the date. */
  var a = accountById(App.account);
  var name = (a && a.name) || App.account || 'Account';
  var d = new Date();
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return name + ' ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}
function hubspotPayload(items){
  var acct = accountById(App.account);
  var acctName = (acct && acct.name) || App.account || '';
  var stamp = batchStamp();
  return items.map(function(r){
    var c = contacts().filter(function(x){ return x.draftId === r.id; })[0] || {};
    var parts = String(r.contact || '').split(/\s+/);
    var ents = seqEntities();
    var ent = null;
    for (var i = 0; i < ents.length; i++){
      var recId = ents[i].key.indexOf('p:') === 0 ? (ents[i].holder.approvedId || ents[i].holder.lastRecordId) : ents[i].holder.draftId;
      if (recId === r.id || ents[i].name === r.contact){ ent = ents[i]; break; }
    }
    var t2 = ent && ent.seq.touches && ent.seq.touches[1] || {};
    var t3 = ent && ent.seq.touches && ent.seq.touches[2] || {};
    return {
      properties: {
        email: c.email || '', firstname: parts[0] || '', lastname: parts.slice(1).join(' '),
        jobtitle: r.title || c.title || '', company: r.company || '', city: c.city || '', country: c.country || '',
        linkedin_url: c.linkedin || '',
        eas_account: acctName,
        eas_batch: stamp
      },
      outreach: {
        subject1: r.subject, email1: fullEmail(r.body), inmail1: r.inmail || '',
        subject2: t2.subject || '', email2: t2.body ? fullEmail(t2.body) : '', inmail2: t2.inmail || '',
        subject3: t3.subject || '', email3: t3.body ? fullEmail(t3.body) : '', inmail3: t3.inmail || ''
      }
    };
  });
}
function hubspotPush(items){
  var token = Store.get('hs_token') || '';
  var proxy = Store.get('hs_proxy') || '';
  var payload = hubspotPayload(items);
  if (proxy){
    return fetch(proxy, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, records: payload })
    }).then(function(r){
      if (!r.ok) throw new Error('The relay refused the push (' + r.status + '). Check the relay URL and token in Settings.');
      return { ok: true, how: 'relay' };
    });
  }
  if (!token) return Promise.reject(new Error('NO_CONFIG'));
  /* Direct attempt: HubSpot is expected to refuse browser calls. */
  var first = payload[0];
  return fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: first.properties })
  }).then(function(r){
    if (!r.ok) throw new Error('HubSpot refused the direct call (' + r.status + ').');
    /* Direct calls work in this environment: push the rest, then notes. */
    var chain = Promise.resolve();
    payload.slice(1).forEach(function(p){
      chain = chain.then(function(){
        return fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
          method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: p.properties })
        });
      });
    });
    return chain.then(function(){ return { ok: true, how: 'direct' }; });
  });
}

/* ---------- Model access ---------- */
var MODELS = [
  { id: 'claude-fable-5',   label: 'Claude Fable 5',  superOnly: true },
  { id: 'claude-opus-4-8',  label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
];
var FALLBACK_CHAIN = ['claude-opus-4-8','claude-sonnet-4-6','claude-haiku-4-5'];
var BUDGET = { research: 4500, audit: 3000, email: 2500, followup: 1300, repair: 1300, assistant: 1300 };

function chosenModel(){
  var m = Store.get('model_choice') || 'claude-opus-4-8';
  var meta = null;
  for (var i = 0; i < MODELS.length; i++) if (MODELS[i].id === m) meta = MODELS[i];
  if (!meta || (meta.superOnly && !isSuper())) return 'claude-opus-4-8';
  return m;
}

function apiErrorMessage(status, body){
  var msg = (body && body.error && body.error.message) || '';
  if (status === 401) return 'The Anthropic API key was rejected. Open Settings and paste a current key.';
  if (status === 400 && /credit/i.test(msg)) return 'The Anthropic account is out of credit. Top up the credit balance, then try again.';
  if ((status === 404 || status === 400) && /model/i.test(msg)) return 'MODEL_UNAVAILABLE';
  if (status === 529 || status === 429) return 'The model is briefly overloaded or rate limited. Wait a moment and try again.';
  return 'The request failed (' + status + '). ' + (msg || 'Try again in a moment.');
}

/* Calls the Anthropic Messages API directly from the browser.
   Handles model fallback, tool-drop retry and truncation flagging. */
function callModel(opts){
  App.truncated = false;
  var key = Store.get('anthropic_key') || '';
  if (!key) return Promise.reject(new Error('No Anthropic API key is saved. Open Settings and paste your key.'));
  var model = opts.model || chosenModel();
  var attempted = [];
  function attempt(m, tools, toolNote){
    attempted.push(m);
    var body = {
      model: m,
      max_tokens: opts.maxTokens || 1500,
      messages: opts.messages
    };
    if (opts.system) body.system = opts.system;
    if (tools) body.tools = tools;
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(function(r){
      if (!r.ok){
        return r.json().catch(function(){ return {}; }).then(function(eb){
          var em = apiErrorMessage(r.status, eb);
          if (em === 'MODEL_UNAVAILABLE'){
            var next = null;
            for (var i = 0; i < FALLBACK_CHAIN.length; i++){
              if (attempted.indexOf(FALLBACK_CHAIN[i]) < 0){ next = FALLBACK_CHAIN[i]; break; }
            }
            if (next){
              App.modelNote = 'The chosen model was unavailable to this key, so the studio used ' + next + ' instead.';
              return attempt(next, tools, toolNote);
            }
            throw new Error('None of the writing models are available to this key. Check the key and the model list in Settings.');
          }
          if (tools && (r.status === 400 || r.status === 403) && !opts._toolsDropped){
            /* A request carrying the web search tool was rejected: retry once without tools, flagged. */
            opts._toolsDropped = true;
            App.toolNote = 'Web search was not available to this key, so research ran without live search. Treat unverified items with caution.';
            return attempt(m, null, true);
          }
          throw new Error(em);
        });
      }
      return r.json();
    }).then(function(data){
      if (data.stop_reason === 'max_tokens') App.truncated = true;
      var text = '';
      var blocks = data.content || [];
      for (var i = 0; i < blocks.length; i++) if (blocks[i].type === 'text') text += blocks[i].text;
      return text;
    });
  }
  return attempt(model, opts.tools || null).catch(function(err){
    if (err instanceof TypeError || /Failed to fetch/i.test(err.message)){
      throw new Error('The request never reached the API. Check your network, and if you run an ad blocker allow api.anthropic.com.');
    }
    throw err;
  });
}

var WEB_SEARCH_TOOL = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }];

/* Defensive JSON parsing with exactly one silent retry. */
function parseModelJSON(text){
  if (!text) return null;
  var m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch(e){}
  try { return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1')); } catch(e){}
  return null;
}
function callForJSON(opts, causeLabel){
  return callModel(opts).then(function(text){
    var obj = parseModelJSON(text);
    if (obj) return obj;
    return callModel(opts).then(function(text2){
      var obj2 = parseModelJSON(text2);
      if (obj2) return obj2;
      var cause = App.truncated ? 'the reply was cut off at the token limit' : 'the reply was not readable as structured data';
      throw new Error('The ' + causeLabel + ' step failed twice because ' + cause + '. Try again, or switch model in Settings.');
    });
  });
}

/* ---------- Enrichment services ---------- */
function pdlEnrich(contact){
  var key = Store.get('pdl_key') || '';
  if (!key) return Promise.resolve(null);
  var params = new URLSearchParams();
  if (contact.name) params.set('name', contact.name);
  if (contact.company) params.set('company', contact.company || 'Ecolab');
  if (contact.linkedin) params.set('profile', contact.linkedin);
  params.set('api_key', key);
  return fetch('https://api.peopledatalabs.com/v5/person/enrich?' + params.toString())
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){ return d && d.data ? { title: d.data.job_title || '', company: (d.data.job_company_name || ''), location: (d.data.location_name || '') } : null; })
    .catch(function(){ return null; });
}
function perplexityFindings(query){
  var key = Store.get('pplx_key') || '';
  if (!key) return Promise.resolve(null);
  return fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'sonar-pro', messages: [{ role: 'user', content: query }], max_tokens: 900 })
  }).then(function(r){
    if (!r.ok) { App.pplxNote = 'The Perplexity API refused the browser call, so research continued without it.'; return null; }
    return r.json();
  }).then(function(d){
    if (!d) return null;
    var c = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '';
    var cites = (d.citations || []).slice(0, 8).join('\n');
    return c ? (c + (cites ? '\nCitations:\n' + cites : '')) : null;
  }).catch(function(){ App.pplxNote = 'The Perplexity API refused the browser call, so research continued without it.'; return null; });
}

/* ---------- Research: evidence before prose ---------- */
var RESEARCH_SCHEMA = 'Return strict JSON only, no prose outside the JSON, with keys: status (in_company | left_company | uncertain); current_employer; title_exact (copied verbatim from the profile, never to be quoted in any email); title_plain (the title expanded into natural business English, every abbreviation spelled out); business_unit; location {city, country}; region {value copied exactly as the profile states it, basis, confidence}; remit {summary of what the person actually owns, basis, alternatives_considered, direct_or_indirect (for sourcing roles), confidence}; goals {summary of the goals and pressures this person is most likely chasing right now, based only on evidenced remit and signals, basis, confidence}; summary; signals (three to five recent sourced observations, each {text, source, recency, confidence, wedge_fit: the account opening or theme this signal maps to, named exactly as the account context names it, with one plain clause on why this person would care}); relevance {fit: high|medium|low, reason}; red_flags (array); linkedin_url; sources (array); confidence (verified|reported|inferred|unknown); note.';

var DISAMBIGUATION = [
'Disambiguation rules that prevent known failures:',
'- Sourcing or procurement titles: resolve direct versus indirect. Indirect means logistics, MRO, professional services, IT. An email about chemical raw materials to an indirect sourcing leader is a named failure mode.',
'- Marketing or innovation titles: name the actual offering marketed, from evidence.',
'- Operations titles: plants, quality and supply. Never framed as product, sales or business development.',
'- Planning, PMO, chief of staff, transformation office: support roles serving the corporate team through project management. Say so, and mark fit accordingly.',
'- Regions are copied exactly. Eurasia is Eurasia. Never substitute a neighbouring or similar-sounding geography. Unstated means unknown.',
'Every claim carries a basis and a confidence: verified (seen on the profile or an official source), reported (credible third party), inferred (reasoned, with the reasoning stated), or unknown. Unknown stays unknown. Nothing is guessed.',
'Signal quality rules: prefer developments from the last twelve months and mark anything older; corroborate each signal against a second source where possible and drop what cannot be corroborated rather than keeping it at low confidence; map every signal to the account opening or theme it serves, using the wedge names from the account context, so the writer can see exactly why this person is likely to respond; state the goals this person is most plausibly chasing, from evidence only, never from the title alone.'
].join('\n');

function runResearch(contact){
  var q = 'Current role, employer, business unit, region and remit of ' + contact.name + (contact.title ? ', listed title: ' + contact.title : '') + ', at ' + (contact.company || 'Ecolab') + '. Recent verifiable professional signals only, with sources.';
  return perplexityFindings(q).then(function(pre){
    var sys = 'You are a research analyst building an evidence file, not a story. ' + DISAMBIGUATION + '\n' + RESEARCH_SCHEMA;
    var user = 'Research this person for account-based outreach.\n\nContact: ' + JSON.stringify({ name: contact.name, title: contact.title || '', company: contact.company || 'Ecolab', unit: contact.unit || '', email: contact.email || '', linkedin: contact.linkedin || '' }) +
      '\n\n' + ACCT().modelContext +
      (pre ? '\n\nGrounded pre-findings from a citation-backed search service; verify before relying on them:\n' + pre : '') +
      '\n\nUse web search to verify identity, title, employer and region where possible. Return the strict JSON only.';
    return callForJSON({ system: sys, messages: [{ role: 'user', content: user }], maxTokens: BUDGET.research, tools: WEB_SEARCH_TOOL }, 'research');
  });
}

/* ---------- The confidence audit ---------- */
function runAudit(evidence, draft){
  var sys = [
    'Adopt the persona of a managing director in the chemicals, materials and natural resources practice of a leading strategy consultancy, reviewing an analyst before anything reaches a client: objective, evidence-first, unsentimental. You may spot-check the title, employer and region with web search.',
    'Run six checks: 1 identity; 2 title and remit (unresolved ambiguity fails); 3 region and scope (a substituted region is an automatic fail); 4 signal quality; 5 draft matches evidence and reads human (fail template structure, slogans, copied phrasing, antithesis patterns, any line that recounts the person\'s own market to them, any field claim such as we hear or we are seeing that the evidence file does not support as verified or reported, any offer to map, establish or walk the reader through analysis that does not exist as completed work, any follow-up that changes subject instead of advancing the first note, and any follow-up whose description of the first note is not supported by that note\'s actual text); 6 confidence to send.',
    'Score 0 to 100. 85 and above only when you would sign it without edits (band: Bank on it). 60 to 84 usable after named checks (band: Use with checks). Below 60 must not be sent (band: Do not send yet). Unresolved title ambiguity, an unverified region, or a draft-evidence mismatch caps the score below 60.',
    'Return strict JSON only: { "score": 0-100, "band": "Bank on it" | "Use with checks" | "Do not send yet", "checks": [ {"name","result":"pass"|"fail"|"na","note"} x6 ], "issues": [], "fixes": [] }.'
  ].join('\n');
  var user = 'EVIDENCE FILE:\n' + JSON.stringify(evidence || {}, null, 1) + '\n\nDRAFT:\n' + JSON.stringify(draft || {}, null, 1) + '\n\nAudit now. Strict JSON only.';
  return callForJSON({ system: sys, messages: [{ role: 'user', content: user }], maxTokens: BUDGET.audit, tools: WEB_SEARCH_TOOL }, 'audit')
    .then(function(a){
      /* Client-side cap enforcement mirrors the stated rule. */
      var caps = false;
      (a.checks || []).forEach(function(c, i){
        if (c.result === 'fail' && (i === 1 || i === 2 || i === 4)) caps = true;
      });
      if (caps && a.score >= 60){ a.score = 59; a.band = 'Do not send yet'; }
      if (a.score >= 85) a.band = 'Bank on it';
      else if (a.score >= 60) a.band = 'Use with checks';
      else a.band = 'Do not send yet';
      return a;
    });
}

/* ---------- Mechanical scan ---------- */
function normText(s){
  return String(s || '').replace(/[\u2018\u2019]/g, '\'').replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ').toLowerCase();
}
function sentenceShingles(text){
  var out = [];
  var sentences = String(text || '').split(/[.?!]+/);
  for (var i = 0; i < sentences.length; i++){
    var words = normText(sentences[i]).replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
    for (var j = 0; j + 5 <= words.length; j++){
      out.push(words.slice(j, j + 5).join(' '));
    }
  }
  return out;
}
var TOUCH2_SHINGLES = (function(){
  var all = [];
  TOUCH2_CLOSE_EXAMPLES.forEach(function(x){ all = all.concat(sentenceShingles(x)); });
  return all;
})();
var EXAMPLE_SHINGLES = (function(){
  var skipNouns = ['futurebridge','chem-aqua','dow','mike','amanda','coolant','network'];
  var closeSh = sentenceShingles(CLOSE_SENTENCE);
  var all = sentenceShingles(EXAMPLE_ONE).concat(sentenceShingles(EXAMPLE_TWO));
  return all.filter(function(sh){
    if (closeSh.indexOf(sh) >= 0) return false;
    for (var i = 0; i < skipNouns.length; i++) if (sh.indexOf(skipNouns[i]) >= 0) return false;
    return true;
  });
})();

function scanText(label, text, opts){
  var v = [];
  var raw = String(text || '');
  var low = normText(raw);
  if (/[\u2013\u2014]/.test(raw)) v.push(label + ': contains an em or en dash.');
  if (/[\u2018\u2019\u201C\u201D]/.test(raw)) v.push(label + ': contains curly quotes; use straight apostrophes.');
  BANNED_WORDS.forEach(function(w){
    var re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(low)) v.push(label + ': banned word "' + w + '".');
  });
  BANNED_LINES.concat(BANNED_STOCK).forEach(function(p){
    if (low.indexOf(p.toLowerCase()) >= 0) v.push(label + ': banned phrase "' + p + '".');
  });
  if (opts && opts.followup){
    BANNED_FOLLOWUP.forEach(function(p){
      if (low.indexOf(p) >= 0) v.push(label + ': banned follow-up phrase "' + p + '".');
    });
  }
  OVERPROMISE_PHRASES.forEach(function(p){
    if (low.indexOf(p.toLowerCase()) >= 0) v.push(label + ': offers analysis we have not done ("' + p + '"); reframe it as an informed hypothesis or an open question to the reader.');
  });
  if (opts && opts.followup && opts.isEmailBody){
    var wc = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
    if (wc > 105) v.push(label + ': runs to ' + wc + ' words; the follow-up band is 90 to 100. Cut a sentence, the insight survives the trim.');
  }
  if (/is not (the |a |an )?[^.]{0,45}\.\s*It is/i.test(raw)) v.push(label + ': antithesis pattern (is not X. It is Y). Rewrite as something a person would say.');
  if (/\b(NA|LI)\b/.test(raw) || /\b(Sr|Mgr|Assoc)\.?\b/.test(raw)) v.push(label + ': crude abbreviation reaching prose (NA, Sr, Mgr, Assoc or LI).');
  var numWords = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|percent)\b/i.exec(raw);
  if (numWords) v.push(label + ': the number "' + numWords[1] + '" is spelled out; numbers are written in digits (and % rather than percent).');
  if (opts && opts.titleExact && opts.titleExact.length > 4 && raw.indexOf(opts.titleExact) >= 0) v.push(label + ': the verbatim profile title is pasted into the prose.');
  if (opts && opts.needsClose && raw.indexOf(CLOSE_SENTENCE) < 0) v.push(label + ': the fixed close sentence is missing.');
  if (opts && opts.followup && raw.indexOf(CLOSE_SENTENCE) >= 0) v.push(label + ': the fixed 30-minute close may only be used in touch 1; later touches use a lower-friction ask.');
  if (opts && opts.followup && /\b\d{1,3}\s?(minute|minutes|mins)\b/i.test(raw)) v.push(label + ': a follow-up ask never names a duration; offer a brief conversation instead.');
  if (opts && opts.followup){
    var t2sh = sentenceShingles(raw);
    for (var q = 0; q < t2sh.length; q++){
      if (TOUCH2_SHINGLES.indexOf(t2sh[q]) >= 0){ v.push(label + ': copies the approved close register ("' + t2sh[q] + '"); the register shows the tone, the wording must be fresh.'); break; }
    }
  }
  if (/\bis what (quietly|really|actually|ultimately|truly|usually|often)\b/i.test(raw)) v.push(label + ': is-what verdict pattern; write the consequence as a full conditional sentence with could, would or might.');
  if (/(^|\. |\n)(Getting|Choosing|Missing|Winning|Losing|Picking) [^.\n]{0,50}(is|means) /.test(raw)) v.push(label + ': gerund-verdict opener reads as a slogan; write it as a plain conditional sentence.');
  var sh = sentenceShingles(raw);
  var closeSh = sentenceShingles(CLOSE_SENTENCE);
  for (var i = 0; i < sh.length; i++){
    if (closeSh.indexOf(sh[i]) >= 0) continue;
    if (EXAMPLE_SHINGLES.indexOf(sh[i]) >= 0){
      v.push(label + ': copies example language ("' + sh[i] + '").');
      break;
    }
  }
  return v;
}
function scanDraft(draft, opts){
  opts = opts || {};
  var v = [];
  var needsClose = !opts.followup;
  v = v.concat(scanText('Subject', draft.subject, {}));
  v = v.concat(scanText('Email', draft.email, { titleExact: opts.titleExact, needsClose: needsClose, followup: opts.followup, isEmailBody: true }));
  if (draft.inmail) v = v.concat(scanText('InMail', draft.inmail, { titleExact: opts.titleExact, needsClose: needsClose, followup: opts.followup }));
  return v;
}
/* Campaign-level fingerprint: no draft may open the way an earlier draft
   in this account opened. Compared on the first five words after the
   greeting, normalised. */
function campaignOpeners(excludeId){
  var out = {};
  Central.all().forEach(function(r){
    if (r.deleted || r.account !== App.account || r.id === excludeId) return;
    var key = openerKey(r.body);
    if (key) out[key] = r.contact;
  });
  return out;
}
function campaignCloses(){
  var out = {};
  Central.all().forEach(function(r){
    if (r.deleted || r.account !== App.account || !r.touch || r.touch < 2) return;
    var key = closeKey(r.body);
    if (key) out[key] = r.contact;
  });
  return out;
}
function closeKey(body){
  var sentences = String(body || '').replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/).filter(function(x){ return x.trim(); });
  if (!sentences.length) return '';
  return normText(sentences[sentences.length - 1]).replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function openerKey(body){
  var lines = String(body || '').split('\n').filter(function(x){ return x.trim(); });
  if (!lines.length) return '';
  var start = /^hi /i.test(lines[0]) ? 1 : 0;
  var words = normText(lines.slice(start).join(' ')).replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  return words.slice(0, 5).join(' ');
}

/* ---------- The repair pass ---------- */
function runRepair(draft, violations){
  var sys = 'You repair outreach drafts. Change only what the listed violations require: replace stock phrases, copied language, repeated openings and antithesis constructions with fresh plain words a person would say. Where a violation names an offer of analysis we have not done, reframe that sentence as an informed hypothesis or an open question addressed to the reader; where one names an over-long follow-up, cut the least essential sentence. Alter nothing else. Leave the closing ask untouched unless a violation names it; where a violation says the fixed 30-minute close may not be used, replace it with a short, lower-friction ask that fits the note. Return strict JSON only: {"subject","email","inmail"}.';
  var user = 'DRAFT:\n' + JSON.stringify(draft) + '\n\nVIOLATIONS:\n- ' + violations.join('\n- ') + '\n\nHouse rules for reference:\n' + WRITER_METHOD.slice(0, 2600) + '\n\nReturn the corrected strict JSON only.';
  return callForJSON({ system: sys, messages: [{ role: 'user', content: user }], maxTokens: BUDGET.repair }, 'repair');
}

/* ---------- The writer ---------- */
function composePrompt(kind, contact, evidence, context, forced, priorTouch){
  var lines = [];
  lines.push('You are writing for the FutureBridge Chemicals and Natural Resources practice. Follow every rule below exactly.');
  lines.push(WRITER_METHOD);
  lines.push('\n' + ACCT().modelContext);
  lines.push('\nRECIPIENT CONTACT ROW: ' + JSON.stringify({ name: contact.name, title: contact.title || '', company: contact.company || 'Ecolab', unit: contact.unit || '' }));
  if (evidence) lines.push('\nEVIDENCE FILE (use only claims marked verified or reported):\n' + JSON.stringify(evidence, null, 1));
  else lines.push('\nNo research evidence file exists for this person. Write only from the account context and the role, and stay strictly generic about the person: no invented personal signals.');
  if (context) lines.push('\nCONTEXT FROM THE PRACTICE (use only if consistent with the evidence): ' + context);
  if (kind === 'followup' && priorTouch){
    lines.push('\nTHIS IS TOUCH 2, the follow-up. The first note said:\nSubject: ' + priorTouch.subject + '\n' + priorTouch.body);
    lines.push('Apply the follow-up standard: 90 to 100 words, and when a sentence can go, cut it. Advance the SAME conversation by sharpening the first note\'s tension into a more precise split or distinction; never introduce an unrelated topic. Any sentence that describes what the first note said must be checkable against its text above; never claim it raised a point it did not raise, and never stage a pivot the first note already made. Do not reuse the first note\'s opening construction and do not open with any form of Since I wrote. Apply the promise rule: no offers to map, establish, build or walk them through anything; put what we would want to know as a hypothesis or an open question. Prefer to end on the most relevant decision question for this person, with nothing after it. Only where the note does not end on a question, close with one short conditional sentence offering a brief conversation, no duration, no fixed 30-minute sentence, in wording no other follow-up in this campaign has used. At most one plain clause may reference the first note. Subject must be exactly "Re: ' + priorTouch.subject + '".');
  }
  if (kind === 'finalinsight' && priorTouch){
    lines.push('\nTHIS IS TOUCH 3, the final note of the sequence (channel: ' + priorTouch.channel + '). Change mode: 60 to 90 words of concrete usefulness. Name the one question a first conversation would usefully settle for them, or the one thing we would want to test together, or ask one final low-pressure question. Apply the promise rule: never offer analysis, a mapping or an output as if it already exists or as free work; a conversation is the only thing on the table. Never a third market observation, and never the fixed 30-minute close: end so the reader can answer with yes, no or not me in one line. It reads as a natural last word, never a chase, and is the last communication. Earlier subject: ' + priorTouch.subject + '. If this touch is an email, subject is "Re: ' + priorTouch.subject + '"; if an InMail, use a fresh three to seven word subject.');
  }
  if (forced) lines.push('\nYou must write the email. A leave verdict is forbidden on this run.');
  lines.push('\nFirst decide: is there one thing this email brings that the person does not already have? If not' + (forced ? ' (not permitted on this run)' : '') + ', return {"decision":"leave","reason":"..."}.');
  var closeNote = (kind === 'first') ? 'ending with the exact close sentence' : 'ending with the lower-friction ask the follow-up standard requires, never the fixed 30-minute sentence';
  lines.push('Otherwise return strict JSON only: {"decision":"write","subject":"...","email":"email text with greeting, blank lines between paragraphs, ' + closeNote + '. Do not include a sign-off block; the studio appends the configured sign-off and sender name automatically.","inmail":"InMail text with greeting, ' + closeNote + ', no sign-off block"}');
  return lines.join('\n');
}

/* The generation pipeline: compose, one silent retry, mechanical scan,
   repair if needed, record centrally, then audit. */
function generateDraft(kind, contact, evidence, context, forced, priorTouch, source){
  var prompt = composePrompt(kind, contact, evidence, context, forced, priorTouch);
  var maxT = (kind === 'first') ? BUDGET.email : BUDGET.followup;
  return callForJSON({ messages: [{ role: 'user', content: prompt }], maxTokens: maxT }, 'writing')
    .then(function(out){
      if (out.decision === 'leave' && !forced){
        return { leave: true, reason: out.reason || 'The writer found nothing new to bring this person.' };
      }
      var draft = { subject: out.subject || '', email: out.email || '', inmail: out.inmail || '' };
      var opts = { titleExact: evidence && evidence.title_exact ? evidence.title_exact : '', followup: kind !== 'first' };
      var violations = scanDraft(draft, opts);
      var openers = campaignOpeners();
      var ok = openerKey(draft.email);
      if (ok && openers[ok]) violations.push('Email: opens the same way as the earlier draft for ' + openers[ok] + '. Every draft in a campaign needs its own opening.');
      if (kind !== 'first'){
        var closes = campaignCloses();
        var ck = closeKey(draft.email);
        if (ck && closes[ck]) violations.push('Email: closes with the same wording as the earlier follow-up for ' + closes[ck] + '. Every follow-up needs its own close.');
      }
      var chain = Promise.resolve(draft);
      if (violations.length){
        chain = runRepair(draft, violations).then(function(fixed){
          var d2 = { subject: fixed.subject || draft.subject, email: fixed.email || draft.email, inmail: fixed.inmail || draft.inmail };
          d2._violations = scanDraft(d2, opts);
          d2._repaired = true;
          return d2;
        });
      }
      return chain.then(function(finalDraft){
        var rec = Central.record({
          contact: contact.name, title: contact.title || '', company: contact.company || 'Ecolab',
          subject: finalDraft.subject, body: finalDraft.email, inmail: finalDraft.inmail || '',
          source: source || kind,
          profile: evidence ? {
            region: evidence.region && evidence.region.value || '',
            remit: evidence.remit && evidence.remit.summary || '',
            signals: (evidence.signals || []).map(function(s){ return s.text; }).join(' | ')
          } : {}
        });
        Log.add('generate', contact.name + ' (' + (source || kind) + ')');
        return { draft: finalDraft, record: rec, repaired: !!finalDraft._repaired, openViolations: finalDraft._violations || [] };
      });
    });
}

/* ---------- The assistant (rewrites within house rules) ---------- */
function assistantRewrite(draft, instruction){
  var sys = 'You are the drafting assistant inside the studio. Rewrite the draft according to the instruction, but never break the house rules below. Keep the exact close sentence and the sign-off. Return strict JSON only: {"subject","email","inmail","changed":"one line saying what changed"}.\n\n' + WRITER_METHOD.slice(0, 3200);
  return callForJSON({ system: sys, messages: [{ role: 'user', content: 'DRAFT:\n' + JSON.stringify(draft) + '\n\nINSTRUCTION: ' + instruction }], maxTokens: BUDGET.assistant }, 'assistant');
}

/* ---------- Test connection ---------- */
function testConnection(){
  var lines = [];
  var key = Store.get('anthropic_key') || '';
  if (!key) return Promise.resolve(['No Anthropic API key is saved.', 'Verdict: paste a key in Settings before anything else will run.']);
  lines.push('API key: present.');
  var model = chosenModel();
  return callModel({ model: model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 10 })
    .then(function(){ lines.push('Chosen model (' + model + '): answers.'); return true; })
    .catch(function(e){
      lines.push('Chosen model (' + model + '): failed. ' + e.message);
      return callModel({ model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'Reply with the single word OK.' }], maxTokens: 10 })
        .then(function(){ lines.push('Fallback model (claude-haiku-4-5): answers.'); return true; })
        .catch(function(e2){ lines.push('Fallback model: also failed. ' + e2.message); return false; });
    })
    .then(function(okSoFar){
      if (!okSoFar) return false;
      return callModel({ model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'Confirm tools are attached by replying OK.' }], maxTokens: 30, tools: WEB_SEARCH_TOOL })
        .then(function(){ lines.push('Web search: enabled for this key.'); return true; })
        .catch(function(){ lines.push('Web search: not available; research will run without live search.'); return true; });
    })
    .then(function(ok){
      lines.push('Perplexity key: ' + (Store.get('pplx_key') ? 'present.' : 'not set (optional).'));
      lines.push('People Data Labs key: ' + (Store.get('pdl_key') ? 'present.' : 'not set (optional).'));
      lines.push('Shared store: ' + (Cloud.on() ? 'configured.' : 'not configured; running local-only.'));
      lines.push(ok ? 'Verdict: the studio is ready to research and write.' : 'Verdict: fix the key or model issue above before generating.');
      return lines;
    });
}
