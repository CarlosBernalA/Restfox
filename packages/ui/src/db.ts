import Dexie from 'dexie'
import '@flawiddsouza/dexie-export-import'
import {
    CollectionItem,
    FileObject,
    FileWorkspace,
    Plugin,
    RequestFinalResponse,
    Workspace,
} from './global'
import { type OAuthTokens, setOAuthTokens } from '@/utils/oauth-tokens'

async function callWebStandaloneAPI(method: string, args: Record<string, unknown> = {}) {
    const res = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args, (_, value) => {
            if(value instanceof ArrayBuffer) {
                return Array.from(new Uint8Array(value))
            }
            if(value instanceof Uint8Array) {
                return Array.from(value)
            }
            return value
        }),
    })

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }

    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
        throw new Error(`Expected JSON but received: ${contentType}`)
    }

    const data = await res.json()
    if (data.error) {
        throw new Error(data.error)
    }
    return data.result
}

const webStandaloneIPC = {
    getWorkspaceAtLocation:             (location: string, getEnvironments = false) => callWebStandaloneAPI('getWorkspaceAtLocation', { location, getEnvironments }),
    updateWorkspace:                    (workspace: any, updatedFields: any, version?: string) => callWebStandaloneAPI('updateWorkspace', { workspace, updatedFields, version }),
    ensureEmptyFolderOrEmptyWorkspace:  (location: string) => callWebStandaloneAPI('ensureEmptyFolderOrEmptyWorkspace', { location }),
    getCollectionForWorkspace:          (workspace: any, type: any, watch: boolean) => callWebStandaloneAPI('getCollectionForWorkspace', { workspace, type, watch }),
    getCollectionById:                  (workspace: any, collectionId: string) => callWebStandaloneAPI('getCollectionById', { workspace, collectionId }),
    createCollection:                   (workspace: any, collection: any) => callWebStandaloneAPI('createCollection', { workspace, collection }),
    createCollections:                  (workspace: any, collections: any[]) => callWebStandaloneAPI('createCollections', { workspace, collections }),
    updateCollection:                   (workspace: any, collectionId: string, updatedFields: any, version?: string | null) => callWebStandaloneAPI('updateCollection', { workspace, collectionId, updatedFields, version }),
    deleteCollectionsByWorkspaceId:     (workspace: any) => callWebStandaloneAPI('deleteCollectionsByWorkspaceId', { workspace }),
    deleteCollectionsByIds:             (workspace: any, collectionIds: string[]) => callWebStandaloneAPI('deleteCollectionsByIds', { workspace, collectionIds }),
    getResponsesByCollectionId:         (workspace: any, collectionId: string) => callWebStandaloneAPI('getResponsesByCollectionId', { workspace, collectionId }),
    createResponse:                     (workspace: any, response: any) => callWebStandaloneAPI('createResponse', { workspace, response }),
    updateResponse:                     (workspace: any, collectionId: string, responseId: string, updatedFields: any) => callWebStandaloneAPI('updateResponse', { workspace, collectionId, responseId, updatedFields }),
    deleteResponse:                     (workspace: any, collectionId: string, responseId: string) => callWebStandaloneAPI('deleteResponse', { workspace, collectionId, responseId }),
    deleteResponsesByIds:               (workspace: any, collectionId: string, responseIds: string[]) => callWebStandaloneAPI('deleteResponsesByIds', { workspace, collectionId, responseIds }),
    deleteResponsesByCollectionIds:     (workspace: any, collectionIds: string[]) => callWebStandaloneAPI('deleteResponsesByCollectionIds', { workspace, collectionIds }),
    deleteResponsesByCollectionId:      (workspace: any, collectionId: string) => callWebStandaloneAPI('deleteResponsesByCollectionId', { workspace, collectionId }),
    getWorkspacePlugins:                (workspace: any) => callWebStandaloneAPI('getWorkspacePlugins', { workspace }),
    createPlugin:                       (workspace: any, plugin: any) => callWebStandaloneAPI('createPlugin', { workspace, plugin }),
    updatePlugin:                       (workspace: any, collectionId: string | null, pluginId: string, updatedFields: any, expectedCode?: unknown) => callWebStandaloneAPI('updatePlugin', { workspace, collectionId, pluginId, updatedFields, expectedCode }),
    deletePlugin:                       (workspace: any, collectionId: string | null, pluginId: string) => callWebStandaloneAPI('deletePlugin', { workspace, collectionId, pluginId }),
    deletePluginsByWorkspace:           (workspace: any) => callWebStandaloneAPI('deletePluginsByWorkspace', { workspace }),
    deletePluginsByCollectionIds:       (workspace: any, collectionIds: string[]) => callWebStandaloneAPI('deletePluginsByCollectionIds', { workspace, collectionIds }),
    createPlugins:                      (workspace: any, plugins: any[]) => callWebStandaloneAPI('createPlugins', { workspace, plugins }),
    readFile:                           (filePath: string, workspaceLocation?: string) => callWebStandaloneAPI('readFile', { filePath, workspaceLocation }),
    getInstallInfo:                     () => callWebStandaloneAPI('getInstallInfo', {}),
}

