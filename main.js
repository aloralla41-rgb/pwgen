const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const VAULT_PATH = () => path.join(app.getPath('userData'), 'vault.dat');

// In-memory unlocked state (never sent to renderer)
let vaultKey = null;      // Buffer, derived from master password
let vaultSalt = null;     // Buffer, stored alongside the vault file
let entries = [];         // [{ id, name, description, password, createdAt }]
let unlocked = false;

function vaultExists() {
  return fs.existsSync(VAULT_PATH());
}

function deriveKey(masterPassword, salt) {
  return crypto.scryptSync(masterPassword, salt, 32, { N: 16384, r: 8, p: 1 });
}

function saveVault() {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', vaultKey, iv);
  const plaintext = Buffer.from(JSON.stringify(entries), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload = {
    salt: vaultSalt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64')
  };

  fs.mkdirSync(path.dirname(VAULT_PATH()), { recursive: true });
  fs.writeFileSync(VAULT_PATH(), JSON.stringify(payload));
}

function createVault(masterPassword) {
  vaultSalt = crypto.randomBytes(16);
  vaultKey = deriveKey(masterPassword, vaultSalt);
  entries = [];
  unlocked = true;
  saveVault();
  return { ok: true };
}

function unlockVault(masterPassword) {
  try {
    const raw = JSON.parse(fs.readFileSync(VAULT_PATH(), 'utf8'));
    const salt = Buffer.from(raw.salt, 'base64');
    const iv = Buffer.from(raw.iv, 'base64');
    const authTag = Buffer.from(raw.authTag, 'base64');
    const data = Buffer.from(raw.data, 'base64');

    const key = deriveKey(masterPassword, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);

    vaultSalt = salt;
    vaultKey = key;
    entries = JSON.parse(decrypted.toString('utf8'));
    unlocked = true;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Wrong master password, or the vault file is corrupted.' };
  }
}

function lockVault() {
  vaultKey = null;
  vaultSalt = null;
  entries = [];
  unlocked = false;
}

function listMeta() {
  return entries
    .map(e => ({ id: e.id, name: e.name, description: e.description, createdAt: e.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function registerIpc() {
  ipcMain.handle('vault:status', () => ({ exists: vaultExists(), unlocked }));

  ipcMain.handle('vault:create', (evt, masterPassword) => {
    if (vaultExists()) return { ok: false, error: 'A vault already exists.' };
    if (!masterPassword || masterPassword.length < 4) {
      return { ok: false, error: 'Master password must be at least 4 characters.' };
    }
    return createVault(masterPassword);
  });

  ipcMain.handle('vault:unlock', (evt, masterPassword) => unlockVault(masterPassword));

  ipcMain.handle('vault:lock', () => {
    lockVault();
    return { ok: true };
  });

  ipcMain.handle('vault:list', () => {
    if (!unlocked) return [];
    return listMeta();
  });

  ipcMain.handle('vault:add', (evt, { name, description, password }) => {
    if (!unlocked) return { ok: false, error: 'Vault is locked.' };
    if (!name || !password) return { ok: false, error: 'Name and password are required.' };
    entries.push({
      id: crypto.randomUUID(),
      name,
      description: description || '',
      password,
      createdAt: Date.now()
    });
    saveVault();
    return { ok: true, entries: listMeta() };
  });

  ipcMain.handle('vault:reveal', (evt, id) => {
    if (!unlocked) return { ok: false };
    const entry = entries.find(e => e.id === id);
    if (!entry) return { ok: false };
    return { ok: true, password: entry.password };
  });

  ipcMain.handle('vault:copy', (evt, id) => {
    if (!unlocked) return { ok: false };
    const entry = entries.find(e => e.id === id);
    if (!entry) return { ok: false };
    clipboard.writeText(entry.password);
    const snapshot = entry.password;
    setTimeout(() => {
      if (clipboard.readText() === snapshot) clipboard.writeText('');
    }, 20000);
    return { ok: true };
  });

  ipcMain.handle('vault:delete', (evt, id) => {
    if (!unlocked) return { ok: false };
    entries = entries.filter(e => e.id !== id);
    saveVault();
    return { ok: true, entries: listMeta() };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 560,
    height: 760,
    resizable: true,
    autoHideMenuBar: true,
    title: 'PwGen',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
