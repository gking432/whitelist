const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  screen,
  shell,
  Tray,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const { normalizeAppUrl } = require("./runtime-config.cjs");

const PRODUCT_NAME = "Business Assistant";
const LOCAL_APP_URL = "http://localhost:3000";
const desktopTestMode = process.env.DESKTOP_TEST_MODE === "true";

app.setPath(
  "userData",
  process.env.DESKTOP_USER_DATA_DIR || path.join(app.getPath("appData"), PRODUCT_NAME),
);

let window = null;
let tray = null;
let activeCall = false;
let appUrl = null;
let quitting = false;
let updateState = "idle";

async function reportDesktopError(error, context = {}) {
  const destination = resolveAppUrl();
  if (!destination) return;

  const value = error instanceof Error ? error : new Error(String(error));
  try {
    await net.fetch(`${destination}/api/monitoring/client-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "desktop",
        name: value.name,
        message: value.message || "Desktop process error",
        stack: value.stack,
        path: "/desktop/assistant",
        version: app.getVersion(),
        ...context,
      }),
    });
  } catch {
    // The reporter must not destabilize the assistant.
  }
}

function configPath() {
  return path.join(app.getPath("userData"), "runtime-config.json");
}

function readRuntimeConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeRuntimeConfig(nextConfig) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(nextConfig, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

function resolveAppUrl() {
  const environmentUrl = normalizeAppUrl(
    process.env.NORTHSTAR_APP_URL,
    !app.isPackaged,
  );
  if (environmentUrl) return environmentUrl;

  const storedUrl = normalizeAppUrl(
    readRuntimeConfig().appUrl,
    !app.isPackaged,
  );
  if (storedUrl) return storedUrl;

  return app.isPackaged ? null : LOCAL_APP_URL;
}

function isTrustedUrl(value) {
  if (!appUrl) return false;

  try {
    return new URL(value).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

function positionWindow() {
  if (!window) return;

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = window.getBounds();
  const x = Math.max(
    display.workArea.x,
    display.workArea.x + display.workArea.width - bounds.width - 20,
  );
  const y = Math.max(
    display.workArea.y,
    display.workArea.y + display.workArea.height - bounds.height - 20,
  );
  window.setPosition(x, y, false);
}

function showWindow({ focus = true } = {}) {
  if (!window) return;

  positionWindow();
  if (focus) {
    window.show();
    window.focus();
  } else {
    window.showInactive();
  }
}

function loadAssistant() {
  appUrl = resolveAppUrl();

  if (!window) return;

  if (!appUrl) {
    window.loadFile(path.join(__dirname, "setup.html"));
    showWindow();
    return;
  }

  const assistantPath =
    !app.isPackaged && process.env.NORTHSTAR_DEV_AUTO_LOGIN === "true"
      ? "/dev/auto-login?next=/desktop/assistant"
      : "/desktop/assistant";
  window.loadURL(`${appUrl}${assistantPath}`);
}

function showServerSetup() {
  if (!window) return;
  window.loadFile(path.join(__dirname, "setup.html"));
  showWindow();
}

function setLaunchAtLogin(enabled) {
  const config = readRuntimeConfig();
  writeRuntimeConfig({ ...config, launchAtLogin: Boolean(enabled) });

  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      openAsHidden: Boolean(enabled),
      args: enabled ? ["--hidden"] : [],
    });
  }
}

function launchAtLoginEnabled() {
  const configured = readRuntimeConfig().launchAtLogin;
  return configured === undefined ? true : Boolean(configured);
}

function rebuildTrayMenu() {
  if (!tray) return;

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open phone assistant",
        click: () => showWindow(),
      },
      {
        label: "Workspace server...",
        click: showServerSetup,
      },
      {
        label:
          updateState === "checking"
            ? "Checking for updates..."
            : updateState === "downloading"
              ? "Downloading update..."
            : updateState === "ready"
              ? "Restart to install update"
              : "Check for updates",
        enabled: !["checking", "downloading"].includes(updateState),
        click: () => {
          if (updateState === "ready") {
            quitting = true;
            autoUpdater.quitAndInstall();
            return;
          }

          void checkForUpdates();
        },
      },
      { type: "separator" },
      {
        label: "Launch at login",
        type: "checkbox",
        checked: launchAtLoginEnabled(),
        click: (item) => {
          setLaunchAtLogin(item.checked);
          rebuildTrayMenu();
        },
      },
      { type: "separator" },
      {
        label: `Quit ${PRODUCT_NAME}`,
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

async function checkForUpdates({ quiet = false } = {}) {
  if (!app.isPackaged) return;

  updateState = "checking";
  rebuildTrayMenu();

  try {
    const result = await autoUpdater.checkForUpdatesAndNotify();

    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      updateState = "idle";
      if (!quiet) tray?.displayBalloon?.({
        title: PRODUCT_NAME,
        content: "You already have the latest version.",
      });
    }
  } catch (error) {
    updateState = "error";
    if (!quiet) {
      console.error("Desktop update check failed:", error);
    }
  }

  rebuildTrayMenu();
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on("update-available", () => {
  updateState = "downloading";
  rebuildTrayMenu();
});
autoUpdater.on("update-downloaded", () => {
  updateState = "ready";
  rebuildTrayMenu();
});
autoUpdater.on("error", (error) => {
  updateState = "error";
  console.error("Desktop updater error:", error);
  void reportDesktopError(error, { path: "/desktop/updater" });
  rebuildTrayMenu();
});

function createTray() {
  const iconPath = path.join(__dirname, "build", "icon.png");
  const icon = nativeImage.createFromPath(iconPath).resize({
    width: 18,
    height: 18,
  });

  if (process.platform === "darwin") icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip(PRODUCT_NAME);
  tray.on("click", () => showWindow());
  rebuildTrayMenu();
}

function createWindow() {
  window = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 380,
    minHeight: 560,
    show: false,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    title: PRODUCT_NAME,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) {
      return { action: "allow" };
    }

    shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:") || isTrustedUrl(url)) return;

    event.preventDefault();
    shell.openExternal(url);
  });

  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );

  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on("closed", () => {
    window = null;
  });

  window.webContents.once("did-finish-load", () => {
    const openedAtLogin =
      app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin;

    if (!app.commandLine.hasSwitch("hidden") && !openedAtLogin) showWindow();
  });

  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    void reportDesktopError(
      new Error(`Assistant page failed to load (${code}): ${description}`),
      { path: url },
    );
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    void reportDesktopError(
      new Error(`Assistant renderer stopped: ${details.reason}`),
      { path: "/desktop/assistant" },
    );
  });

  loadAssistant();
}

ipcMain.on("northstar:call-active", (_event, nextActive) => {
  activeCall = Boolean(nextActive);

  if (!window) return;

  window.setAlwaysOnTop(activeCall, activeCall ? "floating" : "normal");
  window.setVisibleOnAllWorkspaces(activeCall, {
    visibleOnFullScreen: activeCall,
  });

  if (activeCall) showWindow({ focus: false });
});

ipcMain.on("northstar:minimize", () => window?.minimize());
ipcMain.on("northstar:close", () => window?.hide());

ipcMain.handle("northstar:get-runtime-config", () => ({
  appUrl: resolveAppUrl() ?? "",
  isPackaged: app.isPackaged,
  launchAtLogin: launchAtLoginEnabled(),
}));

ipcMain.handle("northstar:save-server", async (_event, submittedUrl) => {
  const normalized = normalizeAppUrl(submittedUrl, !app.isPackaged);

  if (!normalized) {
    return {
      ok: false,
      error: app.isPackaged
        ? "Enter the secure HTTPS address supplied by your service partner."
        : "Enter an HTTPS address or a local development address.",
    };
  }

  try {
    const response = await net.fetch(`${normalized}/login`, {
      redirect: "follow",
    });

    if (response.status >= 500) {
      return {
        ok: false,
        error: "That server responded with an error. Check the address.",
      };
    }
  } catch {
    return {
      ok: false,
      error: "The assistant could not reach that server.",
    };
  }

  const config = readRuntimeConfig();
  writeRuntimeConfig({ ...config, appUrl: normalized });
  appUrl = normalized;
  loadAssistant();
  return { ok: true };
});

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(() => {
    app.setName(PRODUCT_NAME);
    createTray();

    if (app.isPackaged && desktopTestMode) {
      app.setLoginItemSettings({ openAtLogin: false });
    } else if (app.isPackaged && readRuntimeConfig().launchAtLogin === undefined) {
      setLaunchAtLogin(true);
      rebuildTrayMenu();
    }

    createWindow();
    if (!desktopTestMode) {
      setTimeout(() => void checkForUpdates({ quiet: true }), 10_000);
      setInterval(() => void checkForUpdates({ quiet: true }), 6 * 60 * 60 * 1000);
    }

    app.on("activate", () => {
      if (!window) createWindow();
      else showWindow();
    });
  });
}

app.on("before-quit", () => {
  quitting = true;
});

process.on("unhandledRejection", (reason) => {
  void reportDesktopError(reason, { path: "/desktop/main" });
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