function resolveFileIPC() {
    if (import.meta.env.MODE === 'desktop-electron') {
        return window.electronIPC
    }
    if (import.meta.env.MODE === 'web-standalone') {
        return webStandaloneIPC
    }
    return null
}

export const fileIPC = resolveFileIPC()

export class RestfoxDatabase extends Dexie {
    workspaces!: Dexie.Table<any>
    collections!: Dexie.Table<any>
    plugins!: Dexie.Table<any>
    responses!: Dexie.Table<any>

    constructor() {
        super('Restfox')

        this.version(5).stores({
            workspaces: '_id',
            collections: '_id, workspaceId',
            plugins: '_id, workspaceId, collectionId',
            responses: '_id, collectionId',
        })
    }
}

const db = new RestfoxDatabase()

db.version(5).stores({
    workspaces: '_id',
    collections: '_id, workspaceId',
    plugins: '_id, workspaceId, collectionId',
    responses: '_id, collectionId'
})

export interface SettingsFile {
    fileName: string
    content: string
}

class RestfoxSettingsFilesDatabase extends Dexie {
    files!: Dexie.Table<SettingsFile & { _id: string }>

    constructor() {
        super('Restfox-SettingsFiles')

        this.version(1).stores({
            files: '_id',
        })
    }
}

const settingsFilesDB = new RestfoxSettingsFilesDatabase()

export async function getSettingsFile(id: string): Promise<SettingsFile | null> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/getSettingsFile', { id })
        } catch (e) {
            console.warn('Fallback to settingsFilesDB:', e)
        }
    }
    const file = await settingsFilesDB.files.get(id)
    return file ? { fileName: file.fileName, content: file.content } : null
}

export async function putSettingsFile(id: string, file: SettingsFile) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            await callWebStandaloneAPI('db/putSettingsFile', { id, file })
        } catch (e) {
            console.warn('Fallback putSettingsFile:', e)
        }
    }
    await settingsFilesDB.files.put({ _id: id, ...file })
}

export async function deleteSettingsFile(id: string) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            await callWebStandaloneAPI('db/deleteSettingsFile', { id })
        } catch (e) {
            console.warn('Fallback deleteSettingsFile:', e)
        }
    }
    await settingsFilesDB.files.delete(id)
}

export async function getKV(key: string): Promise<any> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/getKV', { key })
        } catch {
            return localStorage.getItem(key)
        }
    }
    return localStorage.getItem(key)
}

export async function setKV(key: string, value: any): Promise<void> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            await callWebStandaloneAPI('db/setKV', { key, value })
        } catch (e) {
            // fallback silencioso
        }
    }
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
}

export async function getAllKV(): Promise<Record<string, any>> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return (await callWebStandaloneAPI('db/getAllKV', {})) || {}
        } catch {
            return {}
        }
    }
    return {}
}

export async function exportDB() {
    const blob = await db.export()
    return blob
}

export async function importDB(file: File) {
    await db.delete()
    await db.open()
    await db.import(file)
    document.location.reload()
}

// Workspaces

export async function getAllWorkspaces(): Promise<Workspace[]> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const res = await callWebStandaloneAPI('db/getAllWorkspaces', {})
            if (Array.isArray(res)) return res
        } catch (e) {
            console.warn('Fallback getAllWorkspaces to Dexie:', e)
        }
    }
    return db.workspaces.toCollection().reverse().sortBy('updatedAt')
}

