'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.EPIFLOW_SERVICE_DATA || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'restfox.db');
const db = new DatabaseSync(DB_PATH);

// Configuraciones de rendimiento y robustez
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Esquema de tablas
db.exec(`
CREATE TABLE IF NOT EXISTS workspaces (
    _id TEXT PRIMARY KEY,
    name TEXT,
    updatedAt INTEGER,
    data TEXT
);

CREATE TABLE IF NOT EXISTS collections (
    _id TEXT PRIMARY KEY,
    workspaceId TEXT,
    parentId TEXT,
    _type TEXT,
    data TEXT
);
CREATE INDEX IF NOT EXISTS idx_collections_workspaceId ON collections(workspaceId);

CREATE TABLE IF NOT EXISTS responses (
    _id TEXT PRIMARY KEY,
    collectionId TEXT,
    createdAt INTEGER,
    data TEXT
);
CREATE INDEX IF NOT EXISTS idx_responses_collectionId ON responses(collectionId);

CREATE TABLE IF NOT EXISTS plugins (
    _id TEXT PRIMARY KEY,
    workspaceId TEXT,
    collectionId TEXT,
    data TEXT
);
CREATE INDEX IF NOT EXISTS idx_plugins_workspaceId ON plugins(workspaceId);

CREATE TABLE IF NOT EXISTS settings_files (
    _id TEXT PRIMARY KEY,
    fileName TEXT,
    content TEXT
);

CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT
);
`);

// Seed inicial: crear workspace predeterminado si la tabla está vacía
const countWorkspaces = db.prepare('SELECT count(*) as count FROM workspaces').get().count;
if (countWorkspaces === 0) {
    const defaultWorkspace = {
        _id: 'default',
        name: 'Default Workspace',
        _type: 'normal',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        environments: [{ name: 'Default', environment: {}, color: '#10b981' }],
        currentEnvironment: 'Default'
    };
    db.prepare('INSERT INTO workspaces (_id, name, updatedAt, data) VALUES (?, ?, ?, ?)').run(
        defaultWorkspace._id,
        defaultWorkspace.name,
        defaultWorkspace.updatedAt,
        JSON.stringify(defaultWorkspace)
    );
}

// Default KV seed
const themeSetting = db.prepare('SELECT value FROM kv_store WHERE key = ?').get('Restfox-Theme');
if (!themeSetting) {
    db.prepare('INSERT INTO kv_store (key, value) VALUES (?, ?)').run('Restfox-Theme', JSON.stringify('dark'));
}

