/* ============================================================
   CONFIG. The shared-store connection, and the only file that
   holds anything environment-specific.

   UPLOAD THIS ONCE. Never replace it when a new build arrives.
   Nothing else in the studio contains these values, so every
   other file can be replaced freely without breaking the store.

   To fill it in: Firebase console, project settings, copy the
   project ID and the Web API key. The web API key is designed to
   be visible in a browser; the Firestore rules are what control
   access to the data.
   ============================================================ */

var DEFAULT_FB = {
  project: 'cnr-account-studio-hub',
  key: 'AIzaSyDd_n9s9pUnYf2jw81GF9a8M8gbXqCuAwg'
};
