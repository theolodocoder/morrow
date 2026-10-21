/**
 * Copies of documents kept on this device (IndexedDB), so words written offline survive the tab closing.
 * One store per user and document: two accounts on one device never share a copy.
 */
const PREFIX = 'morrow:doc:'
// Fallback for browsers without indexedDB.databases(): the stores this device created.
const INDEX = 'morrow:doc-stores'

export const deviceCopyName = (userId: string, documentId: string) => `${PREFIX}${userId}:${documentId}`

function readIndex(): string[] {
  try {
    const names: unknown = JSON.parse(localStorage.getItem(INDEX) ?? '[]')
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

function writeIndex(names: string[]) {
  try {
    localStorage.setItem(INDEX, JSON.stringify(names))
  } catch {
    // storage unavailable: indexedDB.databases() still finds the stores where it exists
  }
}

export function rememberDeviceCopy(name: string) {
  const names = readIndex()
  if (!names.includes(name)) writeIndex([...names, name])
}

const deleteStore = (name: string) =>
  new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    // "blocked": an open tab still holds it; the delete goes ahead once that tab lets go.
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })

/** On sign-out: forget this user's documents on this device. Never throws, never waits more than a second. */
export async function clearDeviceCopies(userId: string) {
  const prefix = `${PREFIX}${userId}:`
  try {
    const listed = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
    const names = new Set(
      [...listed.map((d) => d.name ?? ''), ...readIndex()].filter((n) => n.startsWith(prefix)),
    )
    writeIndex(readIndex().filter((n) => !n.startsWith(prefix)))
    await Promise.race([
      Promise.all([...names].map(deleteStore)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ])
  } catch {
    // IndexedDB unavailable: there is nothing on this device to clear
  }
}