export const sqliteStorage = {
    // Workspaces
    getAllWorkspaces() {
        const rows = db.prepare('SELECT data FROM workspaces ORDER BY updatedAt DESC').all();
        return rows.map(r => JSON.parse(r.data));
    },

    getWorkspace(id) {
        const row = db.prepare('SELECT data FROM workspaces WHERE _id = ?').get(id);
        return row ? JSON.parse(row.data) : null;
    },

    putWorkspace(workspace) {
        const updatedAt = workspace.updatedAt || Date.now();
        db.prepare('INSERT OR REPLACE INTO workspaces (_id, name, updatedAt, data) VALUES (?, ?, ?, ?)').run(
            workspace._id,
            workspace.name,
            updatedAt,
            JSON.stringify(workspace)
        );
        return { success: true };
    },

    updateWorkspace(workspaceId, updatedFields) {
        const existing = this.getWorkspace(workspaceId);
        if (!existing) return { error: 'Workspace not found' };
        const merged = { ...existing, ...updatedFields, updatedAt: Date.now() };
        this.putWorkspace(merged);
        return { error: null, version: String(merged.updatedAt) };
    },

    deleteWorkspace(workspaceId) {
        db.prepare('DELETE FROM workspaces WHERE _id = ?').run(workspaceId);
        db.prepare('DELETE FROM collections WHERE workspaceId = ?').run(workspaceId);
        db.prepare('DELETE FROM plugins WHERE workspaceId = ?').run(workspaceId);
        return { success: true };
    },

    // Collections
    getCollectionForWorkspace(workspaceId, type = null) {
        let rows;
        if (type) {
            rows = db.prepare('SELECT data FROM collections WHERE workspaceId = ? AND _type = ?').all(workspaceId, type);
        } else {
            rows = db.prepare('SELECT data FROM collections WHERE workspaceId = ?').all(workspaceId);
        }
        return {
            error: null,
            collection: rows.map(r => JSON.parse(r.data)),
            workspace: null,
            idMap: null
        };
    },

    getCollectionById(collectionId) {
        const row = db.prepare('SELECT data FROM collections WHERE _id = ?').get(collectionId);
        return row ? JSON.parse(row.data) : null;
    },

    createCollection(collection) {
        db.prepare('INSERT OR REPLACE INTO collections (_id, workspaceId, parentId, _type, data) VALUES (?, ?, ?, ?, ?)').run(
            collection._id,
            collection.workspaceId || null,
            collection.parentId || null,
            collection._type || null,
            JSON.stringify(collection)
        );
        return { error: null, oldCollectionId: null, newCollectionId: null };
    },

    createCollections(collections) {
        const stmt = db.prepare('INSERT OR REPLACE INTO collections (_id, workspaceId, parentId, _type, data) VALUES (?, ?, ?, ?, ?)');
        for (const item of collections) {
            stmt.run(
                item._id,
                item.workspaceId || null,
                item.parentId || null,
                item._type || null,
                JSON.stringify(item)
            );
        }
        return { error: null, results: [] };
    },

    updateCollection(collectionId, updatedFields) {
        const existing = this.getCollectionById(collectionId);
        if (!existing) return { error: `Collection ${collectionId} not found` };
        const merged = { ...existing, ...updatedFields };
        this.createCollection(merged);
        return { error: null };
    },

    deleteCollectionsByWorkspaceId(workspaceId) {
        db.prepare('DELETE FROM collections WHERE workspaceId = ?').run(workspaceId);
        return { success: true };
    },

    deleteCollectionsByIds(collectionIds) {
        const placeholders = collectionIds.map(() => '?').join(',');
        if (placeholders) {
            db.prepare(`DELETE FROM collections WHERE _id IN (${placeholders})`).run(...collectionIds);
        }
        return { error: null };
    },

    // Responses
    getResponsesByCollectionId(collectionId) {
        const rows = db.prepare('SELECT data FROM responses WHERE collectionId = ? ORDER BY createdAt DESC').all(collectionId);
        return rows.map(r => JSON.parse(r.data));
    },

    createResponse(response) {
        db.prepare('INSERT OR REPLACE INTO responses (_id, collectionId, createdAt, data) VALUES (?, ?, ?, ?)').run(
            response._id,
            response.collectionId,
            response.createdAt || Date.now(),
            JSON.stringify(response)
        );
        return { success: true };
    },

    updateResponse(responseId, updatedFields) {
        const row = db.prepare('SELECT data FROM responses WHERE _id = ?').get(responseId);
        if (!row) return { error: 'Response not found' };
        const merged = { ...JSON.parse(row.data), ...updatedFields };
        this.createResponse(merged);
        return { success: true };
    },

    deleteResponse(responseId) {
        db.prepare('DELETE FROM responses WHERE _id = ?').run(responseId);
        return { success: true };
    },

    deleteResponsesByIds(responseIds) {
        const placeholders = responseIds.map(() => '?').join(',');
        if (placeholders) {
            db.prepare(`DELETE FROM responses WHERE _id IN (${placeholders})`).run(...responseIds);
        }
        return { success: true };
    },

    deleteResponsesByCollectionId(collectionId) {
        db.prepare('DELETE FROM responses WHERE collectionId = ?').run(collectionId);
        return { success: true };
    },

    deleteResponsesByCollectionIds(collectionIds) {
        const placeholders = collectionIds.map(() => '?').join(',');
        if (placeholders) {
            db.prepare(`DELETE FROM responses WHERE collectionId IN (${placeholders})`).run(...collectionIds);
        }
        return { success: true };
    },

    // Plugins
    getGlobalPlugins() {
        const rows = db.prepare('SELECT data FROM plugins WHERE workspaceId IS NULL AND collectionId IS NULL').all();
        return rows.map(r => JSON.parse(r.data));
    },

    getWorkspacePlugins(workspaceId) {
        const rows = db.prepare('SELECT data FROM plugins WHERE workspaceId = ?').all(workspaceId);
        return rows.map(r => JSON.parse(r.data));
    },

    createPlugin(plugin) {
        db.prepare('INSERT OR REPLACE INTO plugins (_id, workspaceId, collectionId, data) VALUES (?, ?, ?, ?)').run(
            plugin._id,
            plugin.workspaceId || null,
            plugin.collectionId || null,
            JSON.stringify(plugin)
        );
        return { success: true };
    },

    createPlugins(plugins) {
        const stmt = db.prepare('INSERT OR REPLACE INTO plugins (_id, workspaceId, collectionId, data) VALUES (?, ?, ?, ?)');
        for (const p of plugins) {
            stmt.run(p._id, p.workspaceId || null, p.collectionId || null, JSON.stringify(p));
        }
        return { success: true };
    },

    updatePlugin(pluginId, updatedFields) {
        const row = db.prepare('SELECT data FROM plugins WHERE _id = ?').get(pluginId);
        if (!row) return { error: 'Plugin not found' };
        const merged = { ...JSON.parse(row.data), ...updatedFields };
        this.createPlugin(merged);
        return { success: true };
    },

    deletePlugin(pluginId) {
        db.prepare('DELETE FROM plugins WHERE _id = ?').run(pluginId);
        return { success: true };
    },

    deletePluginsByWorkspace(workspaceId) {
        db.prepare('DELETE FROM plugins WHERE workspaceId = ?').run(workspaceId);
        return { success: true };
    },

    deletePluginsByCollectionIds(collectionIds) {
        const placeholders = collectionIds.map(() => '?').join(',');
        if (placeholders) {
            db.prepare(`DELETE FROM plugins WHERE collectionId IN (${placeholders})`).run(...collectionIds);
        }
        return { success: true };
    },

    // Settings Files
    getSettingsFile(id) {
        const row = db.prepare('SELECT fileName, content FROM settings_files WHERE _id = ?').get(id);
        return row || null;
    },

    putSettingsFile(id, file) {
        db.prepare('INSERT OR REPLACE INTO settings_files (_id, fileName, content) VALUES (?, ?, ?)').run(
            id,
            file.fileName,
            file.content
        );
        return { success: true };
    },

    deleteSettingsFile(id) {
        db.prepare('DELETE FROM settings_files WHERE _id = ?').run(id);
        return { success: true };
    },

    // Key-Value settings (para persistir theme, flags, etc. a prueba de cambios de puerto)
    getKV(key) {
        const row = db.prepare('SELECT value FROM kv_store WHERE key = ?').get(key);
        return row ? JSON.parse(row.value) : null;
    },

    setKV(key, value) {
        db.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
        return { success: true };
    },

    getAllKV() {
        const rows = db.prepare('SELECT key, value FROM kv_store').all();
        const result = {};
        for (const row of rows) {
            try {
                result[row.key] = JSON.parse(row.value);
            } catch {
                result[row.key] = row.value;
            }
        }
        return result;
    }
};
