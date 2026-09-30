# How to change the Account Studio without breaking it

Version 2.2.0, 30 September 2026.

## This release replaces 4 files, not 11

2.2.0 adds one design change to 2.1.0: the active rail item, the active tab, primary buttons and account tiles all carry the red on the left edge of a light grey block. Only `index.html` and `build.js` changed for that, and both are inside the 4 files below.

If 2.0.0 is already in the repository: replace `core.js`, `ui.js`, `index.html` and `build.js`. Leave `config.js`, `docs.js`, `standard.js` and the `accounts` folder exactly as they are. That is the protocol below working as intended: the writing rules, the 3 briefs and the 3 account layers were not part of this change, so they do not move.

If the repository still holds the old single `index.html`, follow the first upload steps further down instead.

## What 2.1.0 changes in how the studio holds data

Until now each person's contact list, research and edits lived only on their own device. A colleague opening the same studio saw an empty list. From 2.1.0 the contact list, the research on each person, the recommended profile work and every draft edit are held once per account and pushed to the shared store the moment they change. Every change carries who made it and when, and the Approved page shows who approved what, at what time, in which batch.

The shared store now holds 3 more collections beside the existing users, accounts, drafts and logs: `contacts`, `profiles` and `edits`. Nothing needs to be created in the Firebase console; the studio writes them on first use. The test-mode rule that allows reads and writes covers them.

On first opening an account under 2.1.0, anything held per person on that device is gathered into the shared copy and pushed up, so nothing already done is lost. Open each account once from the device that holds the most work, and the store is seeded.

Access levels now decide downloads as well as screens. Everyone can take the account overview and the account and contact intelligence. Only admin and super admin can take generated or approved communication, and only they can edit. Read access has no edit control anywhere and is refused the communication download even if the function is called directly.


## The studio is now 11 files, and a change touches one of them

Until now the studio was a single file of 628,000 characters. Every change, however small, meant regenerating the whole thing, and every regeneration was a chance for something you were happy with to come back different. That risk is now gone, because the parts are separate. A change to the writing rules touches a 14KB file. Everything else on the server stays exactly as it was.

| File | Size | What it holds | How often it changes |
|---|---|---|---|
| `config.js` | 0.7KB | The Firebase project ID and key | Once. Never again. |
| `build.js` | 0.9KB | Version number, date, changelog | Every release |
| `standard.js` | 14KB | The writing standard: banned words, close sentences, scanner rules, worked examples | Whenever Sarah gives feedback |
| `core.js` | 62KB | Storage, access control, the shared store and sync, model calls, scanner engine | Rarely |
| `ui.js` | 180KB | Every screen and button | When the interface changes |
| `docs.js` | 230KB | The 3 uploaded account briefs, as embedded documents | Only when a brief is replaced |
| `accounts/ecolab.js` | 54KB | Ecolab summary, wedges, sources, role profiles | Ecolab work only |
| `accounts/solenis.js` | 54KB | Solenis, the same | Solenis work only |
| `accounts/kemira.js` | 33KB | Kemira, the same | Kemira work only |
| `accounts/registry.js` | 2KB | The list of built-in studios | When an account is added |
| `index.html` | 30KB | The page shell, the stylesheet and the loader | When the look changes |

The practical consequence is that 37 per cent of the studio, the embedded briefs in `docs.js`, is now uploaded once and never touched again. Adding a Kemira wedge no longer rewrites the Ecolab account layer, so Ecolab cannot change by accident. That was the mechanism behind "something I was happy with came back different".

## Your data was never the thing at risk, but back it up anyway

Uploading a new build has never deleted your contacts, drafts or approvals. The browser keeps those under the site address, not inside the file, so replacing the file leaves them untouched. What actually went wrong was the connection: the shared-store credentials were baked into the old file, so every upload wiped them and you had to retype the project ID and key. If you forgot, the studio quietly fell back to storing everything on that one device, and colleagues saw nothing.

`config.js` fixes that permanently. Fill it in once, and never upload it again. Every other file can be replaced freely.

Even so, take a backup before each upload. Hub settings, Build and health, Back up everything. It writes one JSON file holding every contact, draft, approval, sequence, user and setting on that device. Restore from a backup puts all of it back. It takes 5 seconds and removes the last reason to be nervous about uploading.

## Replacing and activating the studio, step by step

Everything below happens in a browser: github.com, the Firebase console and the studio itself. No software is installed. Allow 20 minutes the first time and 5 minutes for any release after that.

### Before touching the repository

1. Open the live studio, sign in as super admin and look under your name in the rail. If it reads Build 2.0.0, you are on the short path below. If there is no build number, you are on the full path. Note which.
2. If a build number is showing, take a backup: Hub settings, Build and health, Back up everything. Save the JSON file somewhere you can find it. If there is no build number, there is no backup button; the data stays in the browser at the same address regardless, so continue.
3. Unzip `FutureBridge_Account_Studio_2.2.0.zip` on your computer. You should see 12 files at the top level and a folder named `accounts` holding 4 files.
4. Full path only: have the Firebase project ID and web API key to hand. Firebase console, the gear beside Project Overview, Project settings, General. The project ID is under Your project. The web API key is under Your apps, the web app, SDK setup and configuration, the line beginning `apiKey`. Both are the values that sit in the old `index.html` on the `DEFAULT_FB` line, so the old file is a second place to read them from.

### Full path: the repository still holds the single index.html

