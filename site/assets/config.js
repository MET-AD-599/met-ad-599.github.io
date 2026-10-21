// Public settings for the static site. The Supabase URL and publishable (anon) key are meant to be
// public: the database only answers through public.app_call, which checks every request.
export const CONFIG = {
  supabaseUrl: "https://otbpljrcgicvocjbbkla.supabase.co",      // Supabase > Project Settings > API > Project URL
  supabaseKey: "sb_publishable_LtvRQRwrPdlxNxkM8HXGwQ_N2KDCXcJ",          // Supabase > Project Settings > API Keys > publishable (or legacy anon)
  course: "MET AD 599 · Python and SQL for Business Analytics",
  base: "__BASE__",                                     // set by the deploy workflow ("/ad599-app/")
  version: "__VERSION__",                               // cache-buster for templates, set by the deploy workflow
};
