// Proves the demo users can log in with RIPPLE_DEMO_PASSWORD: one user per role signs in through the normal Auth API,
// reads one page's data as that user (RLS applies), and signs out. Prints only "login ok" / "login FAILED" per role;
// never the password. Usage: node tests/ripple/demo/login-check.cjs
const D = require("./demo-lib.cjs");
const { createClient } = require("@supabase/supabase-js");
const env = require("../dev/lib.cjs");

const PAGES = {
  manager: { user: "pat.morgan", read: (c) => c.rpc("list_clients_onboarding", { _office_id: OFF }), page: "Client Care Plans" },
  agency_admin: { user: "sam.rivera", read: (c) => c.from("virtual_office").select("id").eq("id", OFF), page: "Virtual Offices" },
  hr_staff: { user: "jordan.lee", read: (c) => c.rpc("list_credential_expirations", { _office_id: OFF, _within_days: 60 }), page: "Credential expirations" },
  scheduler: { user: "casey.park", read: (c) => c.from("shifts").select("id").eq("virtual_office_id", OFF).limit(5), page: "Schedule" },
  caregiver: { user: "ana.brooks", read: (c) => c.rpc("get_caregiver_clock"), page: "Today" },
};
let OFF;

(async () => {
  if (!D.ENV_PW) { console.log("RIPPLE_DEMO_PASSWORD not set: nothing to check"); process.exitCode = 1; return; }
  [{ id: OFF }] = await D.findOffice();
  let bad = 0;
  for (const [role, p] of Object.entries(PAGES)) {
    const c = createClient(env.URL_, env.ANON, env.opts);
    const { data: s, error: e1 } = await c.auth.signInWithPassword({ email: D.email(p.user), password: D.ENV_PW });
    const { data, error: e2 } = e1 ? { error: e1 } : await p.read(c);
    const rows = Array.isArray(data) ? data.length : data ? 1 : 0;
    const { error: e3 } = e1 ? {} : await c.auth.signOut();
    const ok = !e1 && !e2 && !e3 && !!s?.session && rows > 0;
    if (!ok) bad++;
    console.log(`${role.padEnd(13)} ${ok ? "login ok" : "login FAILED"} (read: ${p.page})`);
  }
  if (bad) process.exitCode = 1;
})().catch((e) => { console.log("ERROR", e.message); process.exitCode = 1; }).finally(() => D.closeDb());