export async function getFileWorkspace(location: string): Promise<FileWorkspace> {
    if(!fileIPC) {
        throw new Error('File workspaces are not available')
    }
    return fileIPC.getWorkspaceAtLocation(location, true)
}

export async function putWorkspace(workspace: Workspace) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            await callWebStandaloneAPI('db/putWorkspace', { workspace })
        } catch (e) {
            console.warn('Fallback putWorkspace to Dexie:', e)
        }
    }
    await db.workspaces.put(workspace)
}

export async function updateWorkspace(workspaceId: string, updatedFields: Partial<Workspace>, skipUpdateForFileWorkspace = false, version?: string, onSending?: () => void): Promise<{ error: string | null, changedOutside?: boolean, version?: string }> {
    if (import.meta.env.MODE === 'web-standalone') {
        onSending?.()
        try {
            return await callWebStandaloneAPI('db/updateWorkspace', { workspaceId, updatedFields })
        } catch (e) {
            console.warn('Fallback updateWorkspace to Dexie:', e)
        }
    }

    let error: string | null = null
    let changedOutside: boolean | undefined
    let savedVersion: string | undefined
    if(fileIPC && !skipUpdateForFileWorkspace) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            const locationChanged = updatedFields.location !== undefined && updatedFields.location !== workspace.location
            try {
                const sending = fileIPC.updateWorkspace(workspace, updatedFields, version)
                onSending?.()
                const result = await sending
                changedOutside = result?.changedOutside
                savedVersion = result?.version
                if(result?.error) {
                    console.warn('Error updating file workspace', result.error)
                    error = locationChanged ? null : result.error
                }
            } catch (e) {
                console.warn('Error updating file workspace', e)
                if(!locationChanged) {
                    error = e instanceof Error ? e.message : String(e)
                }
            }
            if(error) {
                delete updatedFields.name
            }
            delete updatedFields.currentEnvironment
            delete updatedFields.environment
            delete updatedFields.environments
        }
    }

    if(Object.keys(updatedFields).length === 0) {
        return { error, changedOutside, version: savedVersion }
    }

    await db.workspaces.update(workspaceId, updatedFields)
    return { error, changedOutside, version: savedVersion }
}

export async function deleteWorkspace(workspaceId: string) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            await callWebStandaloneAPI('db/deleteWorkspace', { workspaceId })
        } catch (e) {
            console.warn('Fallback deleteWorkspace to Dexie:', e)
        }
    }
    await db.workspaces.delete(workspaceId)
}

// Collections

export async function getAllCollectionIdsForGivenWorkspace(workspaceId: string): Promise<string[]> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const res = await callWebStandaloneAPI('db/getCollectionForWorkspace', { workspaceId, type: null })
            if (Array.isArray(res?.collection)) {
                return res.collection.map((c: any) => c._id)
            }
        } catch (e) {
            console.warn('Fallback getAllCollectionIdsForGivenWorkspace to Dexie:', e)
        }
    }
    return db.collections.where({ workspaceId }).primaryKeys() as Promise<string[]>
}

export async function getCollectionForWorkspace(workspaceId: string, type = null, watch = false): Promise<{ error: string | null, collection: CollectionItem[], workspace: FileWorkspace | null, idMap: Map<string, string> | null, versions?: Record<string, string>, environmentVersions?: Record<string, string> }> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const result = await callWebStandaloneAPI('db/getCollectionForWorkspace', { workspaceId, type })
            if (result && Array.isArray(result.collection)) {
                if (type === null) {
                    for(const collectionItem of result.collection) {
                        deserializeRequestFiles(collectionItem)
                    }
                }
                return result
            }
        } catch (e) {
            console.warn('Fallback getCollectionForWorkspace to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            const result = await fileIPC.getCollectionForWorkspace(workspace, type, watch)

            if (Array.isArray(result.idMap)) {
                result.idMap = new Map(result.idMap)
            }

            if (type === null) {
                for(const collectionItem of result.collection) {
                    deserializeRequestFiles(collectionItem)
                }
            }

            return result
        }
    }

    const where: any = {
        workspaceId
    }

    if(type) {
        where._type = type
    }

    return {
        error: null,
        // @ts-expect-error toArray does work on where, not sure why typescript is complaining
        collection: await db.collections.where(where).toArray(),
        workspace: null,
        idMap: null,
    }
}

