/* ============================================================
   BUILD. Version and changelog. Edit this on every release:
   bump the version, set the date, add one line at the top of
   notes saying what changed and which file was touched.
   ============================================================ */

var BUILD = {
  version: '2.2.0',
  date: '30 September 2026',
  notes: [
    '2.2.0, 30 September 2026. One accent treatment across the studio: the active rail item, the active tab, primary buttons and account tiles carry the red on the left edge of a light grey block. Files: index.html, build.js.',
    '2.1.0, 29 September 2026. Contact lists, research and edits are account level and sync to the shared store, with who and when on every change. Approvals stamped with time, approver and batch; Approved page grouped by day and batch. Downloads by access level. White design, light rail, full-width content. Files: core.js, ui.js, index.html.',
    '2.0.0, 24 September 2026. Split into separate files so each change touches one file. Connection moved to config.js. Added version stamp, diagnostics, backup and restore.',
    '1.9.0. Account and batch stamps written on every HubSpot push.',
    '1.8.0. Kemira studio added, built from the CNR brief of 25 August 2026.',
    '1.7.0. Hub settings carries the full configuration for every studio.',
    '1.6.0. Three access levels: super admin, admin and read.'
  ]
};
