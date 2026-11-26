const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("northstarDesktop", {
  setCallActive(active) {
    ipcRenderer.send("northstar:call-active", Boolean(active));
  },
  minimize() {
    ipcRenderer.send("northstar:minimize");
  },
  close() {
    ipcRenderer.send("northstar:close");
  },
  getRuntimeConfig() {
    return ipcRenderer.invoke("northstar:get-runtime-config");
  },
  saveServerUrl(appUrl) {
    return ipcRenderer.invoke("northstar:save-server", appUrl);
  },
});
