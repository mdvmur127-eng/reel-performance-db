import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://lhmbqwasymbkqnnqnjxr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b3GrtPN4T8dqorRlcAiuLQ_gnyyzhe9";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const authMessageEl = document.getElementById("auth-message");
const signupForm = document.getElementById("signup-form");
const loginForm = document.getElementById("login-form");
let loaderEl = null;

function setAuthMessage(message, isError = false) {
  if (!authMessageEl) return;
  authMessageEl.textContent = message || "";
  authMessageEl.classList.toggle("error", Boolean(message && isError));
}

function ensureLoader() {
  if (loaderEl) return loaderEl;
  loaderEl = document.createElement("div");
  loaderEl.className = "loading-overlay hidden";
  loaderEl.innerHTML = `
    <div class="loading-box">
      <div class="spinner" aria-hidden="true"></div>
      <div id="loading-text" class="loading-text">Processing...</div>
    </div>
  `;
  document.body.appendChild(loaderEl);
  return loaderEl;
}

function setLoading(isLoading, text = "Processing...") {
  const overlay = ensureLoader();
  const textEl = overlay.querySelector("#loading-text");
  if (textEl) textEl.textContent = text;
  overlay.classList.toggle("hidden", !isLoading);
}

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(signupForm);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    if (!email || !password) return;

    setLoading(true, "Creating account...");
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setAuthMessage(`Sign up failed: ${error.message}`, true);
        return;
      }
      setAuthMessage("Sign-up success. Check your email for confirmation if required.");
    } finally {
      setLoading(false);
    }
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(loginForm);
    const email = String(fd.get("email") || "").trim();
    const password = String(fd.get("password") || "");
    if (!email || !password) return;

    setLoading(true, "Logging in...");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthMessage(`Login failed: ${error.message}`, true);
        return;
      }
      window.location.href = "/app.html";
    } finally {
      setLoading(false);
    }
  });
}

async function init() {
  setLoading(true, "Checking session...");
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user) {
      window.location.href = "/app.html";
    }
  } finally {
    setLoading(false);
  }
}

init();
