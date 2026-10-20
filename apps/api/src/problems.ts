import { PROBLEM } from '@morrow/contracts'

/** A failure the client should see as RFC 9457 problem details. Anything else becomes a generic 500. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
    readonly title: string,
    readonly detail?: string,
  ) {
    super(title)
  }
}

// Forbidden and missing look identical to callers who cannot read the resource (architecture §11).
export const notFound = () =>
  new HttpProblem(404, PROBLEM.notFound, "This doesn't exist or you don't have access.")
export const forbidden = () =>
  new HttpProblem(403, PROBLEM.forbidden, "You don't have permission to do that.")
export const unauthenticated = () => new HttpProblem(401, PROBLEM.unauthenticated, 'Please sign in.')
export const conflict = (detail: string) =>
  new HttpProblem(409, PROBLEM.conflict, 'That conflicts with the current state.', detail)
export const preconditionFailed = () =>
  new HttpProblem(412, PROBLEM.preconditionFailed, 'This was changed elsewhere. Reload and try again.')
