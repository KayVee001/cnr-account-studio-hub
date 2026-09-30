/* ============================================================
   INTERFACE. Sign-in gate, navigation, pages, contacts,
   sequences, oversight and settings.
   ============================================================ */

/* ---------- Sign-in ---------- */
App.gateErr = function(msg){
  var err = document.getElementById('gate-err');
  err.textContent = msg; err.style.display = 'block';
};
App.signIn = function(){
  var email = (document.getElementById('gate-email').value || '').trim().toLowerCase();
  var pw = document.getElementById('gate-pw').value || '';
  document.getElementById('gate-err').style.display = 'none';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
    App.gateErr('Enter a full work email address, for example name@futurebridge.com.');
    return;
  }
  App.pendingUser = email;
  var rec = hubUsers()[email];
  /* If this device does not know the email or the password does not match,
     pull the latest access list from the shared store once, then re-check. */
  if (Cloud.on() && !App._gateSynced && (!rec || !rec.hash || (SUPER_ADMINS.indexOf(email) < 0 && !checkPassword(email, pw)))){
    App._gateSynced = true;
    var note = document.getElementById('gate-note');
    if (note){ note.textContent = 'Checking access with the shared store.'; note.style.display = 'block'; }
    Cloud.refreshAccess().then(function(){
      if (note) note.style.display = 'none';
      App.signIn();
    });
    return;
  }
  if (SUPER_ADMINS.indexOf(email) >= 0){
    if (!rec || !rec.hash){
      /* First run for an owner email: security question, then create the password. */
      App.pendingFlow = 'super-setup';
      App.showGateStep('gate-step2');
      document.getElementById('gate-q').textContent = SEC_QUESTION;
      return;
    }
    if (!checkPassword(email, pw)){ App.gateErr('The email or password is not right.'); return; }
    if (answeredMap()[email] !== true){
      App.pendingFlow = 'super-signin';
      App.showGateStep('gate-step2');
      document.getElementById('gate-q').textContent = SEC_QUESTION;
      return;
    }
    App.completeSignIn(email);
    return;
  }
  if (!rec || !rec.hash){
    App.gateErr('This email has not been given access yet. Ask the administrator to add you.');
    return;
  }
  if (!checkPassword(email, pw)){ App.gateErr('The email or password is not right.'); return; }
  App.completeSignIn(email);
};
App.showGateStep = function(id){
  ['gate-step1','gate-step2','gate-step3'].forEach(function(x){
    document.getElementById(x).style.display = (x === id) ? 'block' : 'none';
  });
};
App.answerQuestion = function(){
  var ans = (document.getElementById('gate-answer').value || '').toLowerCase().replace(/\s+/g, '');
  var email = App.pendingUser;
  if (sha256(ans) === SEC_HASH){
    var m = answeredMap(); m[email] = true; Store.setJSON('sa_answered', m);
  }
  /* A wrong answer continues as a standard user. No message names the outcome. */
  if (App.pendingFlow === 'super-setup'){ App.showGateStep('gate-step3'); return; }
  App.completeSignIn(email);
};
App.setInitialPassword = function(){
  var pw = document.getElementById('gate-newpw').value || '';
  if (pw.length < 6){ App.gateErr('Choose a password of at least six characters.'); return; }
  setUserPassword(App.pendingUser, pw);
  Log.add('edit', 'password set at first sign-in');
  App.completeSignIn(App.pendingUser);
};
App.completeSignIn = function(email){
  App.user = email;
  Store.set('identity', email);
  Log.add('sign in', '');
  document.getElementById('gate').style.display = 'none';
  document.getElementById('app').classList.add('on');
  render();
  /* Refresh grants and tiles from the shared store, then re-render with current levels. */
  Cloud.refreshAccess().then(function(changed){ if (changed) render(); });
};
App.signOut = function(){
  Log.add('sign out', '');
  Store.set('identity', '');
  location.reload();
};

/* ---------- Data helpers ---------- */
/* The contact list is account level and shared. Every write stamps who and
   when, and pushes the changed contact to the shared store, so the same list
   with the same edits appears on every device that opens the account. */
function contacts(){ return Store.getJSON('contacts', []).filter(function(c){ return !c.deleted; }); }
function saveContacts(list, changedCids){
  /* changedCids: the contacts whose data changed and must be pushed. When
     omitted, nothing is pushed, which is right for screen-only changes such
     as selecting or expanding. */
  Store.setJSON('contacts', list);
  if (changedCids && changedCids.length && App.account){
    var now = nowIso();
    list.forEach(function(c){
      if (changedCids.indexOf(c.cid) >= 0){ c.updatedAt = now; c.updatedBy = App.user; Cloud.pushContact(App.account, c); }
    });
    Store.setJSON('contacts', list);
  }
}
function contactById(cid){
  var list = contacts();
  for (var i = 0; i < list.length; i++) if (list[i].cid === cid) return list[i];
  return null;
}
function updateContact(cid, patch){
  var list = Store.getJSON('contacts', []);
  var real = Object.keys(patch).some(function(k){ return TRANSIENT_FIELDS.indexOf(k) < 0; });
  for (var i = 0; i < list.length; i++){
    if (list[i].cid === cid){
      for (var k in patch) list[i][k] = patch[k];
      if (real && 'draft' in patch){ list[i].draftEditedBy = App.user; list[i].draftEditedAt = nowIso(); }
      saveContacts(list, real ? [cid] : null);
      return list[i];
    }
  }
  return null;
}
function removeContacts(cids){
  /* A removal is a tombstone, so it reaches every other device too. */
  var list = Store.getJSON('contacts', []);
  var now = nowIso();
  list.forEach(function(c){ if (cids.indexOf(c.cid) >= 0){ c.deleted = true; c.updatedAt = now; c.updatedBy = App.user; if (App.account) Cloud.pushContact(App.account, c); } });
  Store.setJSON('contacts', list.filter(function(c){ return !c.deleted; }));
}
function profState(){ return Store.getJSON('rec_profiles', {}); }
function saveProfState(s, changedPids){
  Store.setJSON('rec_profiles', s);
  if (changedPids && changedPids.length && App.account){
    var now = nowIso();
    changedPids.forEach(function(pid){
      if (!s[pid]) return;
      s[pid].pid = pid; s[pid].updatedAt = now; s[pid].updatedBy = App.user;
      Cloud.pushProfile(App.account, pid, s[pid]);
    });
    Store.setJSON('rec_profiles', s);
  }
}
function profEdits(){ return Store.getJSON('email_edits', {}); }
function saveProfEdits(edits){
  edits.updatedAt = nowIso(); edits.updatedBy = App.user;
  Store.setJSON('email_edits', edits);
  if (App.account) Cloud.pushEdits(App.account, edits);
}
/* A short line saying who last changed a draft and when, for any record
   or contact that carries the stamps. */
function provenanceHtml(o){
  if (!o) return '';
  var by = o.editedBy || o.draftEditedBy, at = o.editedAt || o.draftEditedAt;
  if (!by && !at) return '';
  return '<span class="prov">Edited by ' + esc(by || 'unknown') + (at ? ', ' + fmtDateTime(at) : '') + '</span>';
}
function sharedHeaderHtml(){
  var st = Cloud.status || {};
  var word = App.syncing ? 'Syncing with the shared store.' :
    (st.state === 'ok' ? 'Shared list. Last synced ' + (App.lastSync ? fmtDateTime(App.lastSync) : 'this session') + '.' :
     st.state === 'error' ? 'Shared store unreachable; changes are held on this device until it returns.' :
     'Shared store not configured; this list lives on this device only.');
  return '<div class="shared-line"><span class="dot ' + (App.syncing ? 'amber' : st.state === 'ok' ? 'green' : st.state === 'error' ? 'red' : 'grey') + '"></span>' +
    '<span class="small muted">' + esc(word) + (App.syncNote && st.state === 'ok' ? ' ' + esc(App.syncNote) : '') + '</span>' +
    '<button class="mini" onclick="App.syncAccount()"' + (App.syncing ? ' disabled' : '') + '>Refresh</button></div>';
}
/* Approved is a state of the shared draft record, so the Approved page
   shows what anyone approved, from any device. */
function approvedIds(){ return approvedItems().map(function(r){ return r.id; }); }
function saveApprovedIds(a){ /* Kept for older call sites; approval lives on the record now. */ }
function approvedItems(){
  return Central.all().filter(function(r){ return !r.deleted && r.account === App.account && r.status === 'approved'; })
    .sort(function(a, b){ return String(b.approvedAt || b.ts) < String(a.approvedAt || a.ts) ? -1 : 1; });
}