5. Open the repository on github.com. Click `index.html`, then the three dots at the top right of the file view, then Delete file, then Commit changes. Confirm.
6. Back at the repository root, click Add file, then Upload files. From the unzipped folder, drag the 12 files and the `accounts` folder together onto the upload area. Dragging the folder keeps it as a folder. Wait for every file to show a green tick, then Commit changes.
7. Check the repository root now shows `index.html`, `config.js`, `build.js`, `standard.js`, `docs.js`, `core.js`, `ui.js` and a folder `accounts` containing `ecolab.js`, `solenis.js`, `kemira.js` and `registry.js`. If the 4 account files landed at the root instead, the browser did not carry the folder: click Add file, Create new file, type `accounts/registry.js` as the name, paste the contents of that file, commit, then open the `accounts` folder and use Upload files for the other 3.
8. Click `config.js`, then the pencil. Paste the project ID between the quotes on the `project` line and the key between the quotes on the `key` line. Commit changes. This is the only time these values are ever entered.

### Short path: the repository already holds 2.0.0

5. Click Add file, then Upload files. From `FutureBridge_Account_Studio_2.2.0_changed_files_only.zip`, drag `core.js`, `ui.js`, `index.html` and `build.js` onto the upload area. Do not include `config.js`. GitHub replaces the 4 files of the same name. Commit changes.

### Wait, then confirm what is live

9. GitHub Pages republishes on its own. The Actions tab shows a run named pages build and deployment; it usually finishes within 2 minutes.
10. Open the studio address. If it still looks like the old version, the address is being served from cache: wait 10 minutes, or open it in a private window. The studio's own files carry a timestamp, so once the new `index.html` arrives nothing else needs clearing.
11. Sign in. Under your name the rail must read Build 2.2.0. If it reads an earlier build or nothing, go back to step 10.
12. Hub settings, Build and health. Shared store must read Connected. Not connected means `config.js` is still blank or has a typo. Problem means the store refused the studio, and the message beside it says why; an expired test-mode rule is the usual cause, fixed at step 16.

### Activate: seed the shared store and check it from a second device

13. From the device that holds the most work, open Ecolab, Solenis and Kemira in turn and click into Contacts and emails, Contact list, on each. The line at the top of the list should read Shared list, last synced, with a time. This is the moment 2.1.0 gathers what was held per person on this device and pushes it up. It happens once per account and takes seconds.
14. Open a private window or a second computer, sign in and open Kemira. The same contact list should be there. If it is, every colleague will see it too.
15. If the Kemira 48 CSV has not been imported yet, do it now: Contacts and emails, Practice review, the importer at the top. It arrives as one stamped batch on the Approved page with its account and person intelligence kept.

### Make the connection permanent

16. Firebase console, Build, Firestore Database, Rules. Replace the contents with the rule below and click Publish. The test-mode rule has an expiry date built into it; this one does not, so sync no longer stops for everyone on a date nobody remembers.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

This is the same open posture the studio has run on since the start, with the expiry removed, so it is not a step backwards. Tightening it to signed-in users only is a later piece of work that needs sign-in through Firebase itself.

17. Tell colleagues the address is unchanged and they only need to reload. Their sign-ins, levels and passwords are as before. Read users will notice they now see the contact list with its intelligence and a download; admins will notice the edit stamps and the Approved page by batch.
18. Keep the backup file from step 2 for a week, then it can go.

### If something is wrong

The studio says it could not finish loading and names a file: that file is missing or in the wrong place in the repository. Nothing is lost; put the file where the message says and reload.

The look is new but the data seems missing: you are almost certainly at a different address from before, or in a different browser profile. The data lives under the address, and the shared store fills the gap once step 13 has been done from the device that held it. Failing that, Restore from a backup on the Build and health card puts the device data back.

Anything else: re-upload the 4 files from the 2.0.0 zip and the studio is back to yesterday. The data is untouched either way. The 2.1.0 files can be tried again once the cause is known.

## Every upload after that is one file

Say Sarah asks for a banned phrase to be added. The change is 1 line in `standard.js`. You upload `standard.js`. Nothing else moves. `docs.js` stays where it is, all 3 account layers stay where they are, and the interface stays where it is. There is no mechanism by which Ecolab's wording could change, because the Ecolab file was not part of the transaction.

Bump the version in `build.js` and add a line to the changelog at the same time. It takes 20 seconds and it means the Build and health card always tells you what is actually live. Drift becomes visible instead of invisible.

## What the studio now tells you about itself

The build number sits under your name on every screen, so you can confirm what is live without opening the repository. Hub settings carries a Build and health card showing the version and release date, whether the shared store is genuinely connected and what it says if it is not, how many drafts are held and across which accounts, whether the browser is allowing local storage at all, and the last 5 releases. If someone reports that the studio is behaving oddly, that card answers it in one screenshot.

## Two things that will bite if left alone

The Firestore rules are in test mode and expire roughly 30 days after they were set. When they expire, sync stops for everyone at once and the studio will say so on the health card. Open the Firebase console, Firestore, Rules, and set an expiry you can live with or a permanent rule. This is worth doing before the Kemira batch goes out.

The `accounts` folder is a real folder. If the 4 account files end up beside `index.html` instead of inside it, the studio will tell you plainly that it could not finish loading and will name the file it could not find. That message is a loading problem and never a data problem, so nothing is lost. Move the files and reload.

## How to ask for a change

Name the file. "Add this phrase to the banned list in standard.js" produces a 1 line change to 1 file. "Add a banned phrase" invites a rewrite. The difference in risk is the whole point of the split.