export async function getCollectionById(workspaceId: string, collectionId: string): Promise<CollectionItem> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const item = await callWebStandaloneAPI('db/getCollectionById', { collectionId })
            if (item) {
                deserializeRequestFiles(item)
                return item
            }
        } catch (e) {
            console.warn('Fallback getCollectionById to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            return fileIPC.getCollectionById(workspace, collectionId)
        }
    }

    return db.collections.where({ ':id': collectionId }).first()
}

interface CreateCollectionResult {
    error: string | null,
    oldCollectionId: string | null,
    newCollectionId: string | null,
    environmentsError?: string | null
    environmentsVersion?: string
    version?: string
}

export interface UpdateCollectionResult {
    error: string | null
    changedOutside?: boolean
    version?: string
    versionBefore?: string | null
    notOAuth2?: boolean
}

export async function createCollection(workspaceId: string, collection: CollectionItem): Promise<CreateCollectionResult> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const colClone = structuredClone(collection)
            await serializeRequestFiles(colClone)
            return await callWebStandaloneAPI('db/createCollection', { collection: colClone })
        } catch (e) {
            console.warn('Fallback createCollection to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            return fileIPC.createCollection(workspace, collection)
        }
    }

    await db.collections.put(collection)

    return {
        error: null,
        oldCollectionId: null,
        newCollectionId: null,
    }
}

export async function createCollections(workspaceId: string, collections: CollectionItem[]): Promise<{
    error: string | null,
    results: CreateCollectionResult[]
}> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const collectionsClone = structuredClone(collections)
            await Promise.all(collectionsClone.map(col => serializeRequestFiles(col)))
            return await callWebStandaloneAPI('db/createCollections', { collections: collectionsClone })
        } catch (e) {
            console.warn('Fallback createCollections to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            const collectionsClone = structuredClone(collections)
            await Promise.all(collectionsClone.map(collection => serializeRequestFiles(collection)))
            return fileIPC.createCollections(workspace, collectionsClone)
        }
    }

    await db.collections.bulkPut(collections)

    return {
        error: null,
        results: []
    }
}

async function transformFileToFileObject(file: File): Promise<FileObject> {
    try {
        return { name: file.name, type: file.type, buffer: await file.arrayBuffer() }
    } catch {
        return { name: file.name, type: file.type, buffer: new ArrayBuffer(0), bufferOmitted: true }
    }
}

function transformFileObjectToFile(file: FileObject): File | null {
    if(file.bufferOmitted) {
        return null
    }
    const buffer = Array.isArray(file.buffer) ? new Uint8Array(file.buffer as number[]) : file.buffer
    return new File([buffer], file.name, { type: file.type })
}

async function serializeRequestFiles(collection: Partial<CollectionItem>) {
    if(collection.body && collection.body.fileName && collection.body.fileName instanceof File) {
        collection.body.fileName = await transformFileToFileObject(collection.body.fileName)
    }

    if(collection.body && collection.body.params) {
        for(const param of collection.body.params) {
            if(param.files) {
                param.files = (param.files as any[]).filter(file => file instanceof File)
                param.files = await Promise.all(param.files.map(async file => await transformFileToFileObject(file as File)))
            }
        }
    }
}

function deserializeRequestFiles(collection: Partial<CollectionItem>) {
    if(collection.body && collection.body.fileName && 'buffer' in collection.body.fileName && (collection.body.fileName.buffer instanceof Uint8Array || Array.isArray(collection.body.fileName.buffer))) {
        collection.body.fileName = transformFileObjectToFile(collection.body.fileName) ?? undefined
    }

    if(collection.body && collection.body.params) {
        for(const param of collection.body.params) {
            if(param.files) {
                param.files = param.files.map(file => transformFileObjectToFile(file as FileObject)).filter(Boolean) as File[]
            }
        }
    }
}

async function serializeRequestResponseFiles(response: RequestFinalResponse) {
    if(response.request?.body instanceof File) {
        response.request.body = await transformFileToFileObject(response.request.body)
    }

    if(response.request?.original?.body) {
        if(response.request.original.body.fileName && response.request.original.body.fileName instanceof File) {
            response.request.original.body.fileName = await transformFileToFileObject(response.request.original.body.fileName)
        }

        if(response.request.original.body.params) {
            for(const param of response.request.original.body.params) {
                if(param.files) {
                    param.files = (param.files as any[]).filter(file => file instanceof File)
                    param.files = await Promise.all(param.files.map(file => transformFileToFileObject(file as File)))
                }
            }
        }
    }
}

