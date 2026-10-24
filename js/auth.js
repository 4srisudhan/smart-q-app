/* Smart Q authentication (Supabase). Runs after app.js.
   With no config it stays in demo mode and the app behaves as before. */
const CFG = window.SMARTQ_CONFIG || {};
const AUTH = { sb: null, on: false, session: null, role: null, sent: false, busy: false, shopMode: "login" };
try {
  if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient) {
    AUTH.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    AUTH.on = true;
  } else if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
    console.error("Supabase settings found, but the supabase-js script did not load. Check your internet connection.");
  }
} catch (e) { console.error("Supabase setup failed", e); }

const aEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const aPhone = v => { const p = v.replace(/[\s()-]/g, ""); return /^\+\d{8,15}$/.test(p) ? p : null; };
const aVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const aMsg = e => {
  const m = String((e && e.message) || "");
  if (/rate limit|too many|security purposes/i.test(m)) return "Too many tries. Please wait a minute and try again.";
  if (/token.*(invalid|expired)|(invalid|expired).*(token|otp|code)|otp.*expired/i.test(m)) return "That code is wrong or has expired.";
  if (/invalid login/i.test(m)) return "Wrong email or password.";
  if (/already registered|already exists/i.test(m)) return "That email already has an account. Try logging in.";
  if (/sms|provider.*phone|phone.*provider/i.test(m)) return "Phone codes are not set up yet. Use your email instead.";
  return m || "Something went wrong. Please try again.";
};
const PUBLIC_SCREENS = ["splash", "welcome", "login", "shoplogin", "privacy", "terms", "help"];

function authGuard(id) {
  if (!AUTH.on) return id;
  if (!AUTH.session) return PUBLIC_SCREENS.includes(id) ? id : "welcome";
  if (AUTH.role === "shopkeeper") return ["shop", "privacy", "terms", "help", "splash"].includes(id) ? id : "shop";
  return id === "shop" ? "home" : id;
}
function startScreen() { return AUTH.session ? (AUTH.role === "shopkeeper" ? "shop" : "home") : "welcome"; }

function startResend() {
  clearInterval(timer);
  const b = document.getElementById("rs"); if (!b) return;
  let n = 45; b.disabled = true; b.textContent = "Resend in 45s";
  timer = setInterval(() => { n--; if (n > 0) b.textContent = "Resend in " + n + "s"; else { clearInterval(timer); b.textContent = "Resend code"; b.disabled = false; } }, 1000);
}

async function aProfile(id) {
  const { data, error } = await AUTH.sb.from("profiles").select("role,name,contact").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}
function clearLocal() {
  try { localStorage.removeItem("sq_profile"); localStorage.removeItem("sq_uid"); } catch (e) {}
  delete D.photo; D.contact = ""; D.joined = 1; D.completed = 0; D.hist = []; D.saved = []; D.q = "";
  D.set = { alerts: true, theme: "system", mode: "walk" }; D.sub = { status: "none", start: 0, until: 0, auto: true }; M.mode = "walk"; applyTheme();
}
function aLocal(user, prof) {
  let prev = null; try { prev = localStorage.getItem("sq_uid"); } catch (e) {}
  if (prev && prev !== user.id) clearLocal();
  try { localStorage.setItem("sq_uid", user.id); } catch (e) {}
  const fb = String(user.email || user.phone || "").split("@")[0];
  D.user = (prof && prof.name) || fb || "Guest";
  D.contact = (prof && prof.contact) || user.email || user.phone || D.contact;
  save();
}
async function aAfter(kind, session) {
  const s = session || (await AUTH.sb.auth.getSession()).data.session;
  if (!s) throw new Error("Could not sign in. Please try again.");
  AUTH.session = s;
  let prof = await aProfile(s.user.id);
  if (kind === "shopkeeper" && (!prof || prof.role !== "shopkeeper")) {
    const nm = s.user.user_metadata && s.user.user_metadata.shop_name;
    if (nm) {
      const { error } = await AUTH.sb.rpc("create_my_shop", { p_name: nm });
      if (error) throw error;
      prof = await aProfile(s.user.id);
    } else {
      await AUTH.sb.auth.signOut(); AUTH.session = null; AUTH.role = null;
      return toast("No shop account found. Tap Create shop account.");
    }
  }
  if (kind === "customer" && prof && prof.role === "shopkeeper") {
    await AUTH.sb.auth.signOut(); AUTH.session = null; AUTH.role = null;
    return toast("This is a shop account. Use the shopkeeper login.");
  }
  AUTH.role = (prof && prof.role) || "customer";
  AUTH.shopMode = "login";
  aLocal(s.user, prof);
  if (AUTH.role === "customer" && D.sub.status === "none") startTrial();
  go(AUTH.role === "shopkeeper" ? "shop" : "home");
}