/* ---------- Sequences engine ---------- */
function seqPlanFor(hasEmail, hasLinkedIn){
  if (hasEmail && hasLinkedIn) return [
    { channel: 'Email', label: 'Email', guide: 'The opening note.' },
    { channel: 'Email', label: 'Follow-up email', guide: 'Adds one fresh insight; never repeats.' },
    { channel: 'InMail', label: 'InMail, fresh insight, final', guide: 'Channel switch earns a second look. The last word.' }
  ];
  if (hasEmail) return [
    { channel: 'Email', label: 'Email', guide: 'The opening note.' },
    { channel: 'Email', label: 'Follow-up email', guide: 'Adds one fresh insight; never repeats.' },
    { channel: 'Email', label: 'Final insight email', guide: 'One genuinely new insight. The last word.' }
  ];
  return [
    { channel: 'InMail', label: 'InMail', guide: 'The opening note.' },
    { channel: 'InMail', label: 'Follow-up InMail, final', guide: 'Two touches on LinkedIn is the ceiling.' }
  ];
}
function seqEntities(){
  /* One row per contact or recommended profile with a first message. */
  var out = [];
  contacts().forEach(function(c){
    if (c.draft && c.draft.subject) out.push(seqWrap('c:' + c.cid, c.name, c.title || '', c, !!c.email, !!c.linkedin));
  });
  var ps = profState();
  ACCT().profiles.forEach(function(p){
    var st = ps[p.id] || {};
    var name = (st.person && st.person.name) || p.role;
    out.push(seqWrap('p:' + p.id, name, p.role, st, true, true));
  });
  return out;
}
function seqWrap(key, name, title, holder, hasEmail, hasLinkedIn){
  var seq = holder.seq || { touches: [], stopped: false };
  var plan = seqPlanFor(hasEmail, hasLinkedIn);
  return { key: key, name: name, title: title, seq: seq, plan: plan, holder: holder };
}
function seqTouchState(ent, idx){
  var t = ent.seq.touches[idx] || {};
  return t;
}
function seqNext(ent){
  if (ent.seq.stopped) return { status: 'Stopped, replied', chip: 'grey' };
  var sentCount = 0, lastSent = null;
  for (var i = 0; i < ent.plan.length; i++){
    var t = seqTouchState(ent, i);
    if (t.sentDate){ sentCount = i + 1; lastSent = t.sentDate; }
  }
  if (sentCount >= ent.plan.length) return { status: 'Completed', chip: 'green', sent: sentCount };
  if (sentCount === 0) return { status: 'Touch 1 ready', chip: 'blue', nextIdx: 0, sent: 0 };
  var due = new Date(lastSent); due.setDate(due.getDate() + 7);
  var today = new Date(); today.setHours(0,0,0,0);
  var dueDay = new Date(due); dueDay.setHours(0,0,0,0);
  var diff = Math.round((dueDay - today) / 86400000);
  var st;
  if (diff > 0) st = { status: 'Next due in ' + diff + ' day' + (diff === 1 ? '' : 's'), chip: 'grey' };
  else if (diff === 0) st = { status: 'Due now', chip: 'amber' };
  else st = { status: 'Overdue by ' + (-diff) + ' day' + (diff === -1 ? '' : 's'), chip: 'red' };
  st.nextIdx = sentCount; st.due = due; st.sent = sentCount;
  return st;
}
function seqDueCount(){
  var n = 0;
  seqEntities().forEach(function(ent){
    var s = seqNext(ent);
    if (s.status === 'Due now' || s.status.indexOf('Overdue') === 0) n++;
  });
  return n;
}
function seqSaveEnt(ent){
  if (ent.key.indexOf('c:') === 0){ updateContact(ent.key.slice(2), { seq: ent.seq }); }
  else {
    var ps = profState();
    var pid = ent.key.slice(2);
    ps[pid] = ps[pid] || {};
    ps[pid].seq = ent.seq;
    saveProfState(ps, [pid]);
  }
}
function seqIcs(){
  var lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//FutureBridge//Ecolab Account Studio//EN'];
  seqEntities().forEach(function(ent){
    if (ent.seq.stopped) return;
    var s = seqNext(ent);
    if (s.nextIdx == null) return;
    var due = s.due || new Date();
    for (var i = s.nextIdx; i < ent.plan.length; i++){
      var d = new Date(due); d.setDate(d.getDate() + (i - s.nextIdx) * 7);
      var ymd = d.toISOString().slice(0,10).replace(/-/g, '');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + ent.key + '-t' + (i+1) + '@ecolab-account-studio');
      lines.push('DTSTART;VALUE=DATE:' + ymd);
      lines.push('SUMMARY:' + ent.name.replace(/[,;]/g, ' ') + ' - touch ' + (i+1) + ' (' + ent.plan[i].channel + ')');
      lines.push('DESCRIPTION:Ecolab Account Studio sequence touch. ' + ent.plan[i].label.replace(/[,;]/g, ' '));
      lines.push('BEGIN:VALARM');
      lines.push('TRIGGER:-PT15M');
      lines.push('ACTION:DISPLAY');
      lines.push('DESCRIPTION:Outreach touch due');
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    }
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/* ---------- Downloads and clipboard ---------- */
function download(filename, text, mime){
  var blob = new Blob([text], { type: mime || 'text/plain' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
}
function copyText(text, btn){
  function done(){ if (btn){ var o = btn.textContent; btn.textContent = 'Copied'; setTimeout(function(){ btn.textContent = o; }, 1200); } }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
  else done();
}
function csvCell(s){
  s = String(s == null ? '' : s);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function parseCSV(text){
  var rows = [], row = [], cur = '', inQ = false;
  for (var i = 0; i < text.length; i++){
    var ch = text[i];
    if (inQ){
      if (ch === '"'){ if (text[i+1] === '"'){ cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ','){ row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r'){
        if (ch === '\r' && text[i+1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      }
      else cur += ch;
    }
  }
  row.push(cur);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/* ---------- Navigation ---------- */
var NAV = [
  { id: 'summary',   label: 'Account summary' },
  { id: 'method',    label: 'How we write the emails' },
  { id: 'contacts',  label: 'Contacts and emails' },
  { id: 'approved',  label: 'Approved emails' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'sources',   label: 'Sources and checks' },
  { id: 'sending',   label: 'Sending order' },
  { id: 'oversight', label: 'Oversight', admin: true },
  { id: 'settings',  label: 'Settings' }
];

App.go = function(page){
  App.page = page;
  if (App.account && page !== 'summary') Log.add('view', App.account + ' / ' + page);
  render();
};
App.goTab = function(tab){ App.tab = tab; Log.add('view', App.account + ' / contacts / ' + tab); render(); };
App.goHome = function(){ App.account = null; App.page = 'home'; render(); };
App.openAccount = function(id){
  App.account = id; App.page = 'summary'; App.tab = 'profiles';
  Store.adoptLegacy(id);
  Log.add('view', 'account opened: ' + id);
  render();
  App.syncAccount();
};
/* Pull the shared copy of this account, merge it and redraw if anything
   moved. Runs on every account open and on demand. */
App.syncAccount = function(){
  var id = App.account; if (!id) return Promise.resolve();
  App.syncing = true;
  return Cloud.pullAccount(id).then(function(res){
    App.syncing = false;
    App.syncNote = res.note;
    if (App.account === id && (res.changed || App.page === 'contacts')) render();
  });
};

function render(){
  var nav = document.getElementById('rail-nav');
  var brand = document.querySelector('.rail-brand .t1');
  var brand2 = document.querySelector('.rail-brand .t2');
  var html = '';
  if (!App.account){
    brand.textContent = 'Account Studio Hub';
    brand2.textContent = 'FutureBridge CNR practice';
    html += '<div class="rail-item' + (App.page === 'home' ? ' on' : '') + '" onclick="App.goHome()"><span>All accounts</span></div>';
    if (isSuper()){
      html += '<div class="rail-item' + (['hubsettings','access','activity','newstudio','newov'].indexOf(App.page) >= 0 ? ' on' : '') + '" onclick="App.go(\'hubsettings\')"><span>Hub settings</span></div>';
    }
  } else {
    var a = accountById(App.account);
    brand.textContent = a ? a.name : 'Account Studio Hub';
    brand2.textContent = (a && a.practice) || 'FutureBridge CNR practice';
    var full = canFull(App.account);
    html += '<div class="rail-item" onclick="App.goHome()"><span>All accounts</span></div>';
    var due = full ? seqDueCount() : 0;
    NAV.forEach(function(n){
      if (n.admin && !isAdmin()) return;
      /* Without the full studio, only the pages that will actually render. */
      if (!full && ['summary','contacts','settings'].indexOf(n.id) < 0) return;
      var badge = '';
      if (full){
        if (n.id === 'approved'){ var c = approvedItems().length; if (c) badge = '<span class="rail-badge calm">' + c + '</span>'; }
        if (n.id === 'contacts' && due) badge = '<span class="rail-badge">' + due + '</span>';
      }
      var label = (!full && n.id === 'contacts' && userRole() === 'read') ? 'Contacts and profiles' : n.label;
      html += '<div class="rail-item' + (App.page === n.id ? ' on' : '') + '" onclick="App.go(\'' + n.id + '\')"><span>' + label + '</span>' + badge + '</div>';
    });
  }
  nav.innerHTML = html;
  document.getElementById('rail-user').innerHTML = 'Signed in as<br>' + esc(App.user) +
    '<br><span class="small muted">Build ' + esc(BUILD.version) + '</span>' +
    '<br><span class="rail-signout" onclick="App.signOut()">Sign out</span>';
  var page = document.getElementById('page');
  /* Access is enforced here, at render time, for every page of every account.
     Read users get the summary, the read-only contacts and profiles view, and
     their own settings; everything else renders nothing. */
  if (App.account && !canFull(App.account)){
    var allowed = ['summary','settings'];
    if (userRole() === 'read') allowed.push('contacts');
    if (allowed.indexOf(App.page) < 0){
      page.innerHTML = '<p class="muted">Nothing to show.</p>';
      return;
    }
  }
  /* Hub settings pages are super admin territory, tested at render time. */
  if (!App.account && ['hubsettings','access','activity','newstudio','newov'].indexOf(App.page) >= 0 && !isSuper()){
    page.innerHTML = '<p class="muted">Nothing to show.</p>';
    return;
  }
  var fn = PAGES[App.page] || (App.account ? PAGES.summary : PAGES.home);
  page.innerHTML = fn();
  if (App.afterRender){ var f = App.afterRender; App.afterRender = null; f(); }
}

var PAGES = {};

/* ---------- Home ---------- */
PAGES.home = function(){
  var accounts = allAccounts();
  var nUsers = Object.keys(hubUsers()).length;
  var nDrafts = Central.all().filter(function(r){ return !r.deleted; }).length;
  var h = '<div class="hero"><div class="hk">FutureBridge, Chemicals and Natural Resources</div>' +
    '<h1>The accounts this practice is pursuing</h1>' +
    '<p>Open an account to work its studio. Your access level decides what opens: administrators get the complete workspace, read access opens the account overview plus the contacts and their researched profiles.</p>' +
    '<div class="hrule"></div>' +
    '<div class="hstats">' +
    '<div class="hstat"><div class="n">' + accounts.length + '</div><div class="l">Accounts</div></div>' +
    '<div class="hstat"><div class="n">' + nUsers + '</div><div class="l">People with access</div></div>' +
    '<div class="hstat"><div class="n">' + nDrafts + '</div><div class="l">Drafts in the central record</div></div>' +
    '</div></div>';
  h += '<div class="tiles">';
  accounts.forEach(function(a){
    var full = canFull(a.id);
    var chip = (a.type === 'overview') ? '<span class="pill grey">Overview only</span>'
      : (full ? '<span class="pill green">Full studio</span>' : (userRole() === 'read' ? '<span class="pill grey">Read access</span>' : '<span class="pill grey">Overview only</span>'));
    var facts = '';
    if (a.type === 'studio'){
      var L = a.layer;
      facts += '<div class="fact"><span class="fk">Brief</span><span>' + esc(L.briefDate || '') + '</span></div>';
      facts += '<div class="fact"><span class="fk">Wedges</span><span>' + (L.wedges ? L.wedges.length : 0) + ' ranked openings</span></div>';
      facts += '<div class="fact"><span class="fk">Role profiles</span><span>' + (L.profiles ? L.profiles.length : 0) + ' with baked drafts</span></div>';
      facts += '<div class="fact"><span class="fk">Source document</span><span>' + (L.doc ? 'Word, downloadable' : 'Not attached') + '</span></div>';
    } else {
      facts += '<div class="fact"><span class="fk">Type</span><span>Overview document</span></div>';
      facts += '<div class="fact"><span class="fk">Uploaded</span><span>' + fmtDate(a.created) + '</span></div>';
    }
    h += '<div class="tile" onclick="App.openAccount(\'' + a.id + '\')">' +
      '<div class="tile-top"><div class="tile-name">' + esc(a.name) + '</div>' +
      '<div class="tile-practice">' + esc(a.practice || '') + '</div></div>' +
      '<div class="tile-mid">' + facts + '</div>' +
      '<div class="tile-foot">' + chip +
      '<span class="tile-open">Open</span>' +
      (a.dynamic && isSuper() ? '<button class="mini danger" onclick="event.stopPropagation();App.deleteOverview(\'' + a.id + '\')">Delete</button>' : '') +
      '</div></div>';
  });
  if (isSuper()){
    h += '<div class="tile add" onclick="App.go(\'hubsettings\')"><div class="add-in"><div class="add-plus">+</div><div><b>Hub settings</b><br><span class="small muted">Add account studios and overviews, manage access, review activity.</span></div></div></div>';
  }
  h += '</div>';
  if (SUPER_ADMINS.indexOf(App.user) >= 0 && !isSuper()){
    h += '<div class="banner warn" style="margin-top:16px;"><b>Administrator access is locked on this browser.</b> Your email is an owner email, but the security question has not been answered correctly here, so the Access, Activity and account-creation controls stay hidden. Answer it below to unlock them.' +
      '<div class="row2" style="margin-top:10px;"><span class="small">' + esc(SEC_QUESTION) + '</span>' +
      '<input type="password" id="unlock-ans" placeholder="Answer" style="max-width:200px;">' +
      '<button class="mini primary" onclick="App.unlockAdmin()">Unlock</button></div>' +
      (App.unlockNote ? '<p class="small" style="margin-top:6px;">' + esc(App.unlockNote) + '</p>' : '') + '</div>';
  }
  if (!Store.usable()) h += '<div class="banner err" style="margin-top:16px;">This browser is blocking local storage, which usually means a private or incognito window. Nothing entered here will survive; use a normal browser window.</div>';
  var hs = Cloud.status || { state: 'off' };
  if (hs.state === 'error' && isSuper()) h += '<div class="banner warn" style="margin-top:16px;">' + esc('Shared store problem. ' + (hs.detail || '')) + '</div>';
  else if (hs.state === 'off' && isSuper()) h += '<div class="banner info" style="margin-top:16px;">The shared store is not connected, so access grants and new accounts apply only on this device. Connect it in any workspace under Settings, or bake the project ID and key into the file so every device connects automatically.</div>';
  return h;
};

/* ---------- Hub settings, super admin only ---------- */
PAGES.hubsettings = function(){
  if (!isSuper()) return '<p class="muted">Nothing to show.</p>';
  var st = Cloud.status || { state: 'off', detail: '' };
  var stCls = st.state === 'ok' ? 'ok' : st.state === 'error' ? 'err' : 'warn';
  var stLead = st.state === 'ok' ? 'Shared store: connected. Access and new accounts reach every device.' : st.state === 'error' ? 'Shared store problem. ' + (st.detail || '') : 'Shared store: not configured. Anything created here applies only on this device.';
  var h = '<h1>Hub settings</h1><p class="muted">Everything that shapes the hub itself lives here: new accounts, who gets in and at what level, and what everyone has been doing. Only the super admin can see this page; it is enforced every time the page renders.</p>';
  h += '<div class="banner ' + stCls + '">' + esc(stLead) + '</div>';
  h += '<div class="tiles">';
  h += '<div class="tile add" onclick="App.go(\'newstudio\')"><div class="add-in"><div class="add-plus">+</div><div><b>New account studio</b><br><span class="small muted">The full machinery from a brief or a prepared layer, on the same rules and design as Ecolab and Solenis.</span></div></div></div>';
  h += '<div class="tile add" onclick="App.go(\'newov\')"><div class="add-in"><div class="add-plus">+</div><div><b>New account overview</b><br><span class="small muted">A readable tile from a pasted or uploaded document.</span></div></div></div>';
  h += '<div class="tile add" onclick="App.go(\'access\')"><div class="add-in"><div class="add-plus">&#9998;</div><div><b>Access</b><br><span class="small muted">Add people, set their level: admin or read. Reset passwords.</span></div></div></div>';
  h += '<div class="tile add" onclick="App.go(\'activity\')"><div class="add-in"><div class="add-plus">&#9776;</div><div><b>Activity</b><br><span class="small muted">Who signed in, what they generated, edited and downloaded.</span></div></div></div>';
  h += '</div>';
  /* The complete configuration set lives here too, so a new studio can be
     created and run without ever opening an existing one. One set of keys
     powers every studio; the studio Settings pages read the same values. */
  h += '<h2 style="margin-top:22px;">Configuration for every studio</h2>';
  h += '<p class="muted">One set of settings powers Ecolab, Solenis and every studio you create from here: the writing model and API keys drive research and drafting, HubSpot drives push, Voice sets the sign-off, and the shared store carries users, access and records to every device. Set them once, save, and any new account studio starts with full functionality.</p>';
  h += cardModelHtml();
  h += cardHubspotHtml();
  h += cardVoiceHtml();
  h += cardStoreHtml();
  h += '<div class="row2"><button class="primary" onclick="App.saveSettings()">Save settings</button></div>';
  h += cardHealthHtml();
  return h;
};

/* ---------- Build, health and backup ---------- */
function studioStats(){
  var recs = Central.all().filter(function(r){ return !r.deleted; });
  var accts = allAccounts();
  var users = Object.keys(hubUsers()).length;
  var byAcct = {};
  recs.forEach(function(r){ byAcct[r.account] = (byAcct[r.account] || 0) + 1; });
  return { records: recs.length, accounts: accts.length, users: users, byAcct: byAcct,
           approved: recs.filter(function(r){ return r.status === 'approved'; }).length,
           review: recs.filter(function(r){ return r.status === 'review'; }).length };
}
function cardHealthHtml(){
  var st = Cloud.status || { state: 'off', detail: '' };
  var stWord = st.state === 'ok' ? 'Connected' : st.state === 'error' ? 'Problem' : 'Not connected';
  var stCls = st.state === 'ok' ? 'green' : st.state === 'error' ? 'red' : 'grey';
  var s = studioStats();
  var h = '<div class="card"><h2>Build and health</h2>';
  h += '<div class="kv">' +
    '<div class="k">Version</div><div class="v">' + esc(BUILD.version) + ', released ' + esc(BUILD.date) + '</div>' +
    '<div class="k">Shared store</div><div class="v"><span class="pill ' + stCls + '">' + stWord + '</span> ' + esc(st.detail || '') + '</div>' +
    '<div class="k">Held on this device</div><div class="v">' + s.records + ' draft' + (s.records === 1 ? '' : 's') +
      ' across ' + s.accounts + ' account' + (s.accounts === 1 ? '' : 's') + '. ' + s.review + ' in review, ' + s.approved + ' approved. ' +
      s.users + ' user record' + (s.users === 1 ? '' : 's') + '.</div>' +
    '<div class="k">Local storage</div><div class="v">' + (Store.usable() ? 'Working normally.' : 'Blocked by this browser. Nothing entered here will survive; use a normal window.') + '</div>' +
    '</div>';
  h += '<h3 style="margin-top:16px;">Recent releases</h3><ul class="small">';
  (BUILD.notes || []).slice(0, 5).forEach(function(n){ h += '<li>' + esc(n) + '</li>'; });
  h += '</ul>';
  h += '<h3 style="margin-top:16px;">Backup</h3>' +
    '<p class="small muted">A backup holds everything this browser knows: contacts, drafts, approvals, sequences, users and settings. Take one before uploading a new build. Restoring replaces what is on this device with the contents of the file.</p>' +
    '<div class="row2">' +
    '<button class="mini primary" onclick="App.backupAll()">Back up everything</button>' +
    '<input type="file" id="restore-file" accept=".json" style="display:none;" onchange="App.restoreAll(this)">' +
    '<button class="mini" onclick="App.pickRestore()">Restore from a backup</button>' +
    '</div>' +
    (App.backupNote ? '<div class="banner ok" style="margin-top:10px;">' + esc(App.backupNote) + '</div>' : '') +
    '</div>';
  return h;
}
App.pickRestore = function(){
  var el = document.getElementById('restore-file');
  if (el) el.click();
};
App.backupAll = function(){
  var out = {};
  var n = 0;
  try {
    for (var i = 0; i < localStorage.length; i++){
      var k = localStorage.key(i);
      if (k && k.indexOf('eas_') === 0){ out[k] = localStorage.getItem(k); n++; }
    }
  } catch(e){}
  var payload = { kind: 'futurebridge-account-studio-backup', version: BUILD.version,
                  taken: nowIso(), by: App.user, keys: n, data: out };
  download('account-studio-backup-' + nowIso().slice(0, 10) + '.json', JSON.stringify(payload), 'application/json');
  Log.add('download', 'full backup taken, ' + n + ' keys');
  App.backupNote = n + ' item' + (n === 1 ? '' : 's') + ' saved to the backup file. Keep it somewhere you can find it.';
  render();
};
App.restoreAll = function(input){
  var f = input.files[0]; if (!f) return;
  var reader = new FileReader();
  reader.onload = function(){
    var p;
    try { p = JSON.parse(String(reader.result || '')); }
    catch(e){ alert('That file is not a studio backup; it could not be read as JSON.'); return; }
    if (!p || p.kind !== 'futurebridge-account-studio-backup' || !p.data){
      alert('That file is not a studio backup. Use a file produced by Back up everything.');
      return;
    }
    var keys = Object.keys(p.data);
    if (!confirm('Restore ' + keys.length + ' items from the backup taken on ' + String(p.taken || '').slice(0, 10) +
                 '? What is currently on this device will be replaced.')) return;
    var done = 0;
    keys.forEach(function(k){
      try { localStorage.setItem(k, p.data[k]); done++; } catch(e){}
    });
    Log.add('edit', 'restored from backup, ' + done + ' keys');
    alert(done + ' items restored. The studio will reload.');
    location.reload();
  };
  reader.readAsText(f);
};

/* ---------- Access panel, super admin only ---------- */
PAGES.access = function(){
  if (!isSuper()) return '<p class="muted">Nothing to show.</p>';
  var users = hubUsers();
  var h = '<h1>Access</h1><p class="muted">Three levels. Admin opens every studio: research, drafting, editing, review, approval and the practice-review and approved downloads, but no contact uploads and no hub settings. Read opens the account overviews plus the contacts and their researched profiles, nothing else. The super admin emails are fixed in the file. Changes take effect at the next render and are written to the action log.</p>';
  var st = Cloud.status || { state: 'off', detail: '' };
  var stCls = st.state === 'ok' ? 'ok' : st.state === 'error' ? 'err' : 'warn';
  var stLead = st.state === 'ok' ? 'Shared store: connected. ' : st.state === 'error' ? 'Shared store problem. ' : 'Shared store: not configured. Users added here can sign in only on this device until it is connected. ';
  h += '<div class="banner ' + stCls + '">' + esc(stLead + (st.detail || '')) + ' <button class="mini" style="margin-left:8px;" onclick="App.syncAccess()">Sync now</button></div>';
  h += '<p class="small muted">' + Object.keys(users).length + ' user' + (Object.keys(users).length === 1 ? '' : 's') + ' known on this device.</p>';
  h += '<div class="card"><h3>Add a user</h3><div class="row2">' +
    '<input type="text" id="au-email" placeholder="email@futurebridge.com" style="max-width:260px;">' +
    '<input type="text" id="au-pw" placeholder="Temporary password" style="max-width:200px;">' +
    '<select id="au-role" style="max-width:130px;"><option value="read">Read</option><option value="admin">Admin</option></select>' +
    '<button class="mini primary" onclick="App.addHubUser()">Add user</button></div>' +
    '<p class="small muted" style="margin-top:8px;">Share the temporary password directly with the person. They can change it in Settings once signed in. Passwords are stored only as salted hashes; client-side gating in a static file is trust-level access control for a small team, not hardened security.</p></div>';
  h += '<div class="card"><table class="grid"><tr><th>User</th><th>Level</th><th>Password</th><th></th></tr>';
  var emails = Object.keys(users).sort();
  if (!emails.length) h += '<tr><td colspan="4" class="muted">Nobody has been added yet. Add the first user above.</td></tr>';
  emails.forEach(function(em){
    var rec = users[em] || {};
    var isOwner = SUPER_ADMINS.indexOf(em) >= 0;
    /* Show the effective role, legacy Full grants included. */
    var role = rec.role;
    if (!role){
      role = 'read';
      var lv = rec.levels || {};
      for (var k in lv) if (lv[k] === 'full') role = 'admin';
    }
    h += '<tr><td><b>' + esc(em) + '</b></td>';
    if (isOwner){
      h += '<td><span class="pill green">Super admin</span></td>';
    } else {
      h += '<td><select onchange="App.setRole(\'' + esc(em) + '\',this.value)">' +
        '<option value="read"' + (role === 'read' ? ' selected' : '') + '>Read</option>' +
        '<option value="admin"' + (role === 'admin' ? ' selected' : '') + '>Admin</option></select></td>';
    }
    h += '<td><button class="mini" onclick="App.resetPw(\'' + esc(em) + '\')">Reset</button></td>';
    h += '<td>' + (isOwner ? '' : '<button class="mini danger" onclick="App.removeHubUser(\'' + esc(em) + '\')">Remove</button>') + '</td></tr>';
  });
  h += '</table></div>';
  return h;
};
App.syncAccess = function(){
  Cloud.refreshAccess().then(function(){ render(); });
};
App.unlockAdmin = function(){
  var ans = (document.getElementById('unlock-ans').value || '').toLowerCase().replace(/\s+/g, '');
  if (sha256(ans) === SEC_HASH){
    var m = answeredMap(); m[App.user] = true; Store.setJSON('sa_answered', m);
    App.unlockNote = '';
    Log.add('sign in', 'administrator access unlocked');
  } else {
    App.unlockNote = 'That answer did not match. Nothing has changed.';
  }
  render();
};
App.addHubUser = function(){
  var em = (document.getElementById('au-email').value || '').trim().toLowerCase();
  var pw = document.getElementById('au-pw').value || '';
  var role = (document.getElementById('au-role') || {}).value === 'admin' ? 'admin' : 'read';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ alert('Enter a full email address.'); return; }
  if (pw.length < 6){ alert('Choose a temporary password of at least six characters.'); return; }
  setUserPassword(em, pw);
  var users = hubUsers(); if (users[em]){ users[em].role = role; saveHubUsers(users); Cloud.pushUser(em); }
  Log.add('edit', 'access: user added ' + em + ' as ' + role);
  render();
};
App.setRole = function(em, val){
  var users = hubUsers(); var rec = users[em]; if (!rec) return;
  rec.role = (val === 'admin') ? 'admin' : 'read';
  /* Clear legacy per-account grants so the role is the single truth. */
  delete rec.levels; delete rec.admins;
  saveHubUsers(users); Cloud.pushUser(em);
  Log.add('edit', 'access: ' + em + ' set to ' + rec.role);
  render();
};
App.resetPw = function(em){
  var pw = prompt('New temporary password for ' + em + ' (at least six characters):');
  if (!pw || pw.length < 6) return;
  setUserPassword(em, pw);
  Log.add('edit', 'access: password reset for ' + em);
  render();
};
App.removeHubUser = function(em){
  if (SUPER_ADMINS.indexOf(em) >= 0){ alert('The owner emails cannot be removed.'); return; }
  var users = hubUsers(); delete users[em]; saveHubUsers(users); Cloud.pushUser(em);
  Log.add('edit', 'access: user removed ' + em);
  render();
};

/* ---------- New account overview, super admin only ---------- */
PAGES.newov = function(){
  if (!isSuper()) return '<p class="muted">Nothing to show.</p>';
  var h = '<h1>New account overview</h1><p class="muted">Creates an account tile from a document, without a full studio. Everyone who can sign in can read it; every other tab stays empty until a full studio is built for the account. Paste the overview or upload a .txt, .md or .html file.</p>';
  h += '<div class="card">' +
    '<label class="f">Account name</label><input type="text" id="ov-name" placeholder="For example: Kemira" style="max-width:320px;">' +
    '<label class="f">Practice</label><input type="text" id="ov-practice" value="Chemicals and Natural Resources" style="max-width:320px;">' +
    '<label class="f">Overview content (paste here, or upload below)</label><textarea id="ov-text" rows="10" placeholder="Paste the account overview"></textarea>' +
    '<label class="f">Or upload a file</label><input type="file" id="ov-file" accept=".txt,.md,.html">' +
    '<div class="row2" style="margin-top:12px;"><button class="primary" onclick="App.createOverview()">Create account tile</button></div>' +
    (App.ovNote ? '<div class="banner ok" style="margin-top:10px;">' + esc(App.ovNote) + '</div>' : '') +
    '</div>';
  return h;
};
function textToOverviewHtml(text, isHtml){
  if (isHtml){
    /* Strip active content; keep the markup. */
    return String(text).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ on[a-z]+="[^"]*"/gi, '');
  }
  var lines = String(text).split(/\r?\n/);
  var out = [];
  lines.forEach(function(ln){
    var t = ln.trim();
    if (!t){ return; }
    if (/^##\s+/.test(t)) out.push('<h2>' + esc(t.replace(/^##\s+/, '')) + '</h2>');
    else if (/^#\s+/.test(t)) out.push('<h2>' + esc(t.replace(/^#\s+/, '')) + '</h2>');
    else if (/^[-*]\s+/.test(t)) out.push('<p>' + esc(t.replace(/^[-*]\s+/, '')) + '</p>');
    else out.push('<p>' + esc(t) + '</p>');
  });
  return '<div class="card">' + out.join('\n') + '</div>';
}
App.createOverview = function(){
  var name = (document.getElementById('ov-name').value || '').trim();
  if (!name){ alert('Give the account a name.'); return; }
  var practice = (document.getElementById('ov-practice').value || '').trim();
  var fileEl = document.getElementById('ov-file');
  var finish = function(html){
    var id = 'ov_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    var list = overviewAccounts().filter(function(a){ return a.id !== id; });
    var a = { id: id, name: name, practice: practice, html: html, created: nowIso(), author: App.user };
    list.push(a);
    saveOverviewAccounts(list);
    Cloud.pushHubAccount(a);
    Log.add('edit', 'overview account created: ' + name);
    App.ovNote = 'The ' + name + ' tile is live. Everyone who can sign in can read its summary.';
    render();
  };
  if (fileEl.files && fileEl.files[0]){
    var f = fileEl.files[0];
    var reader = new FileReader();
    reader.onload = function(){
      finish(textToOverviewHtml(String(reader.result || ''), /\.html?$/i.test(f.name)));
    };
    reader.readAsText(f);
  } else {
    var text = document.getElementById('ov-text').value || '';
    if (!text.trim()){ alert('Paste the overview or choose a file.'); return; }
    finish(textToOverviewHtml(text, false));
  }
};
App.deleteOverview = function(id){
  var a = accountById(id);
  if (!a || !a.dynamic) return;
  if (!confirm('Remove the account "' + a.name + '" from the hub on every device? Its drafts stay in the shared store but will no longer be reachable from a studio.')) return;
  saveOverviewAccounts(overviewAccounts().filter(function(x){ return x.id !== id; }));
  /* The store keeps a small tombstone in the account's place, so the pull on
     every sign in, on every device, drops it rather than restoring it. */
  Cloud.pushHubAccount({ id: id, name: a.name, deleted: true, deletedBy: App.user, deletedAt: nowIso() });
  Log.add('delete', 'account removed from the hub: ' + a.name);
  render();
};

/* ---------- Activity, super admin only ---------- */
PAGES.activity = function(){
  if (!isSuper()) return '<p class="muted">Nothing to show.</p>';
  var entries = Log.all();
  var by = {};
  entries.forEach(function(e){
    var u = by[e.actor] = by[e.actor] || { signins: 0, views: 0, edits: 0, generates: 0, approves: 0, exports: 0, downloads: 0, deletes: 0, research: 0, sent: 0, first: e.ts, last: e.ts, lastSignin: '' };
    if (e.ts < u.first) u.first = e.ts;
    if (e.ts > u.last) u.last = e.ts;
    if (e.action === 'sign in'){ u.signins++; if (e.ts > u.lastSignin) u.lastSignin = e.ts; }
    else if (e.action === 'view') u.views++;
    else if (e.action === 'edit') u.edits++;
    else if (e.action === 'generate') u.generates++;
    else if (e.action === 'approve') u.approves++;
    else if (e.action === 'export') u.exports++;
    else if (e.action === 'download') u.downloads++;
    else if (e.action === 'delete') u.deletes++;
    else if (e.action === 'research') u.research++;
    else if (e.action === 'sent-mark') u.sent++;
  });
  var h = '<h1>Activity</h1><p class="muted">Who signed in, when and how often, what they opened, edited, generated, approved, exported and downloaded. Built from the action log on this device' + (Cloud.on() ? ' merged with the shared store.' : '. Connect the shared store to see activity from other devices.') + '</p>';
  h += '<div class="row2" style="margin-bottom:12px;">' +
    (Cloud.on() ? '<button class="mini" onclick="App.activityRefresh()">Pull latest from the shared store</button>' : '') +
    '<button class="mini" onclick="App.exportLog()">Export the full log as CSV</button></div>';
  if (App.actNote) h += '<div class="banner info">' + esc(App.actNote) + '</div>';
  h += '<div class="card"><h2>By person</h2><table class="grid"><tr><th>User</th><th>Sign-ins</th><th>Last sign-in</th><th>Views</th><th>Edits</th><th>Generated</th><th>Approved</th><th>Exports</th><th>Downloads</th><th>Last activity</th></tr>';
  Object.keys(by).sort().forEach(function(u){
    var r = by[u];
    h += '<tr><td><b>' + esc(u) + '</b></td><td>' + r.signins + '</td><td class="small">' + fmtDateTime(r.lastSignin) + '</td><td>' + r.views + '</td><td>' + r.edits + '</td><td>' + r.generates + '</td><td>' + r.approves + '</td><td>' + r.exports + '</td><td>' + r.downloads + '</td><td class="small">' + fmtDateTime(r.last) + '</td></tr>';
  });
  h += '</table></div>';
  var af = (App.actFilter || '').toLowerCase();
  var sel = App.actAction || '';
  var actions = ['sign in','sign out','view','edit','generate','approve','export','download','delete','research','sent-mark'];
  h += '<div class="card"><h2>The full trail, newest first</h2><div class="row2" style="margin-bottom:8px;">' +
    '<input type="text" placeholder="Filter by person or detail" value="' + esc(App.actFilter || '') + '" style="max-width:260px;" onchange="App.actFilter=this.value;render()">' +
    '<select style="max-width:170px;" onchange="App.actAction=this.value;render()"><option value="">All actions</option>' +
    actions.map(function(a){ return '<option value="' + a + '"' + (sel === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></div>';
  var list = entries.filter(function(e){
    if (sel && e.action !== sel) return false;
    if (af && (e.actor + ' ' + e.detail).toLowerCase().indexOf(af) < 0) return false;
    return true;
  });
  h += '<table class="grid"><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>';
  list.slice(-400).reverse().forEach(function(e){
    h += '<tr><td class="small">' + fmtDateTime(e.ts) + '</td><td class="small">' + esc(e.actor) + '</td><td class="small">' + esc(e.action) + '</td><td class="small">' + esc(e.detail) + '</td></tr>';
  });
  h += '</table><p class="small muted">' + list.length + ' entries match. The log keeps the most recent 12,000 actions.</p></div>';
  return h;
};
App.activityRefresh = function(){
  App.actNote = 'Pulling the shared record.'; render();
  Cloud.refresh().then(function(msg){ App.actNote = msg; render(); });
};

/* ---------- New account studio, super admin only ---------- */
var LAYER_SCHEMA_NOTE = 'The account layer JSON needs: company (string); briefDate (string); summaryHtml (the Account summary page as HTML in the studio card markup: an h1 that reads like a conclusion, a source-note paragraph, several div class card sections with h2 headings, p and table class grid where tabular, and details class xd blocks each holding a summary element plus a div class xd-body for the deeper click-level detail, exactly as the Ecolab and Solenis summaries do); wedges (array of {rank, title, decision, actors, timing, findOut, boundary, confidence: HIGH or MEDIUM-HIGH or MEDIUM, detail: {consequence, whyExternal, signals, question}}); profiles (array of {id, wedge, role, owns, pressures, subject, email, inmail} where email ends with the exact close sentence and carries no sign-off block); sources (array of [id, title, publisher, url]); evidenceRules ({loadBearing:[], neverQuote:[], bannedNumbers:[]} with real entries, never empty); modelContext (the condensed facts handed to the writer, ending with the evidence discipline boundaries).';
function layerTemplate(){
  return JSON.stringify({
    company: 'Account name', briefDate: 'date of the brief', summaryHtml: '<h1>Heading that reads like a conclusion</h1><div class="card"><h2>Section</h2><p>Content traced to the brief.</p></div>',
    wedges: [{ rank: 1, title: '', decision: '', actors: '', timing: '', findOut: '', boundary: '', confidence: 'HIGH', detail: { consequence: '', whyExternal: '', signals: '', question: '' } }],
    profiles: [{ id: 'p1', wedge: 1, role: '', owns: '', pressures: '', subject: 'three to seven plain words', email: 'Hi [First name],\n\n...\n\n' + CLOSE_SENTENCE, inmail: 'Hi [First name],\n\n...\n\n' + CLOSE_SENTENCE }],
    sources: [['S1', 'title', 'publisher, date', 'https://']],
    evidenceRules: { loadBearing: [], neverQuote: [], bannedNumbers: [] },
    modelContext: 'ACCOUNT CONTEXT: ... HARD BOUNDARIES: ...'
  }, null, 1);
}
function layerGenPrompt(){
  return ['Build an account layer JSON for the FutureBridge Account Studio Hub from the attached account brief. Derive everything from the brief under absolute evidence discipline: nothing appears that the brief does not support, and where the brief is silent the layer stays silent.',
    LAYER_SCHEMA_NOTE,
    'The account summary must read to the Siva Standard: sentence-case headings that read like conclusions, no em dashes, no hype, every figure traced to the brief. Derive three to five ranked wedges by nearness of the decision, and one role-based profile per leading wedge.',
    'Baked profile drafts follow the full writing method below, exactly. Emails 90 to 130 words ending with the exact close sentence and no sign-off block; InMails 60 to 90 words with the same close.',
    '', WRITER_METHOD, '', 'Return only the JSON object.'].join('\n');
}
function validateLayer(L){
  var errs = [];
  if (!L || typeof L !== 'object') return ['The JSON did not parse into an object.'];
  if (!L.company) errs.push('company is missing.');
  if (!L.summaryHtml || String(L.summaryHtml).length < 200) errs.push('summaryHtml is missing or too thin.');
  if (!L.wedges || !L.wedges.length) errs.push('wedges are missing.');
  if (!L.profiles || !L.profiles.length) errs.push('profiles are missing.');
  (L.profiles || []).forEach(function(p, i){
    if (!p.role || !p.subject || !p.email || !p.inmail) errs.push('profile ' + (i + 1) + ' is missing role, subject, email or inmail.');
    if (p.email && p.email.indexOf(CLOSE_SENTENCE) < 0) errs.push('profile ' + (i + 1) + ' email is missing the exact close sentence.');
  });
  if (!L.modelContext) errs.push('modelContext is missing.');
  if (!L.sources || !L.sources.length) errs.push('sources are missing.');
  return errs;
}
function sanitizeLayer(L){
  L.summaryHtml = String(L.summaryHtml).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/ on[a-z]+="[^"]*"/gi, '');
  L.evidenceRules = L.evidenceRules || { loadBearing: [], neverQuote: [], bannedNumbers: [] };
  (L.profiles || []).forEach(function(p, i){ p.id = p.id || ('np' + (i + 1)); p.wedge = p.wedge || (i + 1); });
  (L.wedges || []).forEach(function(w){ if (w.confidence !== 'HIGH' && w.confidence !== 'MEDIUM-HIGH' && w.confidence !== 'MEDIUM') w.confidence = 'MEDIUM'; });
  return L;
}

/* Extract the text of a .docx in the browser: minimal zip walk to
   word/document.xml, inflate with the built-in DecompressionStream,
   strip the XML. No libraries; works in every current browser. */
function docxExtractText(buf){
  return new Promise(function(resolve, reject){
    try {
      var dv = new DataView(buf); var u8 = new Uint8Array(buf);
      var i = buf.byteLength - 22; var found = -1;
      var min = Math.max(0, buf.byteLength - 22 - 65536);
      for (; i >= min; i--){ if (dv.getUint32(i, true) === 0x06054b50){ found = i; break; } }
      if (found < 0) throw new Error('no zip directory in the file');
      var count = dv.getUint16(found + 10, true);
      var p = dv.getUint32(found + 16, true);
      var entry = null;
      for (var n = 0; n < count; n++){
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        var method = dv.getUint16(p + 10, true);
        var csize = dv.getUint32(p + 20, true);
        var nlen = dv.getUint16(p + 28, true);
        var elen = dv.getUint16(p + 30, true);
        var clen = dv.getUint16(p + 32, true);
        var lho = dv.getUint32(p + 42, true);
        var nm = '';
        for (var q = 0; q < nlen; q++) nm += String.fromCharCode(u8[p + 46 + q]);
        if (nm === 'word/document.xml'){ entry = { method: method, csize: csize, lho: lho }; break; }
        p += 46 + nlen + elen + clen;
      }
      if (!entry) throw new Error('word/document.xml not found; is this a Word file?');
      var lp = entry.lho;
      if (dv.getUint32(lp, true) !== 0x04034b50) throw new Error('damaged zip entry');
      var start = lp + 30 + dv.getUint16(lp + 26, true) + dv.getUint16(lp + 28, true);
      var comp = u8.subarray(start, start + entry.csize);
      var done = function(xmlBytes){
        var xml = new TextDecoder('utf-8').decode(xmlBytes);
        var text = xml
          .replace(/<w:tab[^>]*\/>/g, '\t')
          .replace(/<\/w:p>/g, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/\n{3,}/g, '\n\n').trim();
        resolve(text);
      };
      if (entry.method === 0){ done(comp); return; }
      if (entry.method !== 8) throw new Error('unsupported compression method');
      if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot inflate zip data');
      var stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      new Response(stream).arrayBuffer().then(function(out){ done(new Uint8Array(out)); }).catch(reject);
    } catch(e){ reject(e); }
  });
}
function bytesToB64(u8){
  var bin = ''; var CH = 0x8000;
  for (var i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(bin);
}
App.nsReadFile = function(input){
  var f = input.files[0]; if (!f) return;
  App.nsFileErr = false;
  var reader = new FileReader();
  reader.onload = function(){
    var buf = reader.result;
    var u8 = new Uint8Array(buf);
    var b64 = bytesToB64(u8);
    var isDocx = /\.docx$/i.test(f.name);
    var mime = isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : /\.html?$/i.test(f.name) ? 'text/html' : 'text/plain';
    var finish = function(text){
      text = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
      if (text.length < 200){
        App.nsFileErr = true; App.nsBriefText = ''; App.nsDoc = null;
        App.nsFileNote = 'Only ' + wordCount(text) + ' words could be read from ' + f.name + ', which is too thin to derive a studio from. Check the file, or paste the text below.';
      } else {
        App.nsBriefText = text;
        App.nsDoc = { name: f.name, b64: b64, mime: mime, label: 'The original account overview uploaded on ' + fmtDate(nowIso()) + ', the source document behind this studio.' };
        App.nsFileNote = 'Read ' + wordCount(text) + ' words from ' + f.name + '. It will be used as the brief, and the document itself becomes the studio\'s downloadable source brief, exactly as in Ecolab and Solenis.';
      }
      render();
    };
    if (isDocx){
      docxExtractText(buf).then(finish).catch(function(e){
        App.nsFileErr = true; App.nsBriefText = ''; App.nsDoc = null;
        App.nsFileNote = 'Could not read ' + f.name + ' in this browser (' + e.message + '). Save it as .txt and upload that, or paste the text below.';
        render();
      });
    } else {
      var text = new TextDecoder('utf-8').decode(u8);
      if (/\.html?$/i.test(f.name)) text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
      finish(text);
    }
  };
  reader.readAsArrayBuffer(f);
};
PAGES.newstudio = function(){
  if (!isSuper()) return '<p class="muted">Nothing to show.</p>';
  var h = '<h1>New account studio</h1><p class="muted">Creates a complete studio, with the full writing, research, audit and sequence machinery, from an account layer. No development is needed: generate the layer here from a pasted brief, or paste a layer JSON prepared outside. The new studio runs on exactly the same rules, design and settings as Ecolab and Solenis: same writing standard, same enforcement, same access levels, same keys.</p>';
  if (!Store.get('anthropic_key')) h += '<div class="banner warn">No Anthropic API key is saved on this device yet, so generating a layer from a brief will not run. Save the key under Hub settings, Configuration for every studio, then come back here.</div>';
  if (App.nsBusy) h += '<div class="banner info">' + esc(App.nsBusy) + '</div>';
  if (App.nsError) h += '<div class="banner err">' + esc(App.nsError) + '</div>';
  if (App.nsPreview){
    var P = App.nsPreview;
    h += '<div class="card"><h2>Ready to create: ' + esc(P.name) + '</h2>';
    h += '<p class="small muted">' + (P.layer.profiles || []).length + ' role profiles, ' + (P.layer.wedges || []).length + ' wedges, ' + (P.layer.sources || []).length + ' sources. Brief date: ' + esc(P.layer.briefDate || 'not stated') + '. Source document: ' + (P.layer.doc ? esc(P.layer.doc.name) + ', downloadable in the studio' : 'none attached') + '.</p>';
    (P.layer.profiles || []).forEach(function(p){
      var v = scanDraft({ subject: p.subject, email: p.email, inmail: p.inmail }, {});
      h += '<div class="check-line">' + (v.length ? '<span class="ic fail">FAIL</span>' : '<span class="ic pass">PASS</span>') + '<span><b>' + esc(p.role) + '.</b> Email ' + wordCount(p.email) + ' words, InMail ' + wordCount(p.inmail) + ' words.' + (v.length ? ' ' + esc(v[0]) : ' Passes the mechanical scan.') + '</span></div>';
    });
    h += '<div class="row2" style="margin-top:12px;"><button class="primary" onclick="App.saveNewStudio()">Create the studio</button>' +
      '<button onclick="App.nsPreview=null;render()">Discard</button></div></div>';
  }
  h += '<div class="card"><h2>Generate the studio from an account overview</h2>' +
    '<p class="small muted">Upload the account overview document (.docx, .txt, .md or .html), or paste the brief text below. The studio reads the document in the browser, derives the detailed summary with its expandable sections, the ranked wedges, the role profiles and their baked drafts under the full house method including the latest practice rules, runs the mechanical scan and the repair pass, and shows a preview before anything is created. An uploaded document also becomes the studio\'s downloadable source brief. A long overview takes a minute or two.</p>' +
    '<div class="row2"><input type="text" id="ns-name" placeholder="Account name" style="max-width:240px;"><input type="text" id="ns-practice" value="Chemicals and Natural Resources" style="max-width:280px;"></div>' +
    '<label class="f">Account overview document</label><input type="file" id="ns-file" accept=".docx,.txt,.md,.html" onchange="App.nsReadFile(this)">' +
    (App.nsFileNote ? '<div class="banner ' + (App.nsFileErr ? 'err' : 'ok') + '" style="margin-top:8px;">' + esc(App.nsFileNote) + '</div>' : '') +
    '<label class="f">Or paste the account brief text</label><textarea id="ns-brief" rows="10" placeholder="Paste the full account brief">' + esc(App.nsBriefPaste || '') + '</textarea>' +
    '<div class="row2" style="margin-top:10px;"><button class="primary" onclick="App.genStudioLayer()">Generate account studio</button></div></div>';
  h += '<div class="card"><h2>Or paste a prepared account layer JSON</h2>' +
    '<p class="small muted">' + esc(LAYER_SCHEMA_NOTE) + '</p>' +
    '<textarea id="ns-json" rows="7" placeholder="Paste the account layer JSON"></textarea>' +
    '<div class="row2" style="margin-top:10px;"><button onclick="App.createStudioFromJSON()">Validate and preview</button>' +
    '<button class="mini" onclick="download(\'account-layer-template.json\', layerTemplate(), \'application/json\')">Download the template</button>' +
    '<button class="mini" onclick="copyText(layerGenPrompt(), this)">Copy the generation prompt</button></div></div>';
  return h;
};
App.createStudioFromJSON = function(){
  App.nsError = ''; App.nsPreview = null;
  var name = (document.getElementById('ns-name') ? document.getElementById('ns-name').value : '').trim();
  var raw = document.getElementById('ns-json').value || '';
  var L;
  try { L = JSON.parse(raw); } catch(e){ App.nsError = 'That is not valid JSON: ' + e.message; render(); return; }
  var errs = validateLayer(L);
  if (errs.length){ App.nsError = 'The layer is not complete: ' + errs.join(' '); render(); return; }
  L = sanitizeLayer(L);
  App.nsPreview = { name: name || L.company, practice: 'Chemicals and Natural Resources', layer: L };
  render();
};
App.genStudioLayer = function(){
  var name = document.getElementById('ns-name').value.trim();
  var practice = document.getElementById('ns-practice').value.trim();
  var pasted = document.getElementById('ns-brief').value.trim();
  App.nsBriefPaste = pasted;
  var brief = (App.nsBriefText && App.nsBriefText.length >= 200) ? App.nsBriefText : pasted;
  if (!name){ alert('Give the account a name.'); return; }
  if (brief.length < 600){ alert('Upload the account overview or paste the full brief; what is here looks too short to derive a studio from.'); return; }
  App.nsBusy = 'Deriving the account layer from the brief. This runs the full writing method and can take a minute or two.';
  App.nsError = ''; App.nsPreview = null; render();
  var sys = 'You build account layers for the FutureBridge Account Studio Hub, to the same depth and structure as its Ecolab and Solenis studios. Derive everything only from the supplied overview; where it is silent, stay silent and treat the gap as a question to ask, never a number to invent. ' + LAYER_SCHEMA_NOTE +
    ' Depth requirements: the summary carries at least 4 card sections (scale and ownership; the business and its units, with a table where the overview supports one; the strategic moves or pressures in play; how to read this account), plus at least 2 details class xd expandable sections holding the deeper click-level material. Headings read like conclusions. The Siva Standard throughout: no em dashes, no hype, digits for numbers, every figure from the overview. 3 to 5 wedges ranked by nearness of the decision, each with confidence and the full detail block. 1 role profile per leading wedge. evidenceRules must be populated: load-bearing claims with their figures, what is never quoted, which numbers stay out of outreach. modelContext condenses the facts for the writer and ends with the evidence boundaries. Baked drafts follow the writing method below exactly, including the promise rule: never offer analysis that does not exist; frame our vantage as hypotheses and open questions.\n\n' + WRITER_METHOD + '\n\nReturn strict JSON only.';
  callForJSON({ system: sys, messages: [{ role: 'user', content: 'Account name: ' + name + '\n\nACCOUNT OVERVIEW:\n' + brief.slice(0, 60000) + '\n\nReturn the account layer JSON only.' }], maxTokens: 12000 }, 'account layer generation')
    .then(function(L){
      var errs = validateLayer(L);
      if (errs.length) throw new Error('The generated layer was incomplete: ' + errs.join(' '));
      L = sanitizeLayer(L);
      /* Enforcement: scan every baked draft, repair what fails, re-scan. */
      var chain = Promise.resolve();
      (L.profiles || []).forEach(function(p){
        chain = chain.then(function(){
          var v = scanDraft({ subject: p.subject, email: p.email, inmail: p.inmail }, {});
          if (!v.length) return;
          return runRepair({ subject: p.subject, email: p.email, inmail: p.inmail }, v).then(function(fixed){
            p.subject = fixed.subject || p.subject; p.email = fixed.email || p.email; p.inmail = fixed.inmail || p.inmail;
          });
        });
      });
      return chain.then(function(){
        if (App.nsDoc) L.doc = App.nsDoc;
        App.nsBusy = '';
        App.nsPreview = { name: name, practice: practice, layer: L };
        Log.add('generate', 'account layer generated: ' + name);
        render();
      });
    })
    .catch(function(e){ App.nsBusy = ''; App.nsError = e.message; render(); });
};
App.saveNewStudio = function(){
  var P = App.nsPreview; if (!P) return;
  var id = 'st_' + P.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  var list = overviewAccounts().filter(function(a){ return a.id !== id; });
  var a = { id: id, name: P.name, practice: P.practice, kind: 'studio', layer: P.layer, created: nowIso(), author: App.user };
  list.push(a);
  saveOverviewAccounts(list);
  Cloud.pushHubAccount(a);
  Log.add('edit', 'account studio created: ' + P.name);
  App.nsPreview = null; App.nsBriefText = ''; App.nsDoc = null; App.nsFileNote = ''; App.nsBriefPaste = '';
  App.goHome();
};

/* ---------- Account summary ---------- */
PAGES.summary = function(){
  var a = accountById(App.account);
  if (!a) return PAGES.home();
  var docBtn = '';
  var L = a.layer;
  if (L && L.doc){
    docBtn = '<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:260px;"><b>The source overview document</b><br><span class="small muted">' + esc(L.doc.label || 'The document this overview was built from.') + '</span></div>' +
      '<button class="primary" onclick="App.downloadDoc(\'' + a.id + '\')">Download Word document</button></div>';
  }
  if (a.type === 'studio') docBtn = downloadsCardHtml(a);
  if (a.type === 'overview'){
    return '<h1>' + esc(a.name) + '</h1><p class="muted small">Account overview' + (a.practice ? ', ' + esc(a.practice) : '') + '. Uploaded ' + fmtDate(a.created) + '. A full studio for this account can replace this tile without losing the document.</p>' + a.html;
  }
  return docBtn + ACCT().summaryHtml + (ACCT().wedgesInSummary ? '' : wedgesHtml());
};
/* ---------- Downloads by access level ----------
   Everyone signed in can take the account overview and the contact
   intelligence. The generated communication, in every form, is for the
   practice team: admin and super admin. Read access never edits and never
   downloads a draft. */
function intelligenceRows(){
  /* One row per person the studio knows: the shared contact list first, then
     anyone who exists only as a draft record (older imports). */
  var rows = [];
  var seen = {};
  var recs = Central.all().filter(function(r){ return !r.deleted && r.account === App.account; });
  function recFor(c){
    if (c.draftId) for (var i = 0; i < recs.length; i++) if (recs[i].id === c.draftId) return recs[i];
    for (var j = recs.length - 1; j >= 0; j--) if (String(recs[j].contact || '').trim().toLowerCase() === String(c.name || '').trim().toLowerCase()) return recs[j];
    return null;
  }
  contacts().forEach(function(c){
    var r = recFor(c) || {};
    var ev = c.evidence || {};
    var it = c.intel || {};
    var pf = r.profile || {};
    var sig = (ev.signals || []).map(function(x){ return x.text + (x.confidence ? ' [' + x.confidence + ']' : ''); }).join(' | ');
    rows.push({
      name: c.name, title: ev.title_plain || c.title || r.title || '', company: c.company || r.company || '', unit: c.unit || ev.business_unit || '',
      email: c.email || '', linkedin: c.linkedin || ev.linkedin_url || '', city: c.city || (ev.location && ev.location.city) || '', country: c.country || (ev.location && ev.location.country) || '',
      region: (ev.region && ev.region.value) || it.region || pf.region || '',
      priority: it.priority || '', guidance: it.guidance || '', theme: it.theme || pf.theme || '',
      remit: (ev.remit && ev.remit.summary) || it.remit || pf.remit || '',
      goals: (ev.goals && ev.goals.summary) || '',
      account: it.account || pf.account || '',
      person: it.person || pf.person || '',
      signals: sig || it.signals || pf.signals || '',
      status: ev.status || '', employer: ev.current_employer || '',
      confidence: c.audit && c.audit.score != null ? c.audit.score : '', band: (c.audit && c.audit.band) || '',
      researchedAt: c.researchedAt || (ev.summary ? c.updatedAt : '') || '', researchedBy: c.researchedBy || (ev.summary ? c.updatedBy : '') || '',
      stage: r.status || (c.draft ? 'generated' : 'not drafted'),
      editedBy: r.editedBy || c.draftEditedBy || '', editedAt: r.editedAt || c.draftEditedAt || ''
    });
    seen[String(c.name).trim().toLowerCase()] = true;
  });
  for (var i = recs.length - 1; i >= 0; i--){
    var r = recs[i];
    var key = String(r.contact || '').trim().toLowerCase();
    if (!key || seen[key]) continue;
    seen[key] = true;
    var pf = r.profile || {};
    rows.push({ name: r.contact, title: r.title || '', company: r.company || '', unit: '', email: '', linkedin: '', city: '', country: '',
      region: pf.region || '', priority: pf.priority || '', guidance: pf.guidance || '', theme: pf.theme || '', remit: pf.remit || '', goals: '',
      account: pf.account || '', person: pf.person || '', signals: pf.signals || '', status: '', employer: '', confidence: '', band: '',
      researchedAt: r.ts || '', researchedBy: r.author || '', stage: r.status || '', editedBy: r.editedBy || '', editedAt: r.editedAt || '' });
  }
  return rows;
}
function intelligenceCsv(){
  var head = ['contact name','role or title','company','division','email','linkedin','city','country','region','priority','send guidance','theme match',
    'remit','goals and pressures','account intelligence','person intelligence','key signals','employment status','current employer',
    'confidence score','confidence band','researched at','researched by','communication stage','last edited by','last edited at','downloaded at'];
  var lines = [head.join(',')];
  var now = nowIso();
  intelligenceRows().forEach(function(x){
    lines.push([x.name, x.title, x.company, x.unit, x.email, x.linkedin, x.city, x.country, x.region, x.priority, x.guidance, x.theme,
      x.remit, x.goals, x.account, x.person, x.signals, x.status, x.employer, x.confidence, x.band, x.researchedAt, x.researchedBy, x.stage, x.editedBy, x.editedAt, now].map(csvCell).join(','));
  });
  return lines.join('\n');
}
App.downloadIntelligence = function(){
  if (!canRead(App.account)){ alert('This download needs access to the account.'); return; }
  var rows = intelligenceRows();
  if (!rows.length){ alert('No contact has been added or researched in this studio yet.'); return; }
  download(App.account + '-contact-intelligence-' + nowIso().slice(0, 10) + '.csv', intelligenceCsv(), 'text/csv');
  Log.add('download', 'contact intelligence, ' + rows.length + ' people');
};
App.downloadCommunication = function(scope){
  if (!canFull(App.account)){ alert('The generated communication is downloadable by the practice team only.'); return; }
  var items = Central.all().filter(function(r){ return !r.deleted && r.account === App.account && (scope === 'approved' ? r.status === 'approved' : true); });
  if (!items.length){ alert(scope === 'approved' ? 'Nothing is approved for this account yet.' : 'No communication has been generated for this account yet.'); return; }
  var csv = exportMatrix(items);
  download(App.account + '-' + (scope === 'approved' ? 'approved' : 'all') + '-communication-' + nowIso().slice(0, 10) + '.csv', csv, 'text/csv');
  Log.add('download', (scope === 'approved' ? 'approved' : 'all generated') + ' communication, ' + items.length + ' items');
};
function downloadsCardHtml(a){
  var L = a.layer;
  var full = canFull(a.id);
  var n = intelligenceRows().length;
  var recs = Central.all().filter(function(r){ return !r.deleted && r.account === a.id; });
  var approved = recs.filter(function(r){ return r.status === 'approved'; }).length;
  var h = '<div class="card downloads"><div class="dl-head"><h2 style="margin:0;">Downloads</h2><span class="small muted">' +
    (full ? 'Practice team access: overview, intelligence and every generated draft.' : 'Read access: the overview and the intelligence. Drafts stay with the practice team.') + '</span></div>';
  h += '<div class="dl-grid">';
  if (L && L.doc){
    h += '<div class="dl"><b>Account overview</b><span class="small muted">' + esc(L.doc.label || 'The document this overview was built from.') + '</span>' +
      '<button class="mini primary" onclick="App.downloadDoc(\'' + a.id + '\')">Download Word document</button></div>';
  }
  h += '<div class="dl"><b>Account and contact intelligence</b><span class="small muted">' + n + ' ' + (n === 1 ? 'person' : 'people') + ': role, remit, region, account and person intelligence, signals, confidence, who researched them and when. No drafts.</span>' +
    '<button class="mini" onclick="App.downloadIntelligence()"' + (n ? '' : ' disabled') + '>Download CSV</button></div>';
  if (full){
    h += '<div class="dl"><b>Generated communication</b><span class="small muted">' + recs.length + ' draft' + (recs.length === 1 ? '' : 's') + ' across every touch, with status, approval and edit stamps.</span>' +
      '<button class="mini" onclick="App.downloadCommunication(\'all\')"' + (recs.length ? '' : ' disabled') + '>Download CSV</button></div>';
    h += '<div class="dl"><b>Approved communication</b><span class="small muted">' + approved + ' approved, ready to send. Batches by day sit on the Approved emails page.</span>' +
      '<button class="mini" onclick="App.downloadCommunication(\'approved\')"' + (approved ? '' : ' disabled') + '>Download CSV</button></div>';
  }
  h += '</div></div>';
  return h;
}
App.downloadDoc = function(acctId){
  var a = accountById(acctId);
  var doc = a && a.layer && a.layer.doc;
  if (!doc || !doc.b64) return;
  var bin = atob(doc.b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var blob = new Blob([bytes], { type: doc.mime || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  var el = document.createElement('a');
  el.href = URL.createObjectURL(blob);
  el.download = doc.name || 'account-overview.docx';
  document.body.appendChild(el); el.click();
  setTimeout(function(){ URL.revokeObjectURL(el.href); el.remove(); }, 400);
  Log.add('download', 'source document: ' + (a ? a.name : acctId));
};
function wedgesHtml(){
  var h = '<h2 style="margin-top:22px;">The openings, ranked by nearness of the decision</h2>';
  ACCT().wedges.forEach(function(w){
    h += '<div class="card"><div class="row2" style="justify-content:space-between;"><h3 style="margin:0;">Wedge ' + w.rank + '. ' + esc(w.title) + '</h3><span class="pill ' + (w.confidence === 'HIGH' ? 'green' : w.confidence === 'MEDIUM-HIGH' ? 'blue' : 'amber') + '">' + esc(w.confidence) + '</span></div>' +
      '<div class="kv" style="margin-top:10px;">' +
      '<div class="k">The decision</div><div class="v">' + esc(w.decision) + '</div>' +
      '<div class="k">The actors around it</div><div class="v">' + esc(w.actors) + '</div>' +
      '<div class="k">Timing pressure</div><div class="v">' + esc(w.timing) + '</div>' +
      '<div class="k">What we would find out</div><div class="v">' + esc(w.findOut) + '</div>' +
      '<div class="k">Deliberate boundary</div><div class="v">' + esc(w.boundary) + '</div>' +
      '</div>' +
      (w.detail ? '<details class="xd" style="margin-top:6px;"><summary>The detail behind this wedge</summary><div class="xd-body"><div class="kv">' +
        '<div class="k">Commercial consequence</div><div class="v">' + esc(w.detail.consequence) + '</div>' +
        '<div class="k">Why external support</div><div class="v">' + esc(w.detail.whyExternal) + '</div>' +
        '<div class="k">Signals to listen for</div><div class="v">' + esc(w.detail.signals) + '</div>' +
        '<div class="k">Opening question</div><div class="v">' + esc(w.detail.question) + '</div>' +
        '</div></div></details>' : '') +
      '</div>';
  });
  return h;
}

/* ---------- How we write the emails ---------- */
PAGES.method = function(){
  return [
'<h1>Every email must bring something the reader does not already have</h1>',
'<p class="muted">The writing method is the heart of the studio. Every generated draft passes a mechanical scan, an automatic repair pass and a reviewer audit before anyone sees it.</p>',
'<div class="card"><h2>The stance</h2><p>The writer is a senior sector advisor who knows this world personally and is typing the note themselves, one senior person to another. Verified intelligence is used and never exceeded. If there is genuinely nothing new to bring, the studio declines to write; an email with nothing new is the email that gets deleted.</p></div>',
'<div class="card"><h2>What a draft may bring</h2><p>One of three things: a question we keep hearing from named kinds of actors in the reader\'s world, a divergence between what different actors tell us, or evidence we could gather first hand that is not public. Never a summary of the reader\'s own market; they know it better than we do, and being told is what makes an email preachy.</p></div>',
'<div class="card"><h2>Hard rules that never move</h2><ul>' +
'<li>Email 90 to 130 words; InMail 60 to 90; follow-up 90 to 100. Short paragraphs with a blank line between each.</li>' +
'<li>The close for a first touch is always this exact sentence: ' + esc(CLOSE_SENTENCE) + ' Later touches never reuse it: touch 2 drops to a short, lighter ask, and touch 3 ends with a question the reader can answer with yes, no or not me.</li>' +
'<li>The field-claim rule: we hear, we are seeing and every variant may only be written when the evidence file holds that finding as verified or reported. Otherwise the idea is framed as an open question, a hypothesis to test, or a cited public signal.</li>' +
'<li>No campaign fingerprints: no two drafts in a campaign may share an opening or the same skeleton, and the scanner checks new openings against every earlier draft in the account.</li>' +
'<li>The sign-off is the configured sign-off, then the sender name on its own line. Nothing else. The sender is Sarah; never Dr Sarah.</li>' +
'<li>British spelling, straight apostrophes, no em or en dashes, and numbers always in digits (15 minutes, 3 plants, % rather than percent).</li>' +
'<li>Subject: written last, three to seven plain words naming the question, not the company.</li>' +
'<li>No banned words or stock phrases, no antithesis constructions, no sentences that build to a punchline, no flattery, no reciting the reader\'s own market back to them.</li>' +
'<li>Touch 2 sharpens the same conversation into a more precise distinction; it never opens a new topic. Touch 3 is 60 to 90 words of concrete usefulness, never a third observation. Three touches is the ceiling, then we stop.</li>' +
'</ul></div>',
'<div class="card"><h2>The enforcement machinery</h2><p>Rules drift; machinery holds. Every draft is scanned mechanically for dashes, curly quotes, banned language, antithesis patterns, crude abbreviations, a pasted profile title, a missing close and any five-word run copied from the approved examples. Violations trigger one automatic repair pass that changes only what the violations require. The repaired draft is then audited in the persona of a practice managing director and scored 0 to 100: 85 and above means it could be signed without edits; below 60 must not be sent.</p></div>',
'<div class="card"><h2>The two approved examples, register only</h2><p class="muted small">They show register, length and confidence. They do not supply language: reusing their sentences or connective phrases is a violation the scanner catches mechanically. Some of their phrases now sit on the banned list; that is deliberate, so every new draft finds its own words.</p>' +
'<h3>Example one, approved by the practice leader</h3><div class="draftbox">' + esc(EXAMPLE_ONE) + '</div>' +
'<h3>Example two, approved by the commercial lead</h3><div class="draftbox">' + esc(EXAMPLE_TWO) + '</div></div>'
  ].join('\n');
};

/* ---------- Contacts and emails ---------- */
/* ----- Read-only contacts and profiles, for read access users ----- */
function readContactsView(){
  var h = '<h1>Contacts and profiles</h1>';
  h += '<p class="muted">The contacts this studio has researched, with the profile each one earned, and the recommended role profiles from the account brief. Read access shows the people and the research; drafting, review and exports sit with the practice team.</p>';
  h += '<div class="row2" style="margin-bottom:14px;"><button class="mini primary" onclick="App.downloadIntelligence()">Download account and contact intelligence</button>' +
    '<span class="small muted">One CSV, every person this studio knows, no drafts.</span></div>';
  /* Every person the studio knows, from the shared contact list and the
     draft records, with the intelligence held on each. Drafts excluded. */
  var cards = [];
  var rows = intelligenceRows();
  /* When every contact carries the same account intelligence, it is account
     level by nature: show it once at the top rather than under each name. */
  var acctIntel = null;
  var distinct = {};
  rows.forEach(function(x){ if (x.account) distinct[x.account] = true; });
  if (Object.keys(distinct).length === 1 && rows.length > 1) acctIntel = Object.keys(distinct)[0];
  if (acctIntel) h += '<div class="card"><h2>Account intelligence</h2><p>' + esc(acctIntel) + '</p><p class="small muted">Held on every contact below and included in the download.</p></div>';
  rows.forEach(function(x){
    var stage = x.stage === 'approved' ? 'Comms approved' : x.stage === 'review' ? 'In practice review' : x.stage === 'generated' ? 'Drafted' : (x.remit || x.signals || x.account ? 'Researched' : 'Listed');
    var cls = x.stage === 'approved' ? 'green' : x.stage === 'review' ? 'blue' : 'grey';
    var c = '<div class="card"><div class="row2" style="justify-content:space-between;"><h3 style="margin:0;">' + esc(x.name) + '</h3><span class="pill ' + cls + '">' + stage + '</span></div>';
    c += '<div class="kv" style="margin-top:8px;">' +
      (x.title ? '<div class="k">Role</div><div class="v">' + esc(x.title) + '</div>' : '') +
      (x.company ? '<div class="k">Company</div><div class="v">' + esc(x.company) + '</div>' : '') +
      (x.region ? '<div class="k">Region</div><div class="v">' + esc(x.region) + '</div>' : '') +
      (x.priority ? '<div class="k">Priority</div><div class="v">' + esc(x.priority) + (x.guidance ? '. ' + esc(x.guidance) : '') + '</div>' : '') +
      (x.theme ? '<div class="k">Theme</div><div class="v">' + esc(x.theme) + '</div>' : '') +
      (x.remit ? '<div class="k">Remit in plain words</div><div class="v">' + esc(x.remit) + '</div>' : '') +
      (x.goals ? '<div class="k">Goals and pressures</div><div class="v">' + esc(x.goals) + '</div>' : '') +
      (x.account && x.account !== acctIntel ? '<div class="k">Account intelligence</div><div class="v">' + esc(x.account) + '</div>' : '') +
      (x.person ? '<div class="k">Person intelligence</div><div class="v">' + esc(x.person) + '</div>' : '') +
      '</div>';
    if (x.signals){
      c += '<h3>Signals the research found</h3><ul class="small">';
      String(x.signals).split(' | ').filter(Boolean).forEach(function(sg){ c += '<li>' + esc(sg) + '</li>'; });
      c += '</ul>';
    }
    if (x.researchedAt || x.researchedBy) c += '<p class="small muted">Researched ' + fmtDateTime(x.researchedAt) + (x.researchedBy ? ' by ' + esc(x.researchedBy) : '') + '</p>';
    c += '</div>';
    cards.push(c);
  });
  h += '<h2>Researched contacts</h2>';
  h += cards.length ? cards.join('') : '<div class="card"><p class="muted">No contact has been researched in this studio yet.</p></div>';
  /* The recommended role profiles from the account layer: the seat, what it
     owns, the pressures and the angle. The drafts stay with the practice. */
  var profs = (ACCT() && ACCT().profiles) || [];
  if (profs.length){
    h += '<h2>Recommended role profiles from the brief</h2>';
    profs.forEach(function(p){
      var wedge = ACCT().wedges && ACCT().wedges[p.wedge - 1];
      h += '<div class="card"><div class="row2" style="justify-content:space-between;"><h3 style="margin:0;">' + esc(p.role) + '</h3><span class="pill blue">Wedge ' + p.wedge + '</span></div>';
      h += '<div class="kv" style="margin-top:8px;">' +
        '<div class="k">What this seat owns</div><div class="v">' + esc(p.owns) + '</div>' +
        '<div class="k">Likely pressures</div><div class="v">' + esc(p.pressures) + '</div>' +
        (p.angle ? '<div class="k">The angle</div><div class="v">' + esc(p.angle) + '</div>' : '') +
        (p.help ? '<div class="k">How we would help</div><div class="v">' + esc(p.help) + '</div>' : '') +
        (wedge ? '<div class="k">The wedge it serves</div><div class="v">' + esc(wedge.title) + '</div>' : '') +
        '</div>';
      if (p.pains && p.pains.length){
        h += '<h3>Mapped pain points</h3><ul>';
        p.pains.forEach(function(pp){ h += '<li><b>' + esc(pp.p) + '</b> ' + esc(pp.why) + '</li>'; });
        h += '</ul>';
      }
      h += '</div>';
    });
  }
  return h;
}

PAGES.contacts = function(){
  if (!canFull(App.account)) return readContactsView();
  var due = seqDueCount();
  var tabs = [
    { id: 'profiles', label: 'Recommended profiles' },
    { id: 'list', label: 'Contact list' },
    { id: 'review', label: 'Practice review' },
    { id: 'sequences', label: 'Sequences', badge: due }
  ];
  var h = '<h1>Contacts and emails</h1><div class="tabs">';
  tabs.forEach(function(t){
    h += '<div class="tab' + (App.tab === t.id ? ' on' : '') + '" onclick="App.goTab(\'' + t.id + '\')">' + t.label + (t.badge ? '<span class="n">' + t.badge + '</span>' : '') + '</div>';
  });
  h += '</div>';
  if (App.tab === 'profiles') h += tabProfiles();
  else if (App.tab === 'list') h += tabList();
  else if (App.tab === 'review') h += tabReview();
  else h += tabSequences();
  return h;
};

/* ----- Recommended profiles tab ----- */
function tabProfiles(){
  var ps = profState();
  var edits = Store.getJSON('email_edits', {});
  var h = '<p class="muted">One role-based profile per leading wedge, each with a finished draft written to the standard. These are roles, not named individuals, until research confirms a person. Use Verify person to find and confirm the seat holder, then tailor.</p>';
  h += '<div class="row2" style="margin-bottom:10px;"><button class="mini" onclick="App.expandAllProf(true)">Expand all</button><button class="mini" onclick="App.expandAllProf(false)">Collapse all</button></div>';
  ACCT().profiles.forEach(function(p){
    var st = ps[p.id] || {};
    var wedge = ACCT().wedges[p.wedge - 1];
    var ed = edits[p.id] || {};
    var subject = ed.subject || p.subject;
    var email = ed.email || p.email;
    var inmail = ed.inmail || p.inmail;
    var name = st.person && st.person.name || '';
    var st_stage = 'Baked draft';
    var st_cls = 'grey';
    if (st.approvedId){ var arec = Central.get(st.approvedId); if (arec && arec.status === 'approved'){ st_stage = arec.sent ? 'Sent' : 'Approved'; st_cls = 'green'; } else if (arec && arec.status === 'review'){ st_stage = 'In review'; st_cls = 'blue'; } }
    var isOpen = !!st.open;
    h += '<div class="crow">';
    h += '<div class="crow-head" onclick="App.toggleProf(\'' + p.id + '\')">' +
      '<span class="caret">' + (isOpen ? 'v' : '&gt;') + '</span>' +
      '<span class="nm">' + esc(p.role) + '</span>' +
      '<span class="meta">' + esc((st.person && st.person.name) ? st.person.name : 'Role profile, person not yet verified') + '</span>' +
      touchChips('p:' + p.id) +
      '<span class="pill blue">Wedge ' + p.wedge + '</span><span class="pill ' + st_cls + '">' + st_stage + '</span></div>';
    if (!isOpen){ h += '</div>'; return; }
    h += '<div class="crow-body">';
    h += '<div class="kv" style="margin-top:10px;"><div class="k">What this seat owns</div><div class="v">' + esc(p.owns) + '</div>' +
         '<div class="k">Likely pressures</div><div class="v">' + esc(p.pressures) + '</div>' +
         (p.angle ? '<div class="k">The angle</div><div class="v">' + esc(p.angle) + '</div>' : '') +
         (p.help ? '<div class="k">How we would help</div><div class="v">' + esc(p.help) + '</div>' : '') +
         '<div class="k">The wedge it serves</div><div class="v">' + esc(wedge.title) + '</div></div>';
    if (p.pains && p.pains.length){
      h += '<h3>Mapped pain points</h3><ul>';
      p.pains.forEach(function(pp){ h += '<li><b>' + esc(pp.p) + '</b> ' + esc(pp.why) + '</li>'; });
      h += '</ul>';
    }
    if (p.profSources && p.profSources.length){
      h += '<h3>Where the facts come from</h3><ul class="small">';
      p.profSources.forEach(function(ps){ h += '<li>' + esc(ps.txt) + ' <span class="muted">(' + esc(ps.src) + ')</span></li>'; });
      h += '</ul>';
    }
    h += '<div class="row2" style="margin:8px 0;">' +
      '<input type="text" id="vp-name-' + p.id + '" placeholder="Person to verify (name or LinkedIn URL)" style="max-width:340px;" value="' + esc(name) + '">' +
      '<button class="mini" onclick="App.verifyPerson(\'' + p.id + '\')">Verify person</button>' +
      (st.evidence ? '<span class="pill green">Person researched</span>' : '') +
      '</div>';
    if (st.verifyNote) h += '<div class="banner info">' + esc(st.verifyNote) + '</div>';
    if (st.evidence) h += evidenceHtml(st.evidence);
    if (st.audit) h += meterHtml(st.audit);
    var bakedV = scanDraft({ subject: subject, email: email, inmail: inmail }, {});
    if (bakedV.length) h += '<div class="banner info">This baked draft was approved before the current language standard and keeps its original wording. Generate tailored draft rewrites it to the full standard.</div>';
    h += '<div class="subject-line">Subject: ' + esc(subject) + ' <span class="wordcount">(email ' + wordCount(email) + ' words, InMail ' + wordCount(inmail) + ' words)</span></div>';
    h += '<div class="draftbox" id="dr-em-' + p.id + '">' + esc(personalise(fullEmail(email), name)) + '</div>';
    h += '<h3>LinkedIn InMail</h3><div class="draftbox" id="dr-in-' + p.id + '">' + esc(personalise(inmail, name)) + '</div>';
    h += '<div class="row2">' +
      '<button class="mini" onclick="App.editProfileDraft(\'' + p.id + '\')">Edit</button>' +
      '<button class="mini" onclick="copyText(document.getElementById(\'dr-em-' + p.id + '\').textContent, this)">Copy email</button>' +
      '<button class="mini" onclick="copyText(document.getElementById(\'dr-in-' + p.id + '\').textContent, this)">Copy InMail</button>' +
      (st.evidence ? '<button class="mini" onclick="App.tailorProfile(\'' + p.id + '\')">Generate tailored draft</button>' : '') +
      '<button class="mini" onclick="App.writeTouch(\'p:' + p.id + '\', 1)">Generate follow-up: email 2 and InMail 2</button>' +
      '<button class="mini" onclick="App.writeTouch(\'p:' + p.id + '\', 2)">Generate final: email 3 and InMail 3</button>' +
      '<button class="mini" onclick="App.reviewProfile(\'' + p.id + '\')">Send to practice review</button>' +
      '<button class="mini primary" onclick="App.approveProfile(\'' + p.id + '\')">Approve and store</button>' +
      '</div>';
    var pseq = (st.seq && st.seq.touches) || [];
    [1, 2].forEach(function(ti){
      var t = pseq[ti];
      if (t && (t.body || t.inmail)){
        h += '<h3>Touch ' + (ti + 1) + (ti === 2 ? ', final' : ', follow-up') + ': ' + esc(t.subject || '') + '</h3>';
        if (t.body) h += '<p class="small muted" style="margin:6px 0 2px 0;"><b>Email version</b></p><div class="draftbox" id="pt-' + p.id + '-' + ti + '">' + esc(fullEmail(t.body)) + '</div>';
        if (t.inmail) h += '<p class="small muted" style="margin:6px 0 2px 0;"><b>InMail version</b></p><div class="draftbox" id="pt-' + p.id + '-' + ti + '-in">' + esc(t.inmail) + '</div>';
        h += '<div class="row2">' +
          (t.body ? '<button class="mini" onclick="copyText(document.getElementById(\'pt-' + p.id + '-' + ti + '\').textContent, this)">Copy email</button>' : '') +
          (t.inmail ? '<button class="mini" onclick="copyText(document.getElementById(\'pt-' + p.id + '-' + ti + '-in\').textContent, this)">Copy InMail</button>' : '') +
          '</div>';
      }
    });
    if (st.editOpen){
      h += '<div style="margin-top:10px;">' +
        '<label class="f">Subject</label><input type="text" id="ed-su-' + p.id + '" value="' + esc(subject) + '">' +
        '<label class="f">Email (the sign-off is added automatically)</label><textarea id="ed-em-' + p.id + '" rows="9">' + esc(email) + '</textarea>' +
        '<label class="f">InMail</label><textarea id="ed-in-' + p.id + '" rows="6">' + esc(inmail) + '</textarea>' +
        '<div class="row2" style="margin-top:8px;"><button class="mini primary" onclick="App.saveProfileEdit(\'' + p.id + '\')">Save edit</button><button class="mini" onclick="App.cancelProfileEdit(\'' + p.id + '\')">Cancel</button></div></div>';
    }
    if (st.busy) h += '<div class="banner info" style="margin-top:10px;">' + esc(st.busy) + '</div>';
    if (st.error) h += '<div class="banner err" style="margin-top:10px;">' + esc(st.error) + '</div>';
    h += '</div></div>';
  });
  return h;
}

App.toggleProf = function(pid){ var ps = profState(); ps[pid] = ps[pid] || {}; ps[pid].open = !ps[pid].open; saveProfState(ps); render(); };
/* Screen state only above; data changes below carry the pid so they sync. */
App.expandAllProf = function(v){ var ps = profState(); ACCT().profiles.forEach(function(p){ ps[p.id] = ps[p.id] || {}; ps[p.id].open = v; }); saveProfState(ps); render(); };
App.reviewProfile = function(pid){
  var ps = profState(); var st = ps[pid] = ps[pid] || {};
  var edits = Store.getJSON('email_edits', {});
  var p = ACCT().profiles.filter(function(x){ return x.id === pid; })[0];
  var ed = edits[pid] || {};
  var name = (st.person && st.person.name) || p.role;
  var rec = Central.record({
    contact: name, title: p.role, company: ACCT().company,
    subject: ed.subject || p.subject,
    body: personalise(ed.email || p.email, st.person && st.person.name),
    inmail: personalise(ed.inmail || p.inmail, st.person && st.person.name),
    source: 'recommended profile', status: 'review'
  });
  st.approvedId = rec.id; saveProfState(ps, [pid]);
  Log.add('edit', 'sent to practice review: ' + name);
  render();
};
App.editProfileDraft = function(pid){ var ps = profState(); ps[pid] = ps[pid] || {}; ps[pid].editOpen = true; saveProfState(ps); render(); };
App.cancelProfileEdit = function(pid){ var ps = profState(); ps[pid] = ps[pid] || {}; ps[pid].editOpen = false; saveProfState(ps); render(); };
App.saveProfileEdit = function(pid){
  var edits = profEdits();
  edits[pid] = {
    subject: document.getElementById('ed-su-' + pid).value,
    email: document.getElementById('ed-em-' + pid).value,
    inmail: document.getElementById('ed-in-' + pid).value,
    editedBy: App.user, editedAt: nowIso()
  };
  saveProfEdits(edits);
  var ps = profState(); ps[pid] = ps[pid] || {}; ps[pid].editOpen = false; saveProfState(ps);
  Log.add('edit', 'profile draft ' + pid);
  render();
};

App.verifyPerson = function(pid){
  var input = document.getElementById('vp-name-' + pid).value.trim();
  if (!input) return;
  var ps = profState(); ps[pid] = ps[pid] || {};
  ps[pid].busy = 'Researching the person. This uses web search and can take a minute.';
  ps[pid].error = ''; saveProfState(ps); render();
  var p = ACCT().profiles.filter(function(x){ return x.id === pid; })[0];
  var contact = { name: input.indexOf('linkedin.com') >= 0 ? '' : input, linkedin: input.indexOf('linkedin.com') >= 0 ? input : '', company: 'Ecolab', title: p.role };
  pdlEnrich(contact).then(function(pdl){
    return runResearch(contact).then(function(ev){
      var ps2 = profState(); ps2[pid] = ps2[pid] || {};
      ps2[pid].busy = '';
      ps2[pid].person = { name: contact.name || (ev && ev.linkedin_url) || input };
      ps2[pid].evidence = ev;
      ps2[pid].verifyNote = pdl ? ('People Data Labs confirms the title as: ' + pdl.title + (pdl.location ? ' (' + pdl.location + ')' : '') + '.') : '';
      saveProfState(ps2, [pid]);
      Log.add('research', 'verify person for ' + pid + ': ' + input);
      render();
    });
  }).catch(function(e){
    var ps2 = profState(); ps2[pid] = ps2[pid] || {}; ps2[pid].busy = ''; ps2[pid].error = e.message; saveProfState(ps2); render();
  });
};

App.tailorProfile = function(pid){
  var ps = profState(); var st = ps[pid] = ps[pid] || {};
  st.busy = 'Writing a tailored draft under the full standard.'; st.error = ''; saveProfState(ps); render();
  var p = ACCT().profiles.filter(function(x){ return x.id === pid; })[0];
  var wedge = ACCT().wedges[p.wedge - 1];
  var contact = { name: (st.person && st.person.name) || p.role, title: p.role, company: 'Ecolab' };
  var ctx = 'This person holds the seat: ' + p.role + '. The wedge: ' + wedge.title + '. Decision: ' + wedge.decision + ' What we would find out: ' + wedge.findOut;
  generateDraft('first', contact, st.evidence, ctx, false, null, 'recommended profile')
    .then(function(res){
      var ps2 = profState(); var st2 = ps2[pid] = ps2[pid] || {};
      st2.busy = '';
      if (res.leave){ st2.error = 'The writer declined: ' + res.reason + ' Use Edit if you still want to adjust the baked draft.'; saveProfState(ps2); render(); return; }
      var edits = profEdits();
      edits[pid] = { subject: res.draft.subject, email: res.draft.email, inmail: res.draft.inmail, editedBy: App.user, editedAt: nowIso() };
      saveProfEdits(edits);
      st2.lastRecordId = res.record.id;
      saveProfState(ps2, [pid]);
      runAudit(st2.evidence, res.draft).then(function(a){
        var ps3 = profState(); ps3[pid].audit = a; saveProfState(ps3, [pid]); render();
      }).catch(function(){ render(); });
    })
    .catch(function(e){ var ps2 = profState(); ps2[pid].busy = ''; ps2[pid].error = e.message; saveProfState(ps2); render(); });
};

App.approveProfile = function(pid){
  var ps = profState(); var st = ps[pid] = ps[pid] || {};
  var edits = Store.getJSON('email_edits', {});
  var p = ACCT().profiles.filter(function(x){ return x.id === pid; })[0];
  var ed = edits[pid] || {};
  var name = (st.person && st.person.name) || p.role;
  var rec = Central.record({
    contact: name, title: p.role, company: 'Ecolab',
    subject: ed.subject || p.subject,
    body: personalise(ed.email || p.email, st.person && st.person.name),
    inmail: personalise(ed.inmail || p.inmail, st.person && st.person.name),
    source: 'recommended profile', status: 'review',
    profile: st.evidence ? { region: (st.evidence.region && st.evidence.region.value) || '', remit: (st.evidence.remit && st.evidence.remit.summary) || '', signals: '' } : {}
  });
  Central.approve(rec.id);
  st.approvedId = rec.id; saveProfState(ps, [pid]);
  Log.add('approve', name + ' (recommended profile)');
  render();
};

/* ----- Evidence and meter rendering ----- */
function evidenceHtml(ev){
  if (!ev) return '';
  function tag(c){ c = (c || 'unknown').toLowerCase(); return '<span class="tag ' + (['verified','reported','inferred'].indexOf(c) >= 0 ? c : 'unknown') + '">' + esc(c) + '</span>'; }
  var h = '<div class="card ev" style="background:#fafafa;"><h3>Evidence file</h3><div class="kv">';
  h += '<div class="k">Status</div><div class="v">' + esc(ev.status || 'uncertain') + (ev.current_employer ? ' at ' + esc(ev.current_employer) : '') + '</div>';
  if (ev.title_plain) h += '<div class="k">Role, in plain English</div><div class="v">' + esc(ev.title_plain) + '</div>';
  if (ev.business_unit) h += '<div class="k">Business unit</div><div class="v">' + esc(ev.business_unit) + '</div>';
  if (ev.location) h += '<div class="k">Location</div><div class="v">' + esc((ev.location.city || '') + (ev.location.country ? ', ' + ev.location.country : '')) + '</div>';
  if (ev.region) h += '<div class="k">Region</div><div class="v">' + esc(ev.region.value || 'unknown') + tag(ev.region.confidence) + '</div>';
  if (ev.remit) h += '<div class="k">Remit</div><div class="v">' + esc(ev.remit.summary || '') + tag(ev.remit.confidence) + '</div>';
  if (ev.goals) h += '<div class="k">Goals they are chasing</div><div class="v">' + esc(ev.goals.summary || ev.goals) + (ev.goals.confidence ? tag(ev.goals.confidence) : '') + '</div>';
  if (ev.summary) h += '<div class="k">Summary</div><div class="v">' + esc(ev.summary) + '</div>';
  if (ev.relevance) h += '<div class="k">Fit</div><div class="v">' + esc(ev.relevance.fit || '') + '. ' + esc(ev.relevance.reason || '') + '</div>';
  h += '</div>';
  if (ev.signals && ev.signals.length){
    h += '<h3>Signals</h3><ul>';
    ev.signals.forEach(function(s){ h += '<li>' + esc(s.text) + tag(s.confidence) + (s.source ? ' <span class="muted small">(' + esc(s.source) + (s.recency ? ', ' + esc(s.recency) : '') + ')</span>' : '') + (s.wedge_fit ? '<br><span class="small"><b>Maps to:</b> ' + esc(s.wedge_fit) + '</span>' : '') + '</li>'; });
    h += '</ul>';
  }
  if (ev.red_flags && ev.red_flags.length) h += '<div class="banner warn">Red flags: ' + esc(ev.red_flags.join('; ')) + '</div>';
  if (ev.note) h += '<p class="muted small">' + esc(ev.note) + '</p>';
  h += '</div>';
  return h;
}
function meterHtml(a){
  if (!a) return '';
  var cls = a.score >= 85 ? 'g' : a.score >= 60 ? 'a' : 'r';
  var h = '<div class="card meter" style="background:#fafafa;"><h3>Confidence to send: ' + a.score + ' / 100, ' + esc(a.band) + '</h3>';
  h += '<div class="bar"><div class="fill ' + cls + '" style="width:' + Math.max(3, Math.min(100, a.score)) + '%;"></div></div>';
  (a.checks || []).forEach(function(c){
    var ic = c.result === 'pass' ? '<span class="ic pass">PASS</span>' : c.result === 'fail' ? '<span class="ic fail">FAIL</span>' : '<span class="ic na">n/a</span>';
    h += '<div class="check-line">' + ic + '<span><b>' + esc(c.name) + '.</b> ' + esc(c.note || '') + '</span></div>';
  });
  if (a.issues && a.issues.length) h += '<p style="margin-top:8px;"><b>Open issues:</b> ' + esc(a.issues.join('; ')) + '</p>';
  if (a.fixes && a.fixes.length) h += '<p><b>Fastest fixes:</b> ' + esc(a.fixes.join('; ')) + '</p>';
  h += '</div>';
  return h;
}

/* ----- Contact list tab ----- */
function draftRecFor(c){ return c.draftId ? Central.get(c.draftId) : null; }
function contactStage(c){
  var rec = draftRecFor(c);
  if (rec && rec.sent) return 'Sent';
  if (rec && rec.status === 'approved') return 'Approved';
  if (rec && rec.status === 'review') return 'In review';
  if (c.draft && c.draft.subject) return 'Drafted';
  if (c.evidence) return 'Researched';
  if (c.leave) return 'Declined';
  return 'New';
}
function stagePill(stage){
  var cls = { 'Sent': 'green', 'Approved': 'green', 'In review': 'blue', 'Drafted': 'grey', 'Researched': 'grey', 'Declined': 'amber', 'New': 'grey' }[stage] || 'grey';
  return '<span class="pill ' + cls + '">' + stage + '</span>';
}
function touchChips(entKey){
  var ent = seqEntities().filter(function(e){ return e.key === entKey; })[0];
  if (!ent) return '';
  var h = '';
  for (var i = 0; i < ent.plan.length; i++){
    var t = ent.seq.touches && ent.seq.touches[i];
    var done = (i === 0) ? !!(firstDraftFor(ent) && firstDraftFor(ent).subject) : !!(t && (t.body || t.inmail));
    var sent = t && t.sentDate;
    h += '<span class="chip" style="' + (sent ? 'background:#000000;color:#ffffff;border-color:#000000;' : done ? '' : 'opacity:0.4;') + '">T' + (i + 1) + (sent ? ' sent' : done ? '' : ' -') + '</span>';
  }
  return h;
}
function oldNewTag(c){
  return c.old ? '<span class="pill blue">Old</span>' : '<span class="pill amber">New</span>';
}
function stageStrip(counts, label){
  var order = ['New','Researched','Drafted','In review','Approved','Sent','Declined'];
  var h = '<div class="card" style="padding:12px 18px;"><div class="row2" style="gap:18px;">';
  h += '<b class="small">' + label + '</b>';
  order.forEach(function(k){
    if (counts[k]) h += '<span class="small">' + stagePill(k) + ' ' + counts[k] + '</span>';
  });
  h += '</div></div>';
  return h;
}
function matchExistingRecord(name, email){
  var nm = String(name || '').trim().toLowerCase();
  var em = String(email || '').trim().toLowerCase();
  var recs = Central.all().filter(function(r){
    return !r.deleted && r.account === App.account && (r.status === 'review' || r.status === 'approved');
  });
  for (var i = recs.length - 1; i >= 0; i--){
    if (nm && String(recs[i].contact || '').trim().toLowerCase() === nm) return recs[i];
  }
  return null;
}
function tabList(){
  var list = contacts();
  var counts = {};
  list.forEach(function(c){ var st = contactStage(c); counts[st] = (counts[st] || 0) + 1; });
  var h = '<p class="muted">' + (canUploadContacts()
    ? 'Upload a CSV (a name column is required; title, company, email, LinkedIn and unit are used when present), download the template, or add one contact at a time. Uploaded names are checked against Practice review and Approved emails: matches arrive tagged Old with their earlier comms attached, ready to reuse or regenerate.'
    : 'Add one contact at a time. CSV uploads are reserved for the super admin; ask them to load a batch.') + '</p>';
  h += sharedHeaderHtml();
  if (list.length) h += stageStrip(counts, list.length + ' contact' + (list.length === 1 ? '' : 's'));
  if (App.uploadNote){ h += '<div class="banner info">' + esc(App.uploadNote) + '</div>'; }
  h += '<div class="batchbar">' +
    (canUploadContacts()
      ? '<input type="file" id="csv-file" accept=".csv" style="display:none;" onchange="App.csvUpload(this)">' +
        '<button class="mini" onclick="document.getElementById(\'csv-file\').click()">Upload CSV</button>' +
        '<button class="mini" onclick="App.csvTemplate()">Template</button>'
      : '') +
    '<button class="mini" onclick="App.addContactOpen()">Add contact</button>' +
    '<span style="flex:1;"></span>' +
    '<button class="mini" onclick="App.selectAll(true)">Select all</button>' +
    '<button class="mini" onclick="App.selectAll(false)">Clear</button>' +
    '<button class="mini" onclick="App.expandAll(true)">Expand all</button>' +
    '<button class="mini" onclick="App.expandAll(false)">Collapse all</button>' +
    '</div>';
  h += '<div class="batchbar"><b class="small" style="margin-right:4px;">Run on selected:</b>' +
    '<button class="mini" onclick="App.batchRun(\'research\')">Verify titles and research</button>' +
    '<button class="mini" onclick="App.batchRun(\'t1\')">Write touch 1</button>' +
    '<button class="mini" onclick="App.batchRun(\'t2\')">Write touch 2</button>' +
    '<button class="mini" onclick="App.batchRun(\'t3\')">Write touch 3</button>' +
    '<button class="mini" onclick="App.batchStatus(\'review\')">Send to practice review</button>' +
    '<button class="mini" onclick="App.batchStatus(\'approved\')">Approve</button>' +
    '<button class="mini danger" onclick="App.deleteSelected()">Delete</button>' +
    '</div>';
  if (App.addOpen){
    h += '<div class="card"><h3>Add a contact</h3><div class="row2">' +
      '<input type="text" id="nc-name" placeholder="Name (required)" style="max-width:200px;">' +
      '<input type="text" id="nc-title" placeholder="Title" style="max-width:220px;">' +
      '<input type="text" id="nc-unit" placeholder="Division / unit" style="max-width:180px;">' +
      '<input type="text" id="nc-email" placeholder="Email" style="max-width:200px;">' +
      '<input type="text" id="nc-li" placeholder="LinkedIn URL" style="max-width:220px;">' +
      '<button class="mini primary" onclick="App.addContact()">Add</button></div></div>';
  }
  if (!list.length) h += '<div class="card"><p class="muted">No contacts yet. Upload a CSV or add a contact and it will appear here as an expandable row with research, audit and drafting controls.</p></div>';
  list.forEach(function(c){ h += contactRowHtml(c); });
  return h;
}
function draftActionsHtml(idPrefix, entKey, opts){
  /* The uniform action row every draft carries: edit, assistant with a
     variant selector, independent touch generation, review and approve. */
  var h = '<div class="row2" style="margin-top:8px;">' + (opts.buttons || '') + '</div>';
  h += '<label class="f">Assistant: pick what to change, describe the change, and it rewrites within the house rules</label>' +
    '<div class="row2">' +
    '<select id="' + idPrefix + '-target" style="max-width:190px;">' +
    '<option value="0">First email and InMail</option>' +
    '<option value="1">Touch 2, follow-up</option>' +
    '<option value="2">Touch 3, final</option></select>' +
    '<input type="text" id="' + idPrefix + '-ins" placeholder="For example: make the second paragraph more specific to Iberia" style="flex:1;min-width:220px;">' +
    '<button class="mini" onclick="' + opts.assistCall + '">Apply</button>' +
    (opts.undo ? '<button class="mini" onclick="' + opts.undo + '">Undo</button>' : '') +
    '</div>';
  return h;
}
function contactTouchesHtml(c){
  var entKey = 'c:' + c.cid;
  var ent = seqEntities().filter(function(e){ return e.key === entKey; })[0];
  if (!ent || !ent.seq.touches) return '';
  var h = '';
  [1, 2].forEach(function(ti){
    var t = ent.seq.touches[ti];
    if (t && (t.body || t.inmail)){
      h += '<h3>Touch ' + (ti + 1) + (ti === 2 ? ', final' : ', follow-up') + ': ' + esc(t.subject || '') + (t.ts ? ' <span class="wordcount">generated ' + fmtDateTime(t.ts) + '</span>' : '') + '</h3>';
      if (t.body) h += '<p class="small muted" style="margin:6px 0 2px 0;"><b>Email version</b></p><div class="draftbox" id="ct-' + c.cid + '-' + ti + '">' + esc(fullEmail(t.body)) + '</div>';
      if (t.inmail) h += '<p class="small muted" style="margin:6px 0 2px 0;"><b>InMail version</b></p><div class="draftbox" id="ct-' + c.cid + '-' + ti + '-in">' + esc(t.inmail) + '</div>';
      h += '<div class="row2">' +
        (t.body ? '<button class="mini" onclick="copyText(document.getElementById(\'ct-' + c.cid + '-' + ti + '\').textContent, this)">Copy email</button>' : '') +
        (t.inmail ? '<button class="mini" onclick="copyText(document.getElementById(\'ct-' + c.cid + '-' + ti + '-in\').textContent, this)">Copy InMail</button>' : '') +
        '</div>';
    }
  });
  return h;
}
function contactRowHtml(c){
  var stage = contactStage(c);
  var h = '<div class="crow">';
  h += '<div class="crow-head" onclick="App.toggleRow(\'' + c.cid + '\')">' +
    '<input type="checkbox" ' + (c.sel ? 'checked' : '') + ' onclick="event.stopPropagation();App.toggleSel(\'' + c.cid + '\')">' +
    '<span class="caret">' + (c.open ? 'v' : '&gt;') + '</span>' +
    '<span class="nm">' + esc(c.name) + '</span>' +
    '<span class="meta">' + esc([c.title, c.unit, c.company || '', c.country].filter(Boolean).join(' | ')) + '</span>' +
    touchChips('c:' + c.cid) + oldNewTag(c) + stagePill(stage) + '</div>';
  if (c.open){
    h += '<div class="crow-body">';
    if (c.busy) h += '<div class="banner info">' + esc(c.busy) + '</div>';
    if (c.error) h += '<div class="banner err">' + esc(c.error) + '</div>';
    if (c.old) h += '<div class="banner info">This contact matched earlier work: the comms below came from Practice review or Approved emails. Regenerate any touch to refresh them; the earlier record stays in the central record.</div>';
    if (c.leave){
      h += '<div class="banner warn">The writer declined to draft: ' + esc(c.leave) + '</div>' +
        '<button class="mini" onclick="App.genContact(\'' + c.cid + '\', true)">Write email anyway</button>';
    }
    /* Section 1: research and signal mapping, with its actions beside it */
    h += '<details class="xd" ' + (c.evidence ? '' : 'open') + '><summary>Research and signal mapping</summary><div class="xd-body">';
    h += '<div class="row2" style="margin-bottom:10px;">' +
      '<button class="mini primary" onclick="App.researchContact(\'' + c.cid + '\')">' + (c.evidence ? 'Re-verify title and refresh research' : 'Verify title and research') + '</button>' +
      (c.evidence ? '<button class="mini" onclick="App.reAudit(\'' + c.cid + '\')">' + (c.audit ? 'Re-run audit' : 'Run audit') + '</button>' : '') +
      '</div>';
    if (c.pdl && c.pdl.title) h += '<div class="banner info">People Data Labs confirms the title as: ' + esc(c.pdl.title) + (c.pdl.location ? ' (' + esc(c.pdl.location) + ')' : '') + '.</div>';
    if (c.evidence) h += evidenceHtml(c.evidence);
    else h += '<p class="muted small">No research yet. Verify title and research builds the evidence file: identity, remit, goals, and signals mapped to this account\'s openings.</p>';
    if (c.audit) h += meterHtml(c.audit);
    h += '</div></details>';
    /* Section 2: outreach drafts */
    h += '<details class="xd" open><summary>Outreach drafts</summary><div class="xd-body">';
    h += '<label class="f">Context for the writer (optional)</label><textarea id="ctx-' + c.cid + '" rows="2" placeholder="Anything the practice knows that should steer this draft">' + esc(c.context || '') + '</textarea>';
    h += '<div class="row2" style="margin-top:8px;">' +
      '<button class="mini primary" onclick="App.genContact(\'' + c.cid + '\', false)">' + (c.draft ? 'Regenerate touch 1' : 'Generate touch 1: email and InMail') + '</button>' +
      '<button class="mini" onclick="App.writeTouch(\'c:' + c.cid + '\', 1)">Generate touch 2: follow-up</button>' +
      '<button class="mini" onclick="App.writeTouch(\'c:' + c.cid + '\', 2)">Generate touch 3: final</button>' +
      (c.draft ? '<button class="mini" onclick="App.saveForReview(\'' + c.cid + '\')">Send to practice review</button>' : '') +
      (c.draft ? '<button class="mini primary" onclick="App.approveContact(\'' + c.cid + '\')">Approve and store</button>' : '') +
      '</div>';
    if (c.draft && c.draft.subject){
      var rec = draftRecFor(c);
      h += '<div class="subject-line" style="margin-top:10px;">Subject: ' + esc(c.draft.subject) + ' <span class="wordcount">(email ' + wordCount(c.draft.email) + ' words' + (c.draft.inmail ? ', InMail ' + wordCount(c.draft.inmail) + ' words' : '') + (rec && rec.ts ? ', generated ' + fmtDateTime(rec.ts) : '') + ')</span> ' + provenanceHtml(rec || c) + '</div>';
      h += '<div class="draftbox" id="dc-em-' + c.cid + '">' + esc(fullEmail(c.draft.email)) + '</div>';
      if (c.draft.inmail) h += '<h3>LinkedIn InMail</h3><div class="draftbox" id="dc-in-' + c.cid + '">' + esc(c.draft.inmail) + '</div>';
      h += draftActionsHtml('as-' + c.cid, 'c:' + c.cid, {
        buttons: '<button class="mini" onclick="App.editContactDraft(\'' + c.cid + '\')">Edit manually</button>' +
          '<button class="mini" onclick="copyText(document.getElementById(\'dc-em-' + c.cid + '\').textContent, this)">Copy email</button>' +
          (c.draft.inmail ? '<button class="mini" onclick="copyText(document.getElementById(\'dc-in-' + c.cid + '\').textContent, this)">Copy InMail</button>' : ''),
        assistCall: 'App.assistContact(\'' + c.cid + '\')',
        undo: c.prevDraft ? 'App.undoContact(\'' + c.cid + '\')' : ''
      });
      if (c.editOpen){
        h += '<label class="f">Subject</label><input type="text" id="ec-su-' + c.cid + '" value="' + esc(c.draft.subject) + '">' +
          '<label class="f">Email (sign-off added automatically)</label><textarea id="ec-em-' + c.cid + '" rows="9">' + esc(c.draft.email) + '</textarea>' +
          '<label class="f">InMail</label><textarea id="ec-in-' + c.cid + '" rows="6">' + esc(c.draft.inmail || '') + '</textarea>' +
          '<div class="row2" style="margin-top:8px;"><button class="mini primary" onclick="App.saveContactEdit(\'' + c.cid + '\')">Save edit</button><button class="mini" onclick="App.cancelContactEdit(\'' + c.cid + '\')">Cancel</button></div>';
      }
      if (c.assistNote) h += '<p class="small muted" style="margin-top:6px;">' + esc(c.assistNote) + '</p>';
      h += contactTouchesHtml(c);
    }
    h += '</div></details>';
    h += '</div>';
  }
  h += '</div>';
  return h;
}
App.toggleRow = function(cid){ var c = contactById(cid); updateContact(cid, { open: !c.open }); render(); };
App.toggleSel = function(cid){ var c = contactById(cid); updateContact(cid, { sel: !c.sel }); render(); };
App.selectAll = function(v){ var l = contacts(); l.forEach(function(c){ c.sel = v; }); saveContacts(l); render(); };
App.expandAll = function(v){ var l = contacts(); l.forEach(function(c){ c.open = v; }); saveContacts(l); render(); };
App.addContactOpen = function(){ App.addOpen = !App.addOpen; render(); };
App.addContact = function(){
  var name = document.getElementById('nc-name').value.trim();
  if (!name) return;
  var l = contacts();
  var c = { cid: uid(), name: name, title: document.getElementById('nc-title').value.trim(), unit: document.getElementById('nc-unit').value.trim(), email: document.getElementById('nc-email').value.trim(), linkedin: document.getElementById('nc-li').value.trim(), company: ACCT() ? ACCT().company : '' };
  var prior = matchExistingRecord(c.name, c.email);
  if (prior){ c.old = true; c.draftId = prior.id; c.draft = { subject: prior.subject, email: prior.body, inmail: prior.inmail || '' }; }
  l.push(c);
  saveContacts(l, [c.cid]); App.addOpen = false; Log.add('edit', 'added contact ' + name + (prior ? ' (matched earlier work)' : '')); render();
};
App.csvTemplate = function(){
  download('contact-template.csv', 'name,title,company,email,linkedin,unit,city,country\nJane Example,Marketing Director,Ecolab,jane@example.com,https://www.linkedin.com/in/example,Institutional,Madrid,Spain\n', 'text/csv');
};
App.csvUpload = function(input){
  if (!canUploadContacts()){ alert('CSV uploads are reserved for the super admin.'); return; }
  var f = input.files[0]; if (!f) return;
  var reader = new FileReader();
  reader.onload = function(){
    var rows = parseCSV(String(reader.result || ''));
    if (!rows.length) return;
    var head = rows[0].map(function(x){ return x.trim().toLowerCase(); });
    var ni = head.indexOf('name');
    if (ni < 0){ alert('The CSV needs a name column. Download the template to see the expected shape.'); return; }
    function col(names, r){ for (var i = 0; i < names.length; i++){ var ix = head.indexOf(names[i]); if (ix >= 0 && r[ix]) return r[ix].trim(); } return ''; }
    var l = contacts(); var added = 0; var matched = 0; var newCids = [];
    for (var i = 1; i < rows.length; i++){
      var r = rows[i]; if (!r[ni] || !r[ni].trim()) continue;
      var c = { cid: uid(), name: r[ni].trim(), title: col(['title','designation'], r), company: col(['company'], r) || (ACCT() ? ACCT().company : ''), email: col(['email'], r), linkedin: col(['linkedin','linkedin url'], r), unit: col(['unit','division','business unit'], r), city: col(['city'], r), country: col(['country'], r), added: nowIso(), addedBy: App.user };
      newCids.push(c.cid);
      var prior = matchExistingRecord(c.name, c.email);
      if (prior){
        c.old = true;
        c.draftId = prior.id;
        c.draft = { subject: prior.subject, email: prior.body, inmail: prior.inmail || '' };
        matched++;
      }
      l.push(c); added++;
    }
    saveContacts(l, newCids);
    App.uploadNote = added + ' contact' + (added === 1 ? '' : 's') + ' uploaded. ' + (matched ? matched + ' matched earlier work in Practice review or Approved emails and arrived with their comms attached, tagged Old.' : 'None matched earlier work; all are tagged New.');
    Log.add('edit', 'uploaded ' + added + ' contacts, ' + matched + ' matched earlier work');
    render();
  };
  reader.readAsText(f);
  input.value = '';
};
App.batchRun = function(kind){
  var sel = contacts().filter(function(c){ return c.sel; });
  if (!sel.length){ alert('Select contacts first with the checkboxes.'); return; }
  var i = 0;
  function next(){
    if (i >= sel.length){ Log.add('generate', 'batch ' + kind + ' finished for ' + sel.length + ' contacts'); render(); return; }
    var c = sel[i++];
    var done = function(){ next(); };
    if (kind === 'research'){
      updateContact(c.cid, { busy: 'Verifying and researching (' + i + ' of ' + sel.length + ').' }); render();
      pdlEnrich(c).then(function(pdl){ return runResearch(c).then(function(ev){ updateContact(c.cid, { busy: '', evidence: ev, pdl: pdl || null, researchedAt: nowIso(), researchedBy: App.user }); Log.add('research', c.name); done(); }); })
        .catch(function(e){ updateContact(c.cid, { busy: '', error: e.message }); done(); });
    } else if (kind === 't1'){
      updateContact(c.cid, { busy: 'Writing touch 1 (' + i + ' of ' + sel.length + ').' }); render();
      generateDraft('first', c, c.evidence, c.context || '', false, null, 'contact list')
        .then(function(res){
          if (res.leave){ updateContact(c.cid, { busy: '', leave: res.reason }); }
          else updateContact(c.cid, { busy: '', draft: res.draft, draftId: res.record.id });
          done();
        }).catch(function(e){ updateContact(c.cid, { busy: '', error: e.message }); done(); });
    } else {
      var ti = kind === 't2' ? 1 : 2;
      App.writeTouchSilent('c:' + c.cid, ti, done);
    }
  }
  next();
};
App.researchContact = function(cid){
  var c = contactById(cid); if (!c) return;
  updateContact(cid, { busy: 'Researching. Web search and verification can take a minute.', error: '' }); render();
  pdlEnrich(c).then(function(pdl){
    return runResearch(c).then(function(ev){
      updateContact(cid, { busy: '', evidence: ev, pdl: pdl || null, researchedAt: nowIso(), researchedBy: App.user });
      Log.add('research', c.name); render();
    });
  }).catch(function(e){ updateContact(cid, { busy: '', error: e.message }); render(); });
};
App.reAudit = function(cid){
  var c = contactById(cid); if (!c || !c.draft) return;
  updateContact(cid, { busy: 'Re-running the confidence audit.', error: '' }); render();
  runAudit(c.evidence, c.draft).then(function(a){ updateContact(cid, { busy: '', audit: a }); Log.add('edit', 'audit re-run for ' + c.name); render(); })
    .catch(function(e){ updateContact(cid, { busy: '', error: e.message }); render(); });
};
App.genContact = function(cid, forced){
  var c = contactById(cid); if (!c) return;
  var ctxEl = document.getElementById('ctx-' + cid);
  var ctx = ctxEl ? ctxEl.value : (c.context || '');
  updateContact(cid, { busy: forced ? 'Writing under instruction; a second leave verdict is forbidden.' : 'Composing, scanning and repairing.', error: '', leave: '', context: ctx }); render();
  generateDraft('first', c, c.evidence, ctx, !!forced, null, 'contact list')
    .then(function(res){
      if (res.leave){ updateContact(cid, { busy: '', leave: res.reason }); render(); return; }
      updateContact(cid, { busy: '', draft: res.draft, draftId: res.record.id, prevDraft: null, assistNote: res.repaired ? 'The mechanical scan flagged issues and the repair pass fixed them automatically.' : '' });
      render();
      return runAudit(c.evidence, res.draft).then(function(a){ updateContact(cid, { audit: a }); render(); }).catch(function(){});
    })
    .catch(function(e){ updateContact(cid, { busy: '', error: e.message }); render(); });
};
App.editContactDraft = function(cid){ updateContact(cid, { editOpen: true }); render(); };
App.cancelContactEdit = function(cid){ updateContact(cid, { editOpen: false }); render(); };
App.saveContactEdit = function(cid){
  var c = contactById(cid);
  var d = { subject: document.getElementById('ec-su-' + cid).value, email: document.getElementById('ec-em-' + cid).value, inmail: document.getElementById('ec-in-' + cid).value };
  updateContact(cid, { draft: d, editOpen: false });
  if (c.draftId) Central.update(c.draftId, { subject: d.subject, body: d.email, inmail: d.inmail });
  Log.add('edit', 'draft edited for ' + c.name); render();
};
App.assistContact = function(cid){
  var c = contactById(cid); if (!c || !c.draft) return;
  var ins = document.getElementById('as-' + cid + '-ins').value.trim(); if (!ins) return;
  var target = parseInt(document.getElementById('as-' + cid + '-target').value, 10) || 0;
  updateContact(cid, { busy: 'The assistant is rewriting within the house rules.', error: '' }); render();
  if (target === 0){
    assistantRewrite(c.draft, ins).then(function(out){
      var nd = { subject: out.subject || c.draft.subject, email: out.email || c.draft.email, inmail: out.inmail || c.draft.inmail };
      updateContact(cid, { busy: '', prevDraft: c.draft, draft: nd, assistNote: out.changed || 'Changed as instructed.' });
      if (c.draftId) Central.update(c.draftId, { subject: nd.subject, body: nd.email, inmail: nd.inmail });
      Log.add('edit', 'assistant rewrite (touch 1) for ' + c.name + ': ' + ins);
      render();
    }).catch(function(e){ updateContact(cid, { busy: '', error: e.message }); render(); });
    return;
  }
  var ent = seqEntities().filter(function(e){ return e.key === 'c:' + cid; })[0];
  var t = ent && ent.seq.touches && ent.seq.touches[target];
  if (!t || (!t.body && !t.inmail)){ updateContact(cid, { busy: '', error: 'Touch ' + (target + 1) + ' has not been generated yet. Generate it first, then edit it.' }); render(); return; }
  assistantRewrite({ subject: t.subject || '', email: t.body || '', inmail: t.inmail || '' }, ins).then(function(out){
    t.subject = out.subject || t.subject; t.body = out.email || t.body; t.inmail = out.inmail || t.inmail; t.ts = nowIso();
    seqSaveEnt(ent);
    if (t.forRecord) Central.update(t.forRecord, { subject: t.subject, body: t.body, inmail: t.inmail });
    updateContact(cid, { busy: '', assistNote: 'Touch ' + (target + 1) + ': ' + (out.changed || 'changed as instructed.') });
    Log.add('edit', 'assistant rewrite (touch ' + (target + 1) + ') for ' + c.name + ': ' + ins);
    render();
  }).catch(function(e){ updateContact(cid, { busy: '', error: e.message }); render(); });
};
App.undoContact = function(cid){
  var c = contactById(cid); if (!c || !c.prevDraft) return;
  updateContact(cid, { draft: c.prevDraft, prevDraft: null, assistNote: 'Undone.' });
  if (c.draftId) Central.update(c.draftId, { subject: c.prevDraft.subject, body: c.prevDraft.email, inmail: c.prevDraft.inmail });
  Log.add('edit', 'assistant undo for ' + c.name); render();
};
App.saveForReview = function(cid){
  var c = contactById(cid); if (!c || !c.draftId) return;
  Central.update(c.draftId, { status: 'review' });
  Log.add('edit', 'saved for review: ' + c.name); render();
};
App.approveContact = function(cid, batchId){
  var c = contactById(cid); if (!c || !c.draft) return;
  var rec;
  if (c.draftId){ rec = Central.update(c.draftId, { subject: c.draft.subject, body: c.draft.email, inmail: c.draft.inmail }); }
  if (!rec){
    rec = Central.record({ contact: c.name, title: c.title || '', company: c.company || (ACCT() ? ACCT().company : ''), subject: c.draft.subject, body: c.draft.email, inmail: c.draft.inmail, source: 'contact list', status: 'review' });
    updateContact(cid, { draftId: rec.id });
  }
  Central.approve(rec.id, batchId);
  Log.add('approve', c.name); render();
};
App.researchSelected = function(){
  var sel = contacts().filter(function(c){ return c.sel; });
  if (!sel.length) return;
  var i = 0;
  function next(){
    if (i >= sel.length){ render(); return; }
    var c = sel[i++];
    updateContact(c.cid, { busy: 'Researching (' + i + ' of ' + sel.length + ').' }); render();
    pdlEnrich(c).then(function(){ return runResearch(c); })
      .then(function(ev){ updateContact(c.cid, { busy: '', evidence: ev, researchedAt: nowIso(), researchedBy: App.user }); Log.add('research', c.name); next(); })
      .catch(function(e){ updateContact(c.cid, { busy: '', error: e.message }); next(); });
  }
  next();
};
App.batchStatus = function(status){
  /* One action, one batch: everything approved together shares a batch id. */
  var batch = status === 'approved' ? Central.newBatch() : null;
  var n = 0;
  contacts().filter(function(c){ return c.sel; }).forEach(function(c){
    if (status === 'approved'){ App.approveContact(c.cid, batch); n++; }
    else if (c.draftId){ Central.update(c.draftId, { status: status }); Log.add('edit', 'saved for review: ' + c.name); }
  });
  if (batch && n) Log.add('approve', n + ' approved together as one batch');
  render();
};
App.deleteSelected = function(){
  var sel = contacts().filter(function(c){ return c.sel; });
  sel.forEach(function(c){ Log.add('delete', 'contact ' + c.name); });
  removeContacts(sel.map(function(c){ return c.cid; }));
  render();
};

/* ----- Practice review tab ----- */
function tabReview(){
  var showAll = App.reviewShowAll;
  var items = Central.all().filter(function(r){
    if (r.deleted) return false;
    if (showAll) return r.status === 'review' || r.status === 'approved';
    return r.status === 'review';
  });
  var h = '<p class="muted">Drafts saved for the practice to review before approval. Approved items remain visible but locked; manage them from Approved emails.</p>';
  h += '<div class="row2" style="margin-bottom:10px;">' +
    '<button class="mini" onclick="App.reviewShowAll=!App.reviewShowAll;render()">' + (showAll ? 'Show in-review only' : 'Show approved too') + '</button>' +
    '<button class="mini" onclick="App.reviewExport()">Export CSV for HubSpot or mail merge</button></div>';
  if (canUploadContacts()){
    h += '<div class="card"><h3>Import an earlier extraction</h3>' +
      '<p class="small muted">Rebuilds records from a CSV the studio exported earlier, including from the previous deployment: the contacts are recreated and tagged Old, the mails land in the status you choose, and follow-up touches can then be generated over them in one batch. Columns are matched by name, so the old single-studio exports and the new matrix files both work.</p>' +
      '<div class="row2">' +
      '<select id="imp-status" style="max-width:200px;"><option value="approved">Import as Approved</option><option value="review">Import as In review</option><option value="keep">Keep statuses from the file</option></select>' +
      '<input type="file" id="imp-file" accept=".csv" style="display:none;" onchange="App.importExtraction(this)">' +
      '<button class="mini primary" onclick="document.getElementById(\'imp-file\').click()">Choose the CSV and import</button></div>' +
      (App.importNote ? '<div class="banner ok" style="margin-top:10px;">' + esc(App.importNote) + '</div>' : '') +
      '</div>';
  }
  if (!items.length) h += '<div class="card"><p class="muted">Nothing is waiting for review. Use Save for practice review on any draft and it will appear here for editing and approval.</p></div>';
  items.forEach(function(r){
    var locked = r.status === 'approved';
    h += '<div class="card' + (locked ? ' grey-out' : '') + '">';
    h += '<div class="row2" style="justify-content:space-between;"><h3 style="margin:0;">' + esc(r.contact) + ' <span class="muted small">' + esc(r.title || '') + '</span></h3>' +
      '<span class="pill ' + (locked ? 'green' : 'blue') + '">' + (locked ? 'Approved, locked' : 'In review') + '</span></div>';
    h += '<p class="small muted">By ' + esc(r.author) + ', ' + fmtDateTime(r.ts) + ' | source: ' + esc(r.source || '') + (r.editedAt ? ' | ' + provenanceHtml(r) : '') + '</p>';
    if (locked){
      h += '<div class="subject-line">Subject: ' + esc(r.subject) + '</div><div class="draftbox">' + esc(fullEmail(r.body)) + '</div>';
    } else {
      h += '<label class="f">Subject</label><input type="text" id="rv-su-' + r.id + '" value="' + esc(r.subject) + '">' +
        '<label class="f">Email (sign-off added automatically)</label><textarea id="rv-em-' + r.id + '" rows="9">' + esc(r.body) + '</textarea>' +
        '<label class="f">InMail</label><textarea id="rv-in-' + r.id + '" rows="5">' + esc(r.inmail || '') + '</textarea>' +
        '<div class="row2" style="margin-top:8px;">' +
        '<button class="mini" onclick="App.reviewSave(\'' + r.id + '\')">Save</button>' +
        '<button class="mini primary" onclick="App.reviewApprove(\'' + r.id + '\')">Approve</button>' +
        '<button class="mini" onclick="App.reviewReturn(\'' + r.id + '\')">Return to drafts</button></div>';
    }
    h += '</div>';
  });
  return h;
}

/* ---------- Import an earlier extraction ---------- */
function stripSignoff(body){
  return String(body || '').replace(/\n\n(Best regards,|Thanks,|Kind regards,)\n[^\n]*\s*$/, '').trim();
}
function cleanCell(v){
  v = String(v == null ? '' : v).trim();
  return (v === 'Not generated' || v === 'not generated') ? '' : v;
}
App.importExtraction = function(input){
  if (!canUploadContacts()){ alert('CSV imports are reserved for the super admin.'); return; }
  var f = input.files[0]; if (!f) return;
  var statusChoice = document.getElementById('imp-status').value;
  var reader = new FileReader();
  reader.onload = function(){
    var rows = parseCSV(String(reader.result || ''));
    if (rows.length < 2){ alert('That CSV has no data rows.'); return; }
    var head = rows[0].map(function(x){ return x.trim().toLowerCase(); });
    function col(names, r){
      for (var i = 0; i < names.length; i++){
        var ix = head.indexOf(names[i]);
        if (ix >= 0) return cleanCell(r[ix]);
      }
      return '';
    }
    var nameIdx = ['contact name','name'].map(function(n){ return head.indexOf(n); }).filter(function(x){ return x >= 0; })[0];
    if (nameIdx == null){ alert('The CSV needs a contact name column. Use a file the studio exported.'); return; }
    var made = 0, contactsMade = 0, touches = 0;
    var l = contacts();
    var touched = []; var importBatch = null;
    for (var i = 1; i < rows.length; i++){
      var r = rows[i];
      var name = cleanCell(r[nameIdx]);
      if (!name) continue;
      var subject = col(['email subject','subject 1','subject'], r);
      var body = stripSignoff(col(['email body','email 1','body'], r));
      var inmail = col(['linkedin inmail','inmail 1','inmail'], r);
      if (!subject && !body) continue;
      var stFile = (col(['status'], r) || '').toLowerCase();
      var status = statusChoice === 'keep' ? (stFile === 'review' ? 'review' : 'approved') : statusChoice;
      var when = col(['timestamp','touch 1 generated at'], r);
      var intel = {
        region: col(['region'], r), remit: col(['remit','key roles'], r), signals: col(['key signals'], r), theme: col(['theme match','theme'], r),
        account: col(['account intelligence','account signal','account signals'], r),
        person: col(['person intelligence, verified public signal','person intelligence','person signal','personal signal'], r),
        priority: col(['priority','tier'], r), guidance: col(['send guidance'], r)
      };
      var rec = Central.record({
        contact: name,
        title: col(['role or title','designation','title'], r),
        company: col(['company'], r) || (ACCT() ? ACCT().company : ''),
        subject: subject, body: body, inmail: inmail,
        source: 'imported extraction', status: status === 'approved' ? 'review' : status,
        profile: intel
      });
      if (when) Central.update(rec.id, { ts: when, imported: nowIso() });
      else Central.update(rec.id, { imported: nowIso() });
      if (status === 'approved'){ importBatch = importBatch || Central.newBatch(); Central.approve(rec.id, importBatch); }
      made++;
      /* Recreate the contact so batches and sequences can run over it. */
      var exists = l.filter(function(c){ return c.name.trim().toLowerCase() === name.trim().toLowerCase(); })[0];
      var c;
      if (exists){ c = exists; }
      else {
        c = { cid: uid(), name: name, company: col(['company'], r) || (ACCT() ? ACCT().company : ''), added: nowIso(), addedBy: App.user };
        l.push(c); contactsMade++;
      }
      touched.push(c.cid);
      c.intel = intel;
      c.title = c.title || col(['role or title','designation','title'], r);
      c.unit = c.unit || col(['division'], r);
      c.city = c.city || col(['city'], r);
      c.country = c.country || col(['country'], r);
      c.email = c.email || col(['email'], r);
      c.linkedin = c.linkedin || col(['linkedin','linkedin url'], r);
      c.old = true;
      c.draftId = rec.id;
      c.draft = { subject: subject, email: body, inmail: inmail };
      /* Carry any exported follow-up touches back in as well. */
      var t2b = stripSignoff(col(['email 2 (follow-up)','email 2','follow-up email'], r));
      var t2i = col(['inmail 2 (follow-up)','inmail 2'], r);
      var t3b = stripSignoff(col(['email 3 (final)','email 3'], r));
      var t3i = col(['inmail 3 (final)','inmail 3'], r);
      if (t2b || t2i || t3b || t3i){
        c.seq = c.seq || { touches: [], stopped: false };
        if (t2b || t2i){ c.seq.touches[1] = { subject: col(['subject 2'], r) || ('Re: ' + subject), body: t2b, inmail: t2i, ts: col(['touch 2 generated at'], r) || nowIso() }; touches++; }
        if (t3b || t3i){ c.seq.touches[2] = { subject: col(['subject 3'], r) || ('Re: ' + subject), body: t3b, inmail: t3i, ts: col(['touch 3 generated at'], r) || nowIso() }; touches++; }
      }
    }
    saveContacts(l, touched);
    App.importNote = made + ' mail' + (made === 1 ? '' : 's') + ' imported, ' + contactsMade + ' contact' + (contactsMade === 1 ? '' : 's') + ' recreated and tagged Old' + (touches ? ', ' + touches + ' existing follow-up touches carried in' : '') + '. Open Contact list, select all, and run Write touch 2 or Write touch 3 to generate the follow-ups.';
    Log.add('edit', 'imported extraction: ' + made + ' mails, ' + contactsMade + ' contacts');
    render();
  };
  reader.readAsText(f);
  input.value = '';
};
App.reviewSave = function(id){
  Central.update(id, { subject: document.getElementById('rv-su-' + id).value, body: document.getElementById('rv-em-' + id).value, inmail: document.getElementById('rv-in-' + id).value });
  Log.add('edit', 'review edit ' + id); render();
};
App.reviewApprove = function(id){
  App.reviewSave(id);
  Central.approve(id);
  var r = Central.get(id);
  Log.add('approve', r ? r.contact : id); render();
};
App.reviewReturn = function(id){ Central.update(id, { status: 'generated' }); Log.add('edit', 'returned to drafts ' + id); render(); };
App.reviewExport = function(){
  var items = Central.all().filter(function(r){ return !r.deleted && r.account === App.account && (r.status === 'review' || r.status === 'approved'); });
  if (!items.length){ alert('Nothing is in review or approved for this account yet.'); return; }
  download(App.account + '-practice-review-matrix.csv', exportMatrix(items), 'text/csv');
  Log.add('export', 'practice review matrix CSV, ' + items.length + ' items');
};
function followupFor(r){
  /* The drafted touch 2 body, when a sequence has one. */
  var ents = seqEntities();
  for (var i = 0; i < ents.length; i++){
    var t2 = ents[i].seq.touches && ents[i].seq.touches[1];
    if (t2 && t2.forRecord === r.id && t2.body) return t2.body;
    if (ents[i].name === r.contact && t2 && t2.body) return t2.body;
  }
  return '';
}

/* ----- Sequences tab ----- */
function tabSequences(){
  var ents = seqEntities();
  var dueN = 0, overN = 0;
  ents.forEach(function(e){ var s = seqNext(e); if (s.status === 'Due now') dueN++; if (s.status.indexOf('Overdue') === 0) overN++; });
  var h = '<div class="banner info">Three touches, one week apart, then stop. Touch 2 adds, never repeats. Touch 3 changes channel where possible, adds one genuinely useful insight, and is the last word. Mark each touch sent the day it goes out; the clock and the reminders run from that. If they reply, press stop.<br><span class="small">A static page cannot send emails or push notifications on its own; this badge, this banner and the calendar export are the alert surfaces.</span></div>';
  if (dueN || overN) h += '<div class="banner warn">' + dueN + ' touch' + (dueN === 1 ? '' : 'es') + ' due today, ' + overN + ' overdue.</div>';
  h += '<div class="row2" style="margin-bottom:10px;">' +
    '<button class="mini" onclick="App.expandAllSeq(true)">Expand all</button>' +
    '<button class="mini" onclick="App.expandAllSeq(false)">Collapse all</button>' +
    '<button class="mini" onclick="download(\'ecolab-outreach-reminders.ics\', seqIcs(), \'text/calendar\');Log.add(\'export\',\'ics reminders\')">Download reminders (.ics)</button></div>';
  if (!ents.length) h += '<div class="card"><p class="muted">Sequences appear here once a contact or recommended profile has a first message. Draft an email in Contact list or Recommended profiles and its three-touch plan will be created automatically.</p></div>';
  /* Due first */
  var rows = ents.map(function(e){ return { e: e, s: seqNext(e) }; });
  rows.sort(function(a, b){
    function rank(s){ if (s.status.indexOf('Overdue') === 0) return 0; if (s.status === 'Due now') return 1; if (s.status === 'Touch 1 ready') return 2; if (s.status.indexOf('Next due') === 0) return 3; if (s.status === 'Completed') return 5; return 4; }
    return rank(a.s) - rank(b.s);
  });
  rows.forEach(function(row){
    var ent = row.e, s = row.s;
    var chipCls = s.chip === 'red' ? 'red' : s.chip === 'amber' ? 'amber' : s.chip === 'green' ? 'green' : s.chip === 'blue' ? 'blue' : 'grey';
    var planChip = ent.plan.map(function(p){ return p.channel; }).join(', ');
    var open = App.seqOpen && App.seqOpen[ent.key];
    h += '<div class="crow"><div class="crow-head" onclick="App.toggleSeq(\'' + ent.key + '\')">' +
      '<span class="caret">' + (open ? 'v' : '&gt;') + '</span>' +
      '<span class="nm">' + esc(ent.name) + '</span>' +
      '<span class="meta">' + esc(ent.title) + ' | plan: ' + esc(planChip) + ' | Touch ' + (s.sent || 0) + ' of ' + ent.plan.length + ' sent' + (s.due ? ' | next due ' + fmtDate(s.due.toISOString()) : '') + '</span>' +
      '<span class="pill ' + chipCls + '">' + esc(s.status) + '</span></div>';
    if (open){
      h += '<div class="crow-body">';
      if (!ent.seq.stopped) h += '<div class="row2" style="margin-bottom:10px;"><button class="mini danger" onclick="App.stopSeq(\'' + ent.key + '\')">Replied, stop sequence</button></div>';
      ent.plan.forEach(function(step, i){
        var t = seqTouchState(ent, i);
        h += '<div class="card" style="background:#ffffff;"><div class="row2" style="justify-content:space-between;">' +
          '<h3 style="margin:0;">Touch ' + (i + 1) + ': ' + esc(step.label) + '</h3>' +
          (t.sentDate ? '<span class="pill green">Sent ' + fmtDate(t.sentDate) + '</span>' : '') + '</div>';
        h += '<p class="small muted">' + esc(step.guide) + '</p>';
        var body = touchBody(ent, i, t);
        var inm = touchInmail(ent, i, t);
        if (body || inm){
          var bid = 'sq-' + ent.key.replace(/[^a-z0-9]/gi, '') + '-' + i;
          h += '<div class="subject-line">Subject: ' + esc(touchSubject(ent, i, t)) + '</div>';
          if (body){
            h += '<p class="small muted" style="margin:6px 0 2px 0;"><b>Email version</b></p>';
            h += '<div class="draftbox" id="' + bid + '">' + esc(fullEmail(body)) + '</div>';
          }
          if (inm){
            h += '<p class="small muted" style="margin:6px 0 2px 0;"><b>InMail version</b></p>';
            h += '<div class="draftbox" id="' + bid + '-in">' + esc(inm) + '</div>';
          }
          h += '<div class="row2">' +
            '<button class="mini" onclick="App.editTouch(\'' + ent.key + '\',' + i + ')">Edit</button>' +
            (body ? '<button class="mini" onclick="copyText(document.getElementById(\'' + bid + '\').textContent, this)">Copy email</button>' : '') +
            (inm ? '<button class="mini" onclick="copyText(document.getElementById(\'' + bid + '-in\').textContent, this)">Copy InMail</button>' : '') +
            (!t.sentDate && !ent.seq.stopped ? '<button class="mini primary" onclick="App.markTouchSent(\'' + ent.key + '\',' + i + ')">Mark sent</button>' : '') +
            '</div>';
          if (App.seqEdit === ent.key + ':' + i){
            h += '<label class="f">Subject</label><input type="text" id="tq-su" value="' + esc(touchSubject(ent, i, t)) + '">' +
              '<label class="f">Email version (sign-off added automatically)</label><textarea id="tq-bo" rows="7">' + esc(body) + '</textarea>' +
              '<label class="f">InMail version</label><textarea id="tq-in" rows="5">' + esc(inm) + '</textarea>' +
              '<div class="row2" style="margin-top:8px;"><button class="mini primary" onclick="App.saveTouch(\'' + ent.key + '\',' + i + ')">Save</button><button class="mini" onclick="App.seqEdit=null;render()">Cancel</button></div>';
          }
        } else if (!ent.seq.stopped){
          h += '<button class="mini" onclick="App.writeTouch(\'' + ent.key + '\',' + i + ')">' + touchLabelFor(i, ent.plan) + '</button>';
        }
        h += '</div>';
      });
      if (ent.seq.stopped) h += '<div class="banner info">Sequence stopped: ' + esc(ent.seq.stopReason || 'replied') + '. Nothing further will be drafted or flagged due.</div>';
      h += '</div>';
    }
    h += '</div>';
  });
  return h;
}
function firstDraftFor(ent){
  if (ent.key.indexOf('c:') === 0){ var c = ent.holder; return c.draft ? { subject: c.draft.subject, body: c.draft.email, inmail: c.draft.inmail } : null; }
  var pid = ent.key.slice(2);
  var p = ACCT().profiles.filter(function(x){ return x.id === pid; })[0];
  var ed = Store.getJSON('email_edits', {})[pid] || {};
  var nm = ent.holder.person && ent.holder.person.name;
  return { subject: ed.subject || p.subject, body: personalise(ed.email || p.email, nm), inmail: personalise(ed.inmail || p.inmail, nm) };
}
function touchSubject(ent, i, t){
  if (t && t.subject) return t.subject;
  var f = firstDraftFor(ent);
  if (!f) return '';
  if (i === 0) return f.subject;
  return 'Re: ' + f.subject;
}
function touchBody(ent, i, t){
  if (t && t.body) return t.body;
  if (i === 0){
    var f = firstDraftFor(ent);
    if (!f) return '';
    return ent.plan[0].channel === 'Email' ? f.body : (f.inmail || f.body);
  }
  return '';
}
function touchInmail(ent, i, t){
  if (t && t.inmail) return t.inmail;
  if (i === 0){
    var f = firstDraftFor(ent);
    return f ? (f.inmail || '') : '';
  }
  return '';
}
function touchLabelFor(i, plan){
  if (i === 0) return 'Write this touch';
  if (i === plan.length - 1 && plan.length === 3) return 'Write final email 3 and InMail 3';
  return 'Write follow-up email ' + (i + 1) + ' and InMail ' + (i + 1);
}
App.toggleSeq = function(key){ App.seqOpen = App.seqOpen || {}; App.seqOpen[key] = !App.seqOpen[key]; render(); };
App.expandAllSeq = function(v){ App.seqOpen = {}; if (v) seqEntities().forEach(function(e){ App.seqOpen[e.key] = true; }); render(); };
App.stopSeq = function(key){
  var ent = seqEntities().filter(function(e){ return e.key === key; })[0]; if (!ent) return;
  ent.seq.stopped = true; ent.seq.stopReason = 'replied';
  seqSaveEnt(ent);
  Log.add('edit', 'sequence stopped, replied: ' + ent.name);
  render();
};
App.markTouchSent = function(key, i){
  var ent = seqEntities().filter(function(e){ return e.key === key; })[0]; if (!ent) return;
  ent.seq.touches = ent.seq.touches || [];
  ent.seq.touches[i] = ent.seq.touches[i] || {};
  if (!ent.seq.touches[i].body){
    var t = ent.seq.touches[i];
    t.subject = touchSubject(ent, i, t); t.body = touchBody(ent, i, t);
  }
  ent.seq.touches[i].sentDate = nowIso();
  seqSaveEnt(ent);
  /* Touch 1 sent is the same flag as Sent on the approved item; the views never disagree. */
  if (i === 0){
    var recId = ent.key.indexOf('c:') === 0 ? ent.holder.draftId : ent.holder.approvedId;
    if (recId) Central.update(recId, { sent: true, sentDate: nowIso() });
  }
  Log.add('sent-mark', ent.name + ' touch ' + (i + 1));
  render();
};
App.writeTouchSilent = function(key, i, done){
  var ent = seqEntities().filter(function(e){ return e.key === key; })[0];
  if (!ent || i >= ent.plan.length){ done(); return; }
  var f = firstDraftFor(ent);
  if (!f || !f.subject){ done(); return; }
  var contact = ent.key.indexOf('c:') === 0 ? ent.holder : { name: ent.name, title: ent.title, company: ACCT() ? ACCT().company : '' };
  var kind = (i === ent.plan.length - 1 && ent.plan.length === 3) ? 'finalinsight' : 'followup';
  var prior = { subject: f.subject, body: f.body, touchNumber: i + 1, channel: ent.plan[i].channel };
  generateDraft(kind, contact, ent.holder.evidence || null, '', false, prior, 'sequence touch ' + (i + 1))
    .then(function(res){
      if (!res.leave){
        ent.seq.touches = ent.seq.touches || [];
        ent.seq.touches[i] = ent.seq.touches[i] || {};
        ent.seq.touches[i].subject = res.draft.subject;
        ent.seq.touches[i].body = res.draft.email;
        ent.seq.touches[i].inmail = res.draft.inmail || '';
        ent.seq.touches[i].ts = nowIso();
        ent.seq.touches[i].forRecord = res.record.id;
        Central.update(res.record.id, { source: 'sequence', touch: i + 1 });
        seqSaveEnt(ent);
      }
      done();
    }).catch(function(){ done(); });
};
App.editTouch = function(key, i){ App.seqEdit = key + ':' + i; render(); };
App.saveTouch = function(key, i){
  var ent = seqEntities().filter(function(e){ return e.key === key; })[0]; if (!ent) return;
  ent.seq.touches = ent.seq.touches || [];
  ent.seq.touches[i] = ent.seq.touches[i] || {};
  ent.seq.touches[i].subject = document.getElementById('tq-su').value;
  ent.seq.touches[i].body = document.getElementById('tq-bo').value;
  var tqin = document.getElementById('tq-in');
  if (tqin) ent.seq.touches[i].inmail = tqin.value;
  seqSaveEnt(ent);
  App.seqEdit = null;
  Log.add('edit', 'sequence touch edited: ' + ent.name + ' touch ' + (i + 1));
  render();
};
App.writeTouch = function(key, i){
  var ent = seqEntities().filter(function(e){ return e.key === key; })[0]; if (!ent) return;
  if (i >= ent.plan.length){ alert('This person has a two-touch LinkedIn-only plan; there is no touch ' + (i + 1) + '.'); return; }
  var f = firstDraftFor(ent);
  if (!f){ alert('Draft the first message before writing later touches.'); return; }
  App.seqBusy = key; render();
  var contact = ent.key.indexOf('c:') === 0 ? ent.holder : { name: ent.name, title: ent.title, company: 'Ecolab' };
  var evidence = ent.holder.evidence || null;
  var kind = (i === ent.plan.length - 1 && ent.plan.length === 3) ? 'finalinsight' : 'followup';
  var prior = { subject: f.subject, body: f.body, touchNumber: i + 1, channel: ent.plan[i].channel };
  generateDraft(kind, contact, evidence, '', false, prior, 'sequence touch ' + (i + 1))
    .then(function(res){
      App.seqBusy = null;
      if (res.leave){ alert('The writer declined: ' + res.reason); render(); return; }
      ent.seq.touches = ent.seq.touches || [];
      ent.seq.touches[i] = ent.seq.touches[i] || {};
      ent.seq.touches[i].subject = res.draft.subject;
      ent.seq.touches[i].body = res.draft.email;
      ent.seq.touches[i].inmail = res.draft.inmail || '';
      ent.seq.touches[i].ts = nowIso();
      ent.seq.touches[i].forRecord = res.record.id;
      Central.update(res.record.id, { source: 'sequence', touch: i + 1 });
      seqSaveEnt(ent);
      render();
    })
    .catch(function(e){ App.seqBusy = null; alert(e.message); render(); });
};

/* ---------- Approved emails ---------- */
/* ---------- Approved emails, by day and by batch ----------
   Every approval is stamped with the moment, the approver and a batch id.
   One approval action is one batch: 12 contacts approved together are one
   batch of 12, a single approve is a batch of 1. The page groups batches
   under the day they were approved, newest first, and each batch and each
   day can be downloaded on its own. */
function dayKey(iso){ return String(iso || '').slice(0, 10); }
function fmtDay(key){
  if (!key) return 'Date not recorded';
  var d = new Date(key + 'T12:00:00Z');
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function approvedGroups(){
  /* Returns [{ day, label, batches: [{ id, time, by, items }] }], newest first.
     Records approved before stamping existed fall under their creation day
     as a single batch labelled accordingly. */
  var items = approvedItems();
  var days = {};
  items.forEach(function(r){
    var when = r.approvedAt || r.ts || '';
    var dk = dayKey(when);
    var bid = r.batchId || ('legacy:' + dk);
    days[dk] = days[dk] || { day: dk, batches: {} };
    var b = days[dk].batches[bid] = days[dk].batches[bid] || { id: bid, time: r.approvedAt || '', by: r.approvedBy || '', items: [], legacy: !r.approvedAt };
    b.items.push(r);
    if (r.approvedAt && (!b.time || r.approvedAt < b.time)) b.time = r.approvedAt;
  });
  var out = Object.keys(days).sort().reverse().map(function(dk){
    var d = days[dk];
    var list = Object.keys(d.batches).map(function(k){ return d.batches[k]; })
      .sort(function(a, b){ return String(b.time) < String(a.time) ? -1 : 1; });
    /* Number the batches in the order they happened, so "batch 2 of the day"
       means the second approval of that day. */
    var chrono = list.slice().sort(function(a, b){ return String(a.time) < String(b.time) ? -1 : 1; });
    chrono.forEach(function(b, i){ b.n = i + 1; b.of = chrono.length; });
    return { day: dk, label: fmtDay(dk), batches: list, count: d.batches ? list.reduce(function(n, b){ return n + b.items.length; }, 0) : 0 };
  });
  return out;
}
function batchLabel(r){
  if (!r.batchId) return '';
  var groups = approvedGroups();
  for (var i = 0; i < groups.length; i++){
    var bs = groups[i].batches;
    for (var j = 0; j < bs.length; j++) if (bs[j].id === r.batchId) return groups[i].day + ' batch ' + bs[j].n;
  }
  return r.batchId;
}
function approvedItemHtml(r){
  var h = '<div class="ap-item' + (r.sent ? ' grey-out' : '') + '">';
  h += '<div class="row2" style="justify-content:space-between;"><h3 style="margin:0;">' + esc(r.contact) + ' <span class="muted small">' + esc(r.title || '') + '</span></h3>' +
    '<span><label class="small"><input type="checkbox" ' + (r.sent ? 'checked' : '') + ' onchange="App.markSent(\'' + r.id + '\', this.checked)"> Sent</label></span></div>';
  h += '<p class="small muted">Generated ' + fmtDateTime(r.ts) + (r.approvedAt ? '. Approved ' + fmtDateTime(r.approvedAt) + ' by ' + esc(r.approvedBy || '') : '') + '. ' +
    (r.editedAt ? 'Last edited by ' + esc(r.editedBy || '') + ' ' + fmtDateTime(r.editedAt) + '. ' : '') +
    (r.sent ? 'Sent ' + fmtDate(r.sentDate) + '. ' : '') + (r.exported ? 'Extracted ' + fmtDateTime(r.exported) + '. ' : 'Not yet extracted. ') + (r.pushed ? 'Pushed to HubSpot ' + fmtDateTime(r.pushed) + '.' : '') + '</p>';
  h += '<div class="subject-line">Subject: ' + esc(r.subject) + '</div>';
  h += '<div class="draftbox" id="ap-em-' + r.id + '">' + esc(fullEmail(r.body)) + '</div>';
  if (r.inmail) h += '<h3>LinkedIn InMail</h3><div class="draftbox" id="ap-in-' + r.id + '">' + esc(r.inmail) + '</div>';
  h += '<div class="row2"><button class="mini" onclick="copyText(document.getElementById(\'ap-em-' + r.id + '\').textContent, this)">Copy email</button>' +
    (r.inmail ? '<button class="mini" onclick="copyText(document.getElementById(\'ap-in-' + r.id + '\').textContent, this)">Copy InMail</button>' : '') + '</div>';
  h += '</div>';
  return h;
}
PAGES.approved = function(){
  var items = approvedItems();
  var fresh = items.filter(function(r){ return !r.sent && !r.exported; });
  var groups = approvedGroups();
  var h = '<h1>Approved emails</h1><p class="muted">Everything approved, held in the shared store with the moment of approval and the person who approved it. One approval action is one batch, so a day can hold several. Each batch and each day can be downloaded on its own. Marking an item sent greys it, stamps the date and starts the sequence clock.</p>';
  h += '<div class="row2" style="margin-bottom:12px;">' +
    '<button class="mini primary" onclick="App.exportApproved(\'new\')">Extract new since last extraction (' + fresh.length + ')</button>' +
    '<button class="mini" onclick="App.exportApproved(\'all\')">Extract all approved</button>' +
    '<button class="mini" onclick="App.pushHubspot()">Push to HubSpot</button></div>';
  if (App.exportNote) h += '<div class="banner info">' + esc(App.exportNote) + '</div>';
  if (!items.length) h += '<div class="card"><p class="muted">Nothing is approved yet. Approve drafts from Recommended profiles, Contact list or Practice review and they gather here by day and batch.</p></div>';
  App.batchOpen = App.batchOpen || {};
  groups.forEach(function(g, gi){
    h += '<div class="day-head"><div><h2 style="margin:0;">' + esc(g.label) + '</h2><span class="small muted">' + g.batches.length + ' batch' + (g.batches.length === 1 ? '' : 'es') + ', ' + g.count + ' email' + (g.count === 1 ? '' : 's') + '</span></div>' +
      '<button class="mini" onclick="App.downloadDay(\'' + g.day + '\')">Download this day</button></div>';
    g.batches.forEach(function(b, bi){
      var key = b.id;
      var open = (key in App.batchOpen) ? App.batchOpen[key] : (gi === 0 && bi === 0);
      var sentN = b.items.filter(function(r){ return r.sent; }).length;
      h += '<div class="card batch' + (open ? ' open' : '') + '">';
      h += '<div class="batch-head" onclick="App.toggleBatch(\'' + esc(key) + '\')">' +
        '<span class="caret">' + (open ? 'v' : '>') + '</span>' +
        '<b>' + (b.legacy ? 'Approved before stamping began' : 'Batch ' + b.n + ' of ' + b.of) + '</b>' +
        '<span class="muted small">' + (b.time ? fmtDateTime(b.time) : 'time not recorded') + (b.by ? ', approved by ' + esc(b.by) : '') + '</span>' +
        '<span class="pill grey">' + b.items.length + ' email' + (b.items.length === 1 ? '' : 's') + '</span>' +
        (sentN ? '<span class="pill grey">' + sentN + ' sent</span>' : '') +
        '<span style="flex:1;"></span>' +
        '<button class="mini" onclick="event.stopPropagation();App.downloadBatch(\'' + esc(key) + '\')">Download batch</button>' +
        '</div>';
      if (open){
        h += '<div class="batch-body">';
        b.items.forEach(function(r){ h += approvedItemHtml(r); });
        h += '</div>';
      }
      h += '</div>';
    });
  });
  var hist = ExportHist.all().filter(function(e){ return e.account === App.account; });
  if (hist.length){
    h += '<div class="card"><h2>Extraction history</h2><table class="grid"><tr><th>When</th><th>Who</th><th>What</th><th>Items</th><th></th></tr>';
    hist.slice().reverse().forEach(function(e, idx){
      var realIdx = hist.length - 1 - idx;
      h += '<tr><td class="small">' + fmtDateTime(e.ts) + '</td><td class="small">' + esc(e.actor) + '</td><td class="small">' + esc(e.kind) + '</td><td>' + e.count + '</td>' +
        '<td><button class="mini" onclick="App.redownloadExtract(\'' + e.account + '\',' + realIdx + ')">Download again</button></td></tr>';
    });
    h += '</table><p class="small muted">The last twenty extractions are kept, so an earlier batch can always be pulled again exactly as it was.</p></div>';
  }
  return h;
};
App.toggleBatch = function(key){ App.batchOpen = App.batchOpen || {}; var cur = (key in App.batchOpen) ? App.batchOpen[key] : null; App.batchOpen[key] = cur === null ? !isFirstBatch(key) : !cur; render(); };
function isFirstBatch(key){ var g = approvedGroups(); return !!(g.length && g[0].batches.length && g[0].batches[0].id === key); }
App.downloadBatch = function(key){
  var items = approvedItems().filter(function(r){ return (r.batchId || ('legacy:' + dayKey(r.ts))) === key; });
  if (!items.length) return;
  var stamp = (items[0].approvedAt || items[0].ts || nowIso()).slice(0, 16).replace('T', '-').replace(':', '');
  var csv = exportMatrix(items);
  download(App.account + '-approved-batch-' + stamp + '.csv', csv, 'text/csv');
  ExportHist.add('Approved batch of ' + fmtDateTime(items[0].approvedAt || items[0].ts), App.account, items.length, csv);
  Log.add('export', 'approved batch downloaded, ' + items.length + ' items');
  render();
};
App.downloadDay = function(day){
  var items = approvedItems().filter(function(r){ return dayKey(r.approvedAt || r.ts) === day; });
  if (!items.length) return;
  var csv = exportMatrix(items);
  download(App.account + '-approved-' + day + '.csv', csv, 'text/csv');
  ExportHist.add('Approved on ' + day, App.account, items.length, csv);
  Log.add('export', 'approved day downloaded, ' + items.length + ' items');
  render();
};
App.redownloadExtract = function(account, idx){
  var hist = ExportHist.all().filter(function(e){ return e.account === account; });
  var e = hist[idx];
  if (!e || !e.csv){ alert('That extraction is no longer stored.'); return; }
  download(account + '-extraction-' + e.ts.slice(0, 10) + '.csv', e.csv, 'text/csv');
  Log.add('export', 're-downloaded extraction of ' + fmtDateTime(e.ts));
};
App.markSent = function(id, v){
  Central.update(id, { sent: !!v, sentDate: v ? nowIso() : null });
  /* Keep the sequence view in agreement: touch 1 carries the same flag. */
  var r = Central.get(id);
  seqEntities().forEach(function(ent){
    var recId = ent.key.indexOf('c:') === 0 ? ent.holder.draftId : ent.holder.approvedId;
    if (recId === id){
      ent.seq.touches = ent.seq.touches || [];
      ent.seq.touches[0] = ent.seq.touches[0] || {};
      if (v && !ent.seq.touches[0].sentDate) ent.seq.touches[0].sentDate = nowIso();
      if (!v) ent.seq.touches[0].sentDate = null;
      seqSaveEnt(ent);
    }
  });
  Log.add('sent-mark', (r ? r.contact : id) + (v ? ' marked sent' : ' unmarked'));
  render();
};
function approvedExportRows(){
  return approvedItems().filter(function(r){ return !r.sent; });
}
App.exportApproved = function(mode){
  mode = mode || 'new';
  var items = approvedItems().filter(function(r){ return !r.sent; });
  if (mode === 'new') items = items.filter(function(r){ return !r.exported; });
  if (!items.length){
    App.exportNote = mode === 'new' ? 'Everything approved has already been extracted or marked sent. Use Extract all approved to pull the full set again.' : 'Everything approved is marked sent; unmark items to re-extract them.';
    render(); return;
  }
  var csv = exportMatrix(items);
  items.forEach(function(r){ Central.update(r.id, { exported: nowIso() }); });
  var stamp = nowIso().slice(0, 16).replace('T', '-').replace(':', '');
  download(App.account + '-outreach-' + stamp + '.csv', csv, 'text/csv');
  ExportHist.add(mode === 'new' ? 'New approvals matrix' : 'Full approved matrix', App.account, items.length, csv);
  App.exportNote = items.length + ' item' + (items.length === 1 ? '' : 's') + ' extracted with every generated touch, stamped, and saved to the extraction history.';
  render();
};
/* One matrix: prospect, profile, theme, then all six messages as generated. */
function exportMatrix(items){
  var ents = seqEntities();
  function entFor(r){
    for (var i = 0; i < ents.length; i++){
      var e = ents[i];
      var recId = e.key.indexOf('p:') === 0 ? (e.holder.approvedId || e.holder.lastRecordId) : e.holder.draftId;
      if (recId === r.id) return e;
    }
    for (var j = 0; j < ents.length; j++) if (ents[j].name === r.contact) return ents[j];
    return null;
  }
  function themeFor(r, ent){
    if (ent && ent.key.indexOf('p:') === 0){
      var pid = ent.key.slice(2);
      var p = ACCT().profiles.filter(function(x){ return x.id === pid; })[0];
      if (p && ACCT().wedges[p.wedge - 1]) return ACCT().wedges[p.wedge - 1].title;
    }
    return (r.profile && r.profile.theme) || '';
  }
  var head = ['contact name','role or title','division','company','city','country','linkedin','theme match','region','remit','key signals','confidence score','confidence band',
    'subject 1','email 1','inmail 1','subject 2','email 2 (follow-up)','inmail 2 (follow-up)','subject 3','email 3 (final)','inmail 3 (final)','author','status',
    'touch 1 generated at','touch 2 generated at','touch 3 generated at','approved at','approved by','batch','last edited by','last edited at','extracted at'];
  var lines = [head.join(',')];
  items.forEach(function(r){
    var ent = entFor(r);
    var c = contacts().filter(function(x){ return x.draftId === r.id; })[0] || {};
    var a = c.audit || {};
    var t2 = ent && ent.seq.touches && ent.seq.touches[1] || {};
    var t3 = ent && ent.seq.touches && ent.seq.touches[2] || {};
    lines.push([
      r.contact, r.title || c.title || '', c.unit || '', r.company || 'this account', c.city || '', c.country || '', c.linkedin || '',
      themeFor(r, ent),
      (r.profile && r.profile.region) || '', (r.profile && r.profile.remit) || '', (r.profile && r.profile.signals) || '',
      a.score != null ? a.score : '', a.band || '',
      r.subject, fullEmail(r.body), r.inmail || 'Not generated',
      t2.subject || 'Not generated', t2.body ? fullEmail(t2.body) : 'Not generated', t2.inmail || 'Not generated',
      t3.subject || 'Not generated', t3.body ? fullEmail(t3.body) : 'Not generated', t3.inmail || 'Not generated',
      r.author, r.status,
      r.ts, t2.ts || 'Not generated', t3.ts || 'Not generated',
      r.approvedAt || '', r.approvedBy || '', batchLabel(r), r.editedBy || '', r.editedAt || '', nowIso()
    ].map(csvCell).join(','));
  });
  return lines.join('\n');
}
App.pushHubspot = function(){
  var items = approvedItems().filter(function(r){ return !r.sent && !r.pushed; });
  if (!items.length){ App.exportNote = 'Everything approved is already pushed or marked sent; approve new items to build the next batch.'; render(); return; }
  App.exportNote = 'Pushing ' + items.length + ' contact' + (items.length === 1 ? '' : 's') + ' to HubSpot.'; render();
  hubspotPush(items).then(function(res){
    items.forEach(function(r){ Central.update(r.id, { pushed: nowIso() }); });
    ExportHist.add('HubSpot push (' + res.how + ')', App.account, items.length, exportMatrix(items));
    App.exportNote = items.length + ' contact' + (items.length === 1 ? '' : 's') + ' pushed to HubSpot with their details and all generated messages' + (res.how === 'relay' ? ' through the relay.' : ' directly.') + ' In HubSpot they are stamped Studio batch "' + batchStamp() + '", which is how to find them as one group.';
    render();
  }).catch(function(e){
    var head = ['Email','First Name','Last Name','Job Title','Company Name','City','Country','LinkedIn URL','Studio account','Studio batch','Email Subject 1','Email Body 1','InMail 1','Email Subject 2','Email Body 2','InMail 2','Email Subject 3','Email Body 3','InMail 3'];
    var lines = [head.join(',')];
    hubspotPayload(items).forEach(function(p){
      lines.push([p.properties.email, p.properties.firstname, p.properties.lastname, p.properties.jobtitle, p.properties.company, p.properties.city, p.properties.country, p.properties.linkedin_url,
        p.properties.eas_account, p.properties.eas_batch,
        p.outreach.subject1, p.outreach.email1, p.outreach.inmail1 || 'Not generated',
        p.outreach.subject2 || 'Not generated', p.outreach.email2 || 'Not generated', p.outreach.inmail2 || 'Not generated',
        p.outreach.subject3 || 'Not generated', p.outreach.email3 || 'Not generated', p.outreach.inmail3 || 'Not generated'].map(csvCell).join(','));
    });
    var csv = lines.join('\n');
    download(App.account + '-hubspot-import.csv', csv, 'text/csv');
    items.forEach(function(r){ Central.update(r.id, { pushed: nowIso() }); });
    ExportHist.add('HubSpot import file', App.account, items.length, csv);
    if (e.message === 'NO_CONFIG'){
      App.exportNote = 'No HubSpot connection is configured yet, so the studio produced the structured import file instead; import it in HubSpot under Contacts, Import. For a true one-click push, add a private app token and a relay URL in Settings; HubSpot blocks direct browser calls, so the relay (a small forwarder such as a Cloudflare Worker holding the token) is what makes direct push possible.';
    } else {
      App.exportNote = 'The direct push did not go through (' + e.message + '), which is expected when no relay is configured because HubSpot blocks browser calls. The structured import file has downloaded instead and the batch is stamped; import it in HubSpot under Contacts, Import.';
    }
    render();
  });
};

/* ---------- Assistant page ---------- */
PAGES.assistant = function(){
  var chat = Store.getJSON('assistant_chat', []);
  var h = '<h1>Assistant</h1><p class="muted">Ask about the account, the wedges, the profiles or the method. The assistant answers from the account layer and the house rules; it does not invent facts the brief does not hold.</p>';
  h += '<div class="card"><div class="chat" id="chatbox">';
  if (!chat.length) h += '<p class="muted small">No conversation yet. Ask something like: which wedge should lead for a contact in Global Water, or what is banned in a follow-up.</p>';
  chat.forEach(function(m){ h += '<div class="msg ' + (m.role === 'user' ? 'me' : 'ai') + '">' + esc(m.text) + '</div>'; });
  h += '</div>';
  h += '<div class="row2"><input type="text" id="chat-in" placeholder="Ask the assistant" style="flex:1;" onkeydown="if(event.key===\'Enter\')App.askAssistant()">' +
    '<button class="primary" onclick="App.askAssistant()">Send</button>' +
    '<button onclick="App.clearAssistant()">Clear</button></div>';
  if (App.chatBusy) h += '<p class="small muted" style="margin-top:8px;">Thinking.</p>';
  h += '</div>';
  App.afterRender = function(){ var el = document.getElementById('chatbox'); if (el) el.scrollTop = el.scrollHeight; };
  return h;
};
App.askAssistant = function(){
  var el = document.getElementById('chat-in');
  var q = (el.value || '').trim(); if (!q || App.chatBusy) return;
  var chat = Store.getJSON('assistant_chat', []);
  chat.push({ role: 'user', text: q });
  Store.setJSON('assistant_chat', chat);
  App.chatBusy = true; render();
  var sys = 'You are the account assistant inside the Ecolab Account Studio for the FutureBridge CNR practice. Answer briefly and plainly, in the register of a calm senior advisor. Use only the account context and rules below; where they are silent, say so.\n\n' + ACCT().modelContext + '\n\nWedges: ' + JSON.stringify(ACCT().wedges.map(function(w){ return { rank: w.rank, title: w.title, decision: w.decision }; })) + '\n\nHouse writing rules summary: email 90-130 words, InMail 60-90, follow-up 90-100, fixed close sentence, no banned words or phrases, never recount the reader\'s own market to them, three touches maximum.';
  var msgs = Store.getJSON('assistant_chat', []).slice(-10).map(function(m){ return { role: m.role === 'user' ? 'user' : 'assistant', content: m.text }; });
  callModel({ system: sys, messages: msgs, maxTokens: BUDGET.assistant })
    .then(function(text){
      var c2 = Store.getJSON('assistant_chat', []);
      c2.push({ role: 'ai', text: text.trim() });
      Store.setJSON('assistant_chat', c2);
      App.chatBusy = false;
      Log.add('edit', 'assistant question');
      render();
    })
    .catch(function(e){
      var c2 = Store.getJSON('assistant_chat', []);
      c2.push({ role: 'ai', text: 'That did not work: ' + e.message });
      Store.setJSON('assistant_chat', c2);
      App.chatBusy = false; render();
    });
};
App.clearAssistant = function(){ Store.setJSON('assistant_chat', []); render(); };

/* ---------- Sources and checks ---------- */
PAGES.sources = function(){
  var h = '<h1>Sources and checks</h1><p class="muted">The evidence base behind the account layer, and the rules that keep outreach honest. The source register is an audit trail, not a reading list.</p>';
  h += '<div class="card"><h2>Load-bearing claims (safe to rely on)</h2><ul>';
  ACCT().evidenceRules.loadBearing.forEach(function(x){ h += '<li>' + esc(x) + '</li>'; });
  h += '</ul></div>';
  h += '<div class="card"><h2>Never quoted in outreach</h2><ul>';
  ACCT().evidenceRules.neverQuote.forEach(function(x){ h += '<li>' + esc(x) + '</li>'; });
  h += '</ul></div>';
  h += '<div class="card"><h2>Numbers banned from outreach</h2><ul>';
  ACCT().evidenceRules.bannedNumbers.forEach(function(x){ h += '<li>' + esc(x) + '</li>'; });
  h += '</ul></div>';
  h += '<div class="card"><h2>The manual check gate</h2><p>' + esc(ACCT().checkGate || ('This overview\'s research cut-off is ' + (ACCT().briefDate || 'the brief date') + '. Before any meeting or outreach after the company\'s next results release, recheck the latest release and earnings commentary: figures, segment momentum and integration language may all have moved. The studio holds no later figures and none may be invented.')) + '</p></div>';
  h += '<div class="card"><h2>Source register</h2><table class="grid"><tr><th>ID</th><th>Source</th><th>Publisher and date</th></tr>';
  ACCT().sources.forEach(function(s){
    h += '<tr><td>' + esc(s[0]) + '</td><td><a href="' + esc(s[3]) + '" target="_blank" rel="noopener">' + esc(s[1]) + '</a></td><td>' + esc(s[2]) + '</td></tr>';
  });
  h += '</table></div>';
  return h;
};

/* ---------- Sending order ---------- */
PAGES.sending = function(){
  var ents = seqEntities().map(function(e){ return { e: e, s: seqNext(e) }; });
  function rank(s){ if (s.status.indexOf('Overdue') === 0) return 0; if (s.status === 'Due now') return 1; if (s.status === 'Touch 1 ready') return 2; if (s.status.indexOf('Next due') === 0) return 3; if (s.status === 'Completed') return 5; return 4; }
  ents.sort(function(a, b){ return rank(a.s) - rank(b.s); });
  var h = '<h1>Sending order</h1><p class="muted">What to send next, in order. Overdue touches first, then touches due today, then fresh first notes ranked by the wedge behind them. The wedge ranking follows nearness of the decision: the Spain-Italy rental evidence lane leads, then High-Tech activation, then Food and Beverage, then Life Sciences.</p>';
  if (!ents.length){
    h += '<div class="card"><p class="muted">Nothing is queued yet. Approve a draft or start a sequence and the sending order will build itself here.</p></div>';
    return h;
  }
  h += '<div class="card"><table class="grid"><tr><th>Order</th><th>Person</th><th>Next action</th><th>Channel</th><th>Status</th></tr>';
  ents.forEach(function(row, i){
    var ent = row.e, s = row.s;
    var nextLabel = s.nextIdx != null ? 'Touch ' + (s.nextIdx + 1) + ': ' + ent.plan[s.nextIdx].label : (s.status === 'Completed' ? 'Sequence complete' : 'Stopped');
    var ch = s.nextIdx != null ? ent.plan[s.nextIdx].channel : '';
    h += '<tr><td>' + (i + 1) + '</td><td><b>' + esc(ent.name) + '</b><br><span class="small muted">' + esc(ent.title) + '</span></td><td>' + esc(nextLabel) + (s.due ? '<br><span class="small muted">due ' + fmtDate(s.due.toISOString()) + '</span>' : '') + '</td><td>' + esc(ch) + '</td><td><span class="pill ' + (s.chip === 'red' ? 'red' : s.chip === 'amber' ? 'amber' : s.chip === 'green' ? 'green' : s.chip === 'blue' ? 'blue' : 'grey') + '">' + esc(s.status) + '</span></td></tr>';
  });
  h += '</table><p class="small muted">One week between touches. Nothing in this order ever compresses that interval; a fast reply simply stops the sequence.</p></div>';
  return h;
};

/* ---------- Oversight ---------- */
PAGES.oversight = function(){
  if (!isAdmin()) return '<h1>Oversight</h1><p>This page is limited to admins.</p>';
  var pf = App.ovPerson || '', sf = App.ovStatus || '', af = App.ovAcct || '';
  var list = Central.all().filter(function(r){
    if (r.deleted) return false;
    if (pf && r.contact.toLowerCase().indexOf(pf.toLowerCase()) < 0) return false;
    if (sf && r.status !== sf) return false;
    if (af && r.account !== af) return false;
    return true;
  });
  var h = '<h1>Oversight</h1><p class="muted">The central record of every draft ever generated, by every user, with status and author. A draft recorded here is never lost, even if its author closed the tab without approving.</p>';
  h += '<div class="card"><div class="row2" style="margin-bottom:10px;">' +
    '<input type="text" placeholder="Filter by person" value="' + esc(pf) + '" style="max-width:220px;" onchange="App.ovPerson=this.value;render()">' +
    '<select style="max-width:160px;" onchange="App.ovAcct=this.value;render()">' +
    '<option value="">All accounts</option>' +
    allAccounts().filter(function(a){ return a.type === 'studio'; }).map(function(a){ return '<option value="' + a.id + '"' + (af === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('') +
    '</select>' +
    '<select style="max-width:180px;" onchange="App.ovStatus=this.value;render()">' +
    '<option value="">All statuses</option>' +
    ['generated','review','approved'].map(function(s){ return '<option value="' + s + '"' + (sf === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
    '</select><span class="muted small">' + list.length + ' drafts</span></div>';
  h += '<table class="grid"><tr><th></th><th>Contact</th><th>Author</th><th>When</th><th>Source</th><th>Status</th><th></th></tr>';
  list.slice().reverse().forEach(function(r){
    var open = App.ovOpen === r.id;
    h += '<tr><td style="cursor:pointer;" onclick="App.ovOpen=App.ovOpen===\'' + r.id + '\'?null:\'' + r.id + '\';render()">' + (open ? 'v' : '&gt;') + '</td><td><b>' + esc(r.contact) + '</b><br><span class="small muted">' + esc(r.title || '') + '</span></td><td class="small">' + esc(r.author) + '</td><td class="small">' + fmtDateTime(r.ts) + '</td><td class="small">' + esc((r.account ? r.account + ' | ' : '') + (r.source || '')) + (r.touch ? ' t' + r.touch : '') + '</td><td><span class="pill ' + (r.status === 'approved' ? 'green' : r.status === 'review' ? 'blue' : 'grey') + '">' + esc(r.status) + '</span>' + (r.sent ? ' <span class="pill grey">sent</span>' : '') + '</td>' +
      '<td><button class="mini danger" onclick="App.ovDelete(\'' + r.id + '\')">Delete</button></td></tr>';
    if (open){
      h += '<tr><td></td><td colspan="6"><div class="subject-line">Subject: ' + esc(r.subject) + '</div><div class="draftbox">' + esc(fullEmail(r.body)) + '</div>' + (r.inmail ? '<div class="draftbox">' + esc(r.inmail) + '</div>' : '') + '</td></tr>';
    }
  });
  h += '</table></div>';
  if (isSuper()){
    h += '<div class="card"><h2>Action log</h2><div class="row2" style="margin-bottom:8px;">' +
      '<input type="text" placeholder="Filter by actor or action" value="' + esc(App.logFilter || '') + '" style="max-width:260px;" onchange="App.logFilter=this.value;render()">' +
      '<button class="mini" onclick="App.exportLog()">Export CSV</button></div>';
    var lf = (App.logFilter || '').toLowerCase();
    var entries = Log.all().filter(function(e){ return !lf || (e.actor + ' ' + e.action + ' ' + e.detail).toLowerCase().indexOf(lf) >= 0; });
    h += '<table class="grid"><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr>';
    entries.slice(-250).reverse().forEach(function(e){
      h += '<tr><td class="small">' + fmtDateTime(e.ts) + '</td><td class="small">' + esc(e.actor) + '</td><td class="small">' + esc(e.action) + '</td><td class="small">' + esc(e.detail) + '</td></tr>';
    });
    h += '</table></div>';
    h += '<div class="card"><h2>Shared store</h2><p class="small">' + (Cloud.on() ? 'Configured against project ' + esc(Cloud.cfg().pid) + '.' : 'Not configured; the studio is running local-only.') + ' Anyone holding the key can read and write this store; that is acceptable for internal prospecting data, and client-side sign-in in a static file is trust-level access control for a small team, not hardened security.</p>' +
      '<div class="row2"><button class="mini" onclick="App.cloudRefresh()">Refresh from shared store</button></div>' +
      (App.cloudNote ? '<div class="banner info" style="margin-top:8px;">' + esc(App.cloudNote) + '</div>' : '') + '</div>';
  }
  return h;
};
App.ovDelete = function(id){
  Central.update(id, { deleted: true });
  var r = Central.get(id);
  Log.add('delete', 'draft ' + (r ? r.contact : id));
  render();
};
App.exportLog = function(){
  var lines = ['timestamp,actor,action,detail'];
  Log.all().forEach(function(e){ lines.push([e.ts, e.actor, e.action, e.detail].map(csvCell).join(',')); });
  download('ecolab-studio-action-log.csv', lines.join('\n'), 'text/csv');
  Log.add('export', 'action log CSV');
};
App.cloudRefresh = function(){
  App.cloudNote = 'Refreshing.'; render();
  Cloud.refresh().then(function(msg){ App.cloudNote = msg; render(); });
};

/* ---------- Settings ---------- */
/* The configuration cards are shared between the studio Settings page and
   the hub settings page, so every studio, including ones created later,
   runs off the same keys, model, voice and store. Same element IDs both
   places; App.saveSettings and App.testConn work wherever they render. */
function cardModelHtml(){
  var h = '<div class="card"><h2>Model access</h2>' +
    '<p class="small muted">These keys power research, drafting, audit and repair in every account studio, current and future. Saved on this device and used by every studio you open from here.</p>' +
    '<label class="f">Anthropic API key</label><input type="password" id="st-key" value="' + esc(Store.get('anthropic_key') || '') + '" placeholder="sk-ant-...">' +
    '<label class="f">Writing model</label><select id="st-model">';
  MODELS.forEach(function(m){
    if (m.superOnly && !isSuper()) return;
    h += '<option value="' + m.id + '"' + (chosenModel() === m.id ? ' selected' : '') + '>' + m.label + '</option>';
  });
  h += '</select>' +
    '<label class="f">People Data Labs key (optional, title verification)</label><input type="password" id="st-pdl" value="' + esc(Store.get('pdl_key') || '') + '">' +
    '<label class="f">Perplexity key (optional, grounded pre-research)</label><input type="password" id="st-pplx" value="' + esc(Store.get('pplx_key') || '') + '">' +
    '<div class="row2" style="margin-top:12px;"><button class="mini" onclick="App.testConn()">Test connection</button></div>' +
    (App.connNote ? '<div class="banner info" style="margin-top:10px;">' + App.connNote + '</div>' : '') +
    '</div>';
  return h;
}
function cardHubspotHtml(){
  return '<div class="card"><h2>HubSpot</h2>' +
    '<p class="small muted">For push. HubSpot blocks direct browser calls to its API, so a relay URL (a small forwarder that holds the token, for example a Cloudflare Worker) is what enables one-click push; with a token alone the studio attempts a direct call and falls back to the structured import file. Without either, Push to HubSpot produces the import file.</p>' +
    '<label class="f">Private app token (optional)</label><input type="password" id="st-hst" value="' + esc(Store.get('hs_token') || '') + '" placeholder="pat-...">' +
    '<label class="f">Relay URL (optional)</label><input type="text" id="st-hsp" value="' + esc(Store.get('hs_proxy') || '') + '" placeholder="https://your-relay.example.workers.dev">' +
    '</div>';
}
function cardVoiceHtml(){
  return '<div class="card"><h2>Voice</h2>' +
    '<label class="f">Email sign-off</label><select id="st-signoff">' +
    ['Best regards,','Thanks,','Kind regards,'].map(function(s){ return '<option' + (signoff() === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') +
    '</select>' +
    '<label class="f">Sender name</label><input type="text" id="st-sender" value="' + esc(senderName()) + '">' +
    '</div>';
}
function cardStoreHtml(){
  return '<div class="card"><h2>Shared store (optional)</h2>' +
    '<p class="small muted">About five minutes to set up: console.firebase.google.com, add a project, Build, Firestore Database, create in test mode, choose a region, then copy the project ID and web API key from project settings into the fields below. Test-mode rules expire after roughly thirty days; replace them with: allow read, write: if true. Anyone holding the key can read and write this store, which is acceptable for internal prospecting data; client-side sign-in in a static file is trust-level access control for a small team, not hardened security. Without the keys the studio runs local-only.</p>' +
    '<label class="f">Firebase project ID</label><input type="text" id="st-fbp" value="' + esc(Store.get('fb_project') || '') + '">' +
    '<label class="f">Web API key</label><input type="password" id="st-fbk" value="' + esc(Store.get('fb_key') || '') + '">' +
    '<div class="row2" style="margin-top:10px;"><button class="mini" onclick="App.cloudRefresh()">Refresh from shared store</button></div>' +
    (App.cloudNote ? '<div class="banner info" style="margin-top:8px;">' + esc(App.cloudNote) + '</div>' : '') +
    '</div>';
}

PAGES.settings = function(){
  var full = canFull(App.account);
  var h = '<h1>Settings</h1>';
  if (isSuper()) h += '<div class="banner info">These are the same settings as Hub settings on the home screen; one set powers every studio. Saving here saves them everywhere.</div>';
  if (full) h += cardModelHtml();
  if (full) h += cardHubspotHtml();
  if (full) h += cardVoiceHtml();
  if (isSuper()) h += cardStoreHtml();
  h += '<div class="card"><h2>Identity</h2>' +
    '<p>Signed in as <b>' + esc(App.user) + '</b>.</p>' +
    '<div class="row2"><button class="mini" onclick="App.signOut()">Sign out</button></div>' +
    '<h3 style="margin-top:14px;">Change your password</h3>' +
    '<div class="row2"><input type="password" id="cp-cur" placeholder="Current password" style="max-width:200px;">' +
    '<input type="password" id="cp-new" placeholder="New password (six characters or more)" style="max-width:260px;">' +
    '<button class="mini" onclick="App.changeOwnPw()">Change</button></div>' +
    (App.pwNote ? '<div class="banner ok" style="margin-top:8px;">' + esc(App.pwNote) + '</div>' : '') +
    '<h3 style="margin-top:14px;">Your recent activity</h3><table class="grid">';
  Log.all().filter(function(e){ return e.actor === App.user; }).slice(-15).reverse().forEach(function(e){
    h += '<tr><td class="small">' + fmtDateTime(e.ts) + '</td><td class="small">' + esc(e.action) + '</td><td class="small">' + esc(e.detail) + '</td></tr>';
  });
  h += '</table></div>';
  if (full) h += '<div class="row2"><button class="primary" onclick="App.saveSettings()">Save settings</button></div>';
  return h;
};
App.changeOwnPw = function(){
  var cur = document.getElementById('cp-cur').value || '';
  var nw = document.getElementById('cp-new').value || '';
  if (!checkPassword(App.user, cur)){ App.pwNote = ''; alert('The current password is not right.'); return; }
  if (nw.length < 6){ alert('Choose a new password of at least six characters.'); return; }
  setUserPassword(App.user, nw);
  Log.add('edit', 'password changed');
  App.pwNote = 'Your password is changed.';
  render();
};
App.saveSettings = function(){
  function v(id){ var el = document.getElementById(id); return el ? el.value : null; }
  if (v('st-key') != null) Store.set('anthropic_key', v('st-key').trim());
  if (v('st-pdl') != null) Store.set('pdl_key', v('st-pdl').trim());
  if (v('st-pplx') != null) Store.set('pplx_key', v('st-pplx').trim());
  if (v('st-model') != null) Store.set('model_choice', v('st-model'));
  if (v('st-signoff') != null) Store.set('signoff', v('st-signoff'));
  if (v('st-sender') != null) Store.set('sender_name', v('st-sender').trim() || 'Sarah');
  if (v('st-hst') != null) Store.set('hs_token', v('st-hst').trim());
  if (v('st-hsp') != null) Store.set('hs_proxy', v('st-hsp').trim());
  if (v('st-fbp') != null) Store.set('fb_project', v('st-fbp').trim());
  if (v('st-fbk') != null) Store.set('fb_key', v('st-fbk').trim());
  Log.add('edit', 'settings saved');
  render(); /* Re-render so sign-off changes apply to every draft view. */
};
App.testConn = function(){
  App.connNote = 'Running the diagnostic.'; render();
  testConnection().then(function(lines){ App.connNote = lines.map(esc).join('<br>'); render(); });
};

/* ---------- Boot ---------- */
(function boot(){
  seedOwnerPasswords();
  var remembered = null;
  try { remembered = localStorage.getItem('eas_identity'); } catch(e){}
  var rec = remembered ? hubUsers()[remembered] : null;
  if (remembered && ((rec && rec.hash) || SUPER_ADMINS.indexOf(remembered) >= 0)){
    App.user = remembered;
    document.getElementById('gate').style.display = 'none';
    document.getElementById('app').classList.add('on');
    render();
    Cloud.refreshAccess().then(function(changed){ if (changed) render(); });
  }
  if (!Store.usable()){
    var sb = document.getElementById('gate-storage');
    if (sb) sb.style.display = 'block';
  }
  [['gate-email', App.signIn], ['gate-pw', App.signIn], ['gate-answer', App.answerQuestion], ['gate-newpw', App.setInitialPassword]].forEach(function(pair){
    var el = document.getElementById(pair[0]);
    if (el) el.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') pair[1](); });
  });
})();