function deserializeRequestResponseFiles(response: RequestFinalResponse) {
    if(Array.isArray(response.buffer)) {
        response.buffer = new Uint8Array(response.buffer as unknown as number[]).buffer
    }

    if(response.request?.body && (response.request.body.buffer instanceof Uint8Array || Array.isArray(response.request.body.buffer))) {
        response.request.body = transformFileObjectToFile(response.request.body) ?? undefined
    }

    if(response.request?.original?.body) {
        if(response.request.original.body.fileName && 'buffer' in response.request.original.body.fileName && (response.request.original.body.fileName.buffer instanceof Uint8Array || Array.isArray(response.request.original.body.fileName.buffer))) {
            response.request.original.body.fileName = transformFileObjectToFile(response.request.original.body.fileName) ?? undefined
        }

        if(response.request.original.body.params) {
            for(const param of response.request.original.body.params) {
                if(param.files) {
                    param.files = param.files.map(file => transformFileObjectToFile(file as FileObject)).filter(Boolean) as File[]
                }
            }
        }
    }
}

export async function updateCollection(workspaceId: string, collectionId: string, updatedFields: Partial<CollectionItem>, version?: string | null, onSending?: () => void): Promise<UpdateCollectionResult> {
    if (import.meta.env.MODE === 'web-standalone') {
        const fieldsClone = structuredClone(updatedFields)
        await serializeRequestFiles(fieldsClone)
        onSending?.()
        try {
            return await callWebStandaloneAPI('db/updateCollection', { collectionId, updatedFields: fieldsClone })
        } catch (e) {
            console.warn('Fallback updateCollection to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            await serializeRequestFiles(updatedFields)
            const sending = fileIPC.updateCollection(workspace, collectionId, updatedFields, version)
            onSending?.()
            return (await sending) ?? { error: null }
        }
    }

    const updating = db.collections.update(collectionId, updatedFields)
    onSending?.()
    await updating

    return {
        error: null,
    }
}

export async function saveOAuthTokens(workspaceId: string, collectionId: string, oauthTokens: OAuthTokens, onSending?: () => void): Promise<UpdateCollectionResult> {
    if (import.meta.env.MODE === 'web-standalone') {
        onSending?.()
        return updateCollection(workspaceId, collectionId, { authentication: { type: 'oauth2', oauth2: oauthTokens } } as any)
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            const sending = fileIPC.updateCollection(workspace, collectionId, { oauthTokens }, undefined)
            onSending?.()
            return sending
        }
    }

    const saving = db.transaction('rw', db.collections, async(): Promise<UpdateCollectionResult> => {
        const item: CollectionItem | undefined = await db.collections.get(collectionId)
        if(item === undefined) {
            return { error: `Not saved, as ${collectionId} was not found`, changedOutside: true }
        }
        if(item.authentication?.type !== 'oauth2') {
            return { error: null, notOAuth2: true }
        }
        const authentication = { ...item.authentication }
        setOAuthTokens(authentication, oauthTokens)
        await db.collections.put({ ...item, authentication })
        return { error: null }
    })
    onSending?.()
    return saving
}

export async function modifyCollections(workspaceId: string) {
    if (import.meta.env.MODE === 'web-standalone') {
        return
    }
    await db.collections.toCollection().modify({ workspaceId })
}

export async function deleteCollectionsByWorkspaceId(workspaceId: string) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            await callWebStandaloneAPI('db/deleteCollectionsByWorkspaceId', { workspaceId })
        } catch (e) {
            console.warn('Fallback deleteCollectionsByWorkspaceId to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            return fileIPC.deleteCollectionsByWorkspaceId(workspace)
        }
    }

    await db.collections.where({ workspaceId }).delete()
}

export async function deleteCollectionsByIds(workspaceId: string, collectionIds: string[]): Promise<{ error: string | null }> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/deleteCollectionsByIds', { collectionIds })
        } catch (e) {
            console.warn('Fallback deleteCollectionsByIds to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            return fileIPC.deleteCollectionsByIds(workspace, collectionIds)
        }
    }

    await db.collections.where(':id').anyOf(collectionIds).delete()

    return {
        error: null,
    }
}