async function aSend() {
  const raw = aVal("lg-contact");
  if (!raw) return toast("Enter your phone number or email");
  const em = aEmail(raw), ph = em ? null : aPhone(raw);
  if (!em && !ph) return toast("Enter a valid email, or a phone number with country code, like +91 98765 43210");
  if (!AUTH.on) { AUTH.sent = true; startResend(); return toast("Demo mode: type any 6 digits"); }
  const { error } = await AUTH.sb.auth.signInWithOtp(em ? { email: raw, options: { shouldCreateUser: true } } : { phone: ph });
  if (error) throw error;
  AUTH.sent = true; startResend();
  toast(em ? "Check your email for the code" : "We sent you a code");
}
async function aVerify() {
  if (!AUTH.on) return go("home");
  const raw = aVal("lg-contact"), em = aEmail(raw), ph = em ? null : aPhone(raw);
  if (!em && !ph) return toast("Enter your email or phone number first");
  if (!AUTH.sent) return toast("Tap Send code first");
  const code = [...document.querySelectorAll(".otp input")].map(i => i.value).join("");
  if (!/^\d{6}$/.test(code)) return toast("Enter the 6 digit code");
  const { data, error } = await AUTH.sb.auth.verifyOtp(em ? { email: raw, token: code, type: "email" } : { phone: ph, token: code, type: "sms" });
  if (error) throw error;
  await aAfter("customer", data.session);
}
async function aGoogle() {
  if (!AUTH.on) return toast("Demo mode: Google sign in needs Supabase");
  const { error } = await AUTH.sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
async function aShop() {
  if (!AUTH.on) return go("shop");
  const email = aVal("sl-email"), pass = (document.getElementById("sl-pass") || { value: "" }).value;
  if (!aEmail(email)) return toast("Enter a valid shop email");
  if (pass.length < 8) return toast("Password must be at least 8 characters");
  if (AUTH.shopMode === "signup") {
    const nm = aVal("sl-name");
    if (nm.length < 2) return toast("Enter your shop name");
    const { data, error } = await AUTH.sb.auth.signUp({ email, password: pass, options: { data: { shop_name: nm } } });
    if (error) throw error;
    if (data.session) return aAfter("shopkeeper", data.session);
    AUTH.shopMode = "login"; rerender();
    return toast("Check your email to confirm your account, then log in");
  }
  const { data, error } = await AUTH.sb.auth.signInWithPassword({ email, password: pass });
  if (error) throw error;
  return aAfter("shopkeeper", data.session);
}
async function authSignOut() {
  const kind = cur === "shop" ? "shoplogin" : "login";
  if (AUTH.on) { try { await AUTH.sb.auth.signOut(); } catch (e) {} AUTH.session = null; AUTH.role = null; AUTH.sent = false; }
  AUTH.shopMode = "login";
  go(AUTH.on ? "welcome" : kind);
}
async function authDelete() {
  if (!AUTH.on || !AUTH.session) return resetData();
  const { error } = await AUTH.sb.rpc("delete_my_account");
  if (error) return toast("Could not delete your account. Please try again.");
  try { await AUTH.sb.auth.signOut(); } catch (e) {}
  AUTH.session = null; AUTH.role = null;
  try { localStorage.removeItem("sq_uid"); } catch (e) {}
  resetData();
}
function syncProfile() {
  if (!AUTH.on || !AUTH.session) return;
  AUTH.sb.from("profiles").update({ name: D.user, contact: D.contact }).eq("id", AUTH.session.user.id)
    .then(({ error }) => { if (error) toast("Saved on this device. Could not sync to your account."); });
}
async function authOp(k) {
  if (k === "signout") return authSignOut();
  if (AUTH.busy) return;
  AUTH.busy = true;
  try {
    if (k === "send" || k === "resend") await aSend();
    else if (k === "verify") await aVerify();
    else if (k === "google") await aGoogle();
    else if (k === "shoplogin") await aShop();
    else if (k === "shopmode") { AUTH.shopMode = AUTH.shopMode === "login" ? "signup" : "login"; rerender(); }
  } catch (e) { toast(aMsg(e)); }
  finally { AUTH.busy = false; }
}

V.shoplogin = () => {
  const su = AUTH.shopMode === "signup";
  const lab = (t, i) => `<p class="mut rise" style="--i:${i};margin-bottom:6px;font-weight:600">${t}</p>`;
  return `<button class="ib rise" data-go="welcome" aria-label="Back to role selection">${ic("back")}</button><h1 class="big rise" style="margin-top:20px">${su ? "Create shop account" : "Shopkeeper login"}</h1><p class="mut rise" style="--i:1;margin-bottom:22px">${su ? "Set up your shop to run a queue and show a QR code." : "Sign in to manage your queue, call the next token and see who is waiting."}</p>
${su ? lab("Shop name", 2) + `<label class="field rise" style="--i:2">${ic("gov", 18)}<input id="sl-name" maxlength="60" placeholder="Your shop name" aria-label="Shop name"></label>` : ""}
${lab("Shop email", 2)}<label class="field rise" style="--i:2">${ic("user", 18)}<input id="sl-email" type="email" autocomplete="username" placeholder="you@yourshop.com" aria-label="Shop email"></label>
${lab("Password", 3)}<label class="field rise" style="--i:3">${ic("shield", 18)}<input id="sl-pass" type="password" autocomplete="${su ? "new-password" : "current-password"}" placeholder="At least 8 characters" aria-label="Password"></label>
<button class="btn b1 rise" style="--i:4" data-auth="shoplogin">${su ? "Create account" : "Log In to Dashboard"}</button>
<div class="rise" style="--i:5;text-align:center;margin-top:16px;display:grid;gap:10px"><button class="ln" data-auth="shopmode">${su ? "Already have a shop account? Log in" : "New shop? Create account"}</button><button class="ln" data-go="login">Customer? Log in here</button></div>
${AUTH.on ? "" : `<p class="mut rise" style="--i:5;text-align:center;margin-top:12px">Demo mode: Supabase is not connected, so any email and password opens the dashboard.</p>`}
<p class="terms rise" style="--i:6">By continuing, you agree to our <button class="lk" data-go="terms">Terms of Service</button> and <button class="lk" data-go="privacy">Privacy Policy</button></p>`;
};

if (AUTH.on) {
  AUTH.sb.auth.getSession().then(async ({ data }) => {
    if (data && data.session) {
      AUTH.session = data.session;
      try { const p = await aProfile(data.session.user.id); AUTH.role = (p && p.role) || "customer"; aLocal(data.session.user, p); }
      catch (e) { AUTH.role = "customer"; }
    }
  }).catch(() => {});
  AUTH.sb.auth.onAuthStateChange((ev, session) => {
    if (ev === "SIGNED_OUT") { AUTH.session = null; AUTH.role = null; const g = authGuard(cur); if (g !== cur) go(g); return; }
    if (ev === "SIGNED_IN" && session && !AUTH.busy && !AUTH.session && ["splash", "welcome", "login", "shoplogin"].includes(cur)) {
      aAfter(cur === "shoplogin" ? "shopkeeper" : "customer", session).catch(e => toast(aMsg(e)));
    }
  });
}
