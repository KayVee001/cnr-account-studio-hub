/* ============================================================
   ACCOUNT REGISTRY. Built-in full studios plus lightweight
   overview accounts created from uploaded documents.
   ============================================================ */

/* The source briefs live in docs.js. They are attached here, once every
   account layer exists, so the download works on every studio page. */
ACCOUNT_ECOLAB.doc = { name: 'Ecolab_Account_Brief_21.07.26.docx', b64: EC_DOC_B64, label: 'The original account brief of 21 July 2026, the source document behind this overview.' };
ACCOUNT_SOLENIS.doc = { name: 'Solenis_Account_Brief_16.06.2026_SH.docx', b64: SOL_DOC_B64, label: 'The original account brief of 16 June 2026, the source document behind this overview.' };
ACCOUNT_KEMIRA.doc = { name: 'Kemira_CNR_Company_Wide_Account_Brief_20260825.docx', b64: KE_DOC_B64, label: 'The official CNR company-wide account brief of 25 August 2026, the source document behind this studio.' };

var BUILTIN_ACCOUNTS = [
  { id: 'ecolab', name: 'Ecolab', practice: 'Chemicals and Natural Resources', type: 'studio', layer: ACCOUNT_ECOLAB },
  { id: 'solenis', name: 'Solenis', practice: 'Chemicals and Natural Resources', type: 'studio', layer: ACCOUNT_SOLENIS },
  { id: 'kemira', name: 'Kemira', practice: 'Chemicals and Natural Resources', type: 'studio', layer: ACCOUNT_KEMIRA }
];

function overviewAccounts(){ return Store.getJSON('hub_accounts', []); }
function saveOverviewAccounts(list){ Store.setJSON('hub_accounts', list); }
function allAccounts(){
  return BUILTIN_ACCOUNTS.concat(overviewAccounts().map(function(a){
    if (a.kind === 'studio' && a.layer){
      return { id: a.id, name: a.name, practice: a.practice || '', type: 'studio', layer: a.layer, created: a.created, author: a.author, dynamic: true };
    }
    return { id: a.id, name: a.name, practice: a.practice || '', type: 'overview', html: a.html, created: a.created, author: a.author, dynamic: true };
  }));
}
function accountById(id){
  var list = allAccounts();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function ACCT(){
  var a = accountById(App.account);
  return a && a.layer ? a.layer : null;
}