// Responses

export async function getResponsesByCollectionId(workspaceId: string, collectionId: string): Promise<RequestFinalResponse[]> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const responses = await callWebStandaloneAPI('db/getResponsesByCollectionId', { collectionId })
            if (Array.isArray(responses)) {
                for(const response of responses) {
                    deserializeRequestResponseFiles(response)
                }
                return responses
            }
        } catch (e) {
            console.warn('Fallback getResponsesByCollectionId to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            const responses = await fileIPC.getResponsesByCollectionId(workspace, collectionId)
            for(const response of responses) {
                deserializeRequestResponseFiles(response)
            }
            return responses
        }
    }

    return db.responses.where({ collectionId }).reverse().sortBy('createdAt')
}

export async function createResponse(workspaceId: string, response: RequestFinalResponse) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const respClone = structuredClone(response)
            await serializeRequestResponseFiles(respClone)
            return await callWebStandaloneAPI('db/createResponse', { response: respClone })
        } catch (e) {
            console.warn('Fallback createResponse to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            await serializeRequestResponseFiles(response)
            return fileIPC.createResponse(workspace, response)
        }
    }

    await db.responses.put(response)
}

export async function updateResponse(workspaceId: string, collectionId: string, responseId: string, updatedFields: Partial<RequestFinalResponse>) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/updateResponse', { responseId, updatedFields })
        } catch (e) {
            console.warn('Fallback updateResponse to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            return fileIPC.updateResponse(workspace, collectionId, responseId, updatedFields)
        }
    }

    await db.responses.update(responseId, updatedFields)
}

export async function deleteResponse(workspaceId: string, collectionId: string, responseId: string) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/deleteResponse', { responseId })
        } catch (e) {
            console.warn('Fallback deleteResponse to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            return fileIPC.deleteResponse(workspace, collectionId, responseId)
        }
    }

    await db.responses.where({ _id: responseId }).delete()
}

export async function deleteResponsesByIds(workspaceId: string, collectionId: string, responseIds: string[]) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/deleteResponsesByIds', { responseIds })
        } catch (e) {
            console.warn('Fallback deleteResponsesByIds to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            return fileIPC.deleteResponsesByIds(workspace, collectionId, responseIds)
        }
    }

    await db.responses.where(':id').anyOf(responseIds).delete()
}

export async function deleteResponsesByCollectionIds(workspaceId: string, collectionIds: string[]) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/deleteResponsesByCollectionIds', { collectionIds })
        } catch (e) {
            console.warn('Fallback deleteResponsesByCollectionIds to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            return fileIPC.deleteResponsesByCollectionIds(workspace, collectionIds)
        }
    }

    await db.responses.where('collectionId').anyOf(collectionIds).delete()
}

export async function deleteResponsesByCollectionId(workspaceId: string, collectionId: string) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/deleteResponsesByCollectionId', { collectionId })
        } catch (e) {
            console.warn('Fallback deleteResponsesByCollectionId to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if(workspace && workspace._type === 'file') {
            return fileIPC.deleteResponsesByCollectionId(workspace, collectionId)
        }
    }

    await db.responses.where({ collectionId }).delete()
}

// Plugins

export async function getGlobalPlugins() {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const plugins = await callWebStandaloneAPI('db/getGlobalPlugins', {})
            if (Array.isArray(plugins)) return plugins
        } catch (e) {
            console.warn('Fallback getGlobalPlugins to Dexie:', e)
        }
    }
    const allPlugins = await db.plugins.toArray()
    return allPlugins.filter(plugin => plugin.workspaceId == null && plugin.collectionId == null)
}

export function withoutDuplicateLeftovers(plugins: Plugin[], workspaceId: string) {
    const isMistagged = (plugin: Plugin) => !!plugin.workspaceId && plugin.workspaceId !== workspaceId
    const isOlder = (other: Plugin, plugin: Plugin) => other.createdAt < plugin.createdAt || (other.createdAt === plugin.createdAt && other._id < plugin._id)
    return plugins.filter(plugin => {
        if(!isMistagged(plugin)) {
            return true
        }
        const isLeftover = plugins.some(other =>
            other !== plugin
            && other.collectionId === plugin.collectionId
            && other.type === plugin.type
            && other.name === plugin.name
            && (!isMistagged(other) || isOlder(other, plugin))
        )
        return !isLeftover
    })
}

