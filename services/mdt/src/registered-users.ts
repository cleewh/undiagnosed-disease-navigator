// services/mdt/src/registered-users.ts
//
// Registered-user resolution for the MDT_Service (Requirement 12).
//
// Mentions must resolve to a registered user (Req 12.2), tasks must be assigned
// to exactly one registered user (Req 12.4), and votes/decisions are cast by
// registered participants (Req 12.5, 12.6). The service does not own the user
// directory, so callers supply the notion of "registered" as a resolver: a pure
// predicate `(userId) => boolean`.
//
// A convenience factory builds a resolver from any iterable of user ids (e.g. a
// snapshot of the registered-user set), giving callers a set-based option while
// the service depends only on the predicate.

/**
 * A pure predicate deciding whether a user id belongs to a registered user.
 * Supplied by the caller (the authoritative user directory).
 */
export type RegisteredUserResolver = (userId: string) => boolean;

/**
 * Build a {@link RegisteredUserResolver} from a set of registered user ids.
 *
 * The ids are captured into an immutable `Set` at construction time, so the
 * resulting resolver is deterministic and independent of later mutation of the
 * source iterable.
 */
export function registeredUserResolver(
  userIds: Iterable<string>
): RegisteredUserResolver {
  const registered = new Set<string>(userIds);
  return (userId: string): boolean => registered.has(userId);
}
