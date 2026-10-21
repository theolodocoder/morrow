/**
 * Copies of documents kept on this device (IndexedDB), so words written offline survive the tab closing.
 * One store per user and document: two accounts on one device never share a copy.
 */
const PREFIX = 'morrow:doc:'
// Fallback for browsers without indexedDB.databases(): the stores this device created.
const INDEX = 'morrow:doc-stores'
// Documents whose device copy holds changes the server hasn't confirmed: sign-out must not delete them silently.
export const pendingKey = (userId: string) => `morrow:pending:${userId}`

export const deviceCopyName = (userId: string, documentId: string) => `${PREFIX}${userId}:${documentId}`

function readList(key: string): string[] {
  try {
    const names: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

function writeList(key: string, names: string[]) {
  try {
    if (names.length) localStorage.setItem(key, JSON.stringify(names))
    else localStorage.removeItem(key)
  } catch {
    // storage unavailable: indexedDB.databases() still finds the stores where it exists
  }
}

export function rememberDeviceCopy(name: string) {
  const names = readList(INDEX)
  if (!names.includes(name)) writeList(INDEX, [...names, name])
}

export const isPendingWriting = (userId: string, documentId: string) =>
  readList(pendingKey(userId)).includes(documentId)

export const hasPendingWriting = (userId: string) => readList(pendingKey(userId)).length > 0

export function setPendingWriting(userId: string, documentId: string, pending: boolean) {
  const ids = readList(pendingKey(userId)).filter((id) => id !== documentId)
  writeList(pendingKey(userId), pending ? [...ids, documentId] : ids)
}

let works: Promise<boolean> | undefined
/** y-indexeddb leaves a failed open unhandled, so find out first whether this browser lets us use IndexedDB. */
export function deviceStorageWorks() {
  works ??= new Promise<boolean>((resolve) => {
    try {
      const req = indexedDB.open('morrow:probe')
      req.onsuccess = () => {
        req.result.close()
        resolve(true)
      }
      req.onerror = (e) => {
        e.preventDefault()
        resolve(false)
      }
    } catch {
      resolve(false) // no IndexedDB at all, or it's blocked (private mode, site settings)
    }
  })
  return works
}

const deleteStore = (name: string) =>
  new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    // "blocked": an open tab still holds it; the delete goes ahead once that tab lets go.
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })

/** A document this device may no longer keep (a view-only session). */
export async function deleteDeviceCopy(name: string) {
  writeList(
    INDEX,
    readList(INDEX).filter((n) => n !== name),
  )
  try {
    await deleteStore(name)
  } catch {
    // IndexedDB unavailable: nothing to delete
  }
}

/** On sign-out: forget this user's documents on this device. Never throws, never waits more than a second. */
export async function clearDeviceCopies(userId: string) {
  const prefix = `${PREFIX}${userId}:`
  writeList(pendingKey(userId), [])
  try {
    const listed = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
    const names = new Set(
      [...listed.map((d) => d.name ?? ''), ...readList(INDEX)].filter((n) => n.startsWith(prefix)),
    )
    writeList(
      INDEX,
      readList(INDEX).filter((n) => !n.startsWith(prefix)),
    )
    await Promise.race([
      Promise.all([...names].map(deleteStore)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ])
  } catch {
    // IndexedDB unavailable: there is nothing on this device to clear
  }
}
