const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const http = require("http");

const NEXT_PORT = 3001;
const NEXT_URL  = `http://127.0.0.1:${NEXT_PORT}`;

// ─── Recognise BOTH 127.0.0.1 and localhost as "our" app ─────────────────────
// Google redirects back to whichever redirect_uri we registered, which may be
// localhost even though Electron loads via 127.0.0.1.  Without this, the
// callback falls through to shell.openExternal → system browser.
function isLocalUrl(url) {
  return (
    url.startsWith(`http://127.0.0.1:${NEXT_PORT}`) ||
    url.startsWith(`http://localhost:${NEXT_PORT}`)
  );
}

function isGoogleUrl(url) {
  return (
    url.includes("accounts.google.com") ||
    url.includes("google.com/o/oauth")  ||
    url.includes("oauth2.googleapis.com")
  );
}

let mainWindow  = null;
let nextProcess = null;

// ─── Check if Next.js is already listening ────────────────────────────────────
function isNextRunning() {
  return new Promise((resolve) => {
    const req = http.get(NEXT_URL, (res) => {
      resolve(res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

// ─── Poll until Next is ready ─────────────────────────────────────────────────
function waitForNext(timeout = 90000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(async () => {
      if (await isNextRunning()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for Next.js"));
      }
    }, 800);
  });
}

// ─── Start Next.js dev server (Windows-safe) ─────────────────────────────────
function startNextServer() {
  return new Promise((resolve, reject) => {
    nextProcess = spawn("npm", ["run", "dev", "--", "--port", String(NEXT_PORT)], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      shell: true,        // required on Windows so npm.cmd resolves
      windowsHide: true,
    });

    nextProcess.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
    nextProcess.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
    nextProcess.on("error", reject);

    waitForNext().then(resolve).catch(reject);
  });
}

// ─── Create the Electron window ───────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1400,
    height:    900,
    minWidth:  900,
    minHeight: 600,
    title:     "ThumbGen",
    backgroundColor: "#0a0d14",
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      webSecurity:      true,
    },
    show: true,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.loadURL(NEXT_URL);

  // ─── Navigation guard ─────────────────────────────────────────────────────
  // Keep OAuth and local pages inside Electron; everything else → system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url) || isGoogleUrl(url)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isLocalUrl(url) || isGoogleUrl(url)) return; // allow inside Electron
    event.preventDefault();
    shell.openExternal(url);
  });

  // ─── Intercept new windows that Electron creates for OAuth ───────────────
  // When Electron opens a child window for the Google sign-in page, intercept
  // its navigation so the callback (localhost or 127.0.0.1) comes back here.
  app.on("web-contents-created", (_e, wc) => {
    wc.on("will-navigate", (event, url) => {
      if (isLocalUrl(url) || isGoogleUrl(url)) {
        // Redirect the callback into the main window instead of the child
        if (isLocalUrl(url) && mainWindow) {
          event.preventDefault();
          mainWindow.loadURL(url);
        }
        return;
      }
      event.preventDefault();
      shell.openExternal(url);
    });
  });

  // ─── Auto-escape from Google OAuth error pages ────────────────────────────
  mainWindow.webContents.on("did-navigate", (_event, url) => {
    const isGoogleError =
      isGoogleUrl(url) &&
      (url.includes("error=") || url.includes("errorCode="));
    if (isGoogleError) {
      setTimeout(() => {
        if (mainWindow) mainWindow.loadURL(`${NEXT_URL}/?error=oauth_failed`);
      }, 1200);
    }
  });

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (!mainWindow) return;
    const wc = mainWindow.webContents;
    if (input.type === "keyDown" && input.key === "ArrowLeft"  && input.alt && wc.canGoBack())    wc.goBack();
    if (input.type === "keyDown" && input.key === "ArrowRight" && input.alt && wc.canGoForward()) wc.goForward();
    if (input.type === "keyDown" && input.key === "Escape") {
      if (!isLocalUrl(wc.getURL())) wc.loadURL(NEXT_URL);
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  const alreadyRunning = await isNextRunning();

  if (alreadyRunning) {
    console.log("Next.js already running — opening window.");
    createWindow();
  } else {
    console.log("Starting Next.js…");
    try {
      await startNextServer();
      console.log("Next.js ready — opening window.");
      createWindow();
    } catch (err) {
      console.error("Failed to start Next.js:", err);
      app.quit();
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (nextProcess) { nextProcess.kill(); nextProcess = null; }
});