export async function getWorkspacePlugins(workspaceId: string) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            const plugins = await callWebStandaloneAPI('db/getWorkspacePlugins', { workspaceId })
            if (Array.isArray(plugins)) return plugins
        } catch (e) {
            console.warn('Fallback getWorkspacePlugins to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace && workspace._type === 'file') {
            return fileIPC.getWorkspacePlugins(workspace)
        }
    }

    const workspacePlugins = await db.plugins.where({ workspaceId }).toArray()
    const collectionIds = await getAllCollectionIdsForGivenWorkspace(workspaceId)
    const collectionItemPlugins = await db.plugins.where('collectionId').anyOf(collectionIds).toArray()

    return [
        ...workspacePlugins.filter(plugin => plugin.collectionId === null),
        ...withoutDuplicateLeftovers(collectionItemPlugins, workspaceId)
    ]
}

export async function createPlugin(plugin: Plugin, workspaceId: string | null = null) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/createPlugin', { plugin })
        } catch (e) {
            console.warn('Fallback createPlugin to Dexie:', e)
        }
    }

    if(fileIPC && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace && workspace._type === 'file') {
            return fileIPC.createPlugin(workspace, plugin)
        }
    }

    await db.plugins.put(plugin)
}

export async function updatePlugin(pluginId: string, updatedFields: Partial<Plugin>, workspaceId: string | null = null, collectionId: string | null = null, expectedCode?: unknown): Promise<{ error?: string | null, changedOutside?: boolean } | undefined> {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/updatePlugin', { pluginId, updatedFields })
        } catch (e) {
            console.warn('Fallback updatePlugin to Dexie:', e)
        }
    }

    if(fileIPC && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace && workspace._type === 'file') {
            return fileIPC.updatePlugin(workspace, collectionId, pluginId, updatedFields, expectedCode)
        }
    }

    await db.plugins.update(pluginId, updatedFields)
}

export async function deletePlugin(pluginId: string, workspaceId: string | null = null, collectionId: string | null = null) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/deletePlugin', { pluginId })
        } catch (e) {
            console.warn('Fallback deletePlugin to Dexie:', e)
        }
    }

    if(fileIPC && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace && workspace._type === 'file') {
            return fileIPC.deletePlugin(workspace, collectionId, pluginId)
        }
    }

    await db.plugins.where({ _id: pluginId }).delete()
}

export async function deletePluginsByWorkspace(workspaceId: string) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            await callWebStandaloneAPI('db/deletePluginsByWorkspace', { workspaceId })
        } catch (e) {
            console.warn('Fallback deletePluginsByWorkspace to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace && workspace._type === 'file') {
            return fileIPC.deletePluginsByWorkspace(workspace)
        }
    }

    await db.plugins.where({ workspaceId }).filter(plugin => plugin.collectionId == null).delete()
}

export async function deletePluginsByCollectionIds(workspaceId: string, collectionIds: string[]) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            await callWebStandaloneAPI('db/deletePluginsByCollectionIds', { collectionIds })
        } catch (e) {
            console.warn('Fallback deletePluginsByCollectionIds to Dexie:', e)
        }
    }

    if(fileIPC) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace && workspace._type === 'file') {
            return fileIPC.deletePluginsByCollectionIds(workspace, collectionIds)
        }
    }

    await db.plugins.where('collectionId').anyOf(collectionIds).delete()
}

export async function createPlugins(plugins: Plugin[], workspaceId: string | null = null) {
    if (import.meta.env.MODE === 'web-standalone') {
        try {
            return await callWebStandaloneAPI('db/createPlugins', { plugins })
        } catch (e) {
            console.warn('Fallback createPlugins to Dexie:', e)
        }
    }

    if(fileIPC && workspaceId !== null) {
        const workspace = await db.workspaces.get(workspaceId)
        if (workspace && workspace._type === 'file') {
            return fileIPC.createPlugins(workspace, plugins)
        }
    }

    await db.plugins.bulkPut(plugins)
}
