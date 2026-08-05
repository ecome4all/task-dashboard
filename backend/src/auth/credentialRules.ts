// The rules for what counts as a usable email and password, in one place:
// an admin setting someone's login and that person later changing their own
// password have to agree on them, or a password accepted by one screen gets
// rejected by the other.

export const MIN_PASSWORD_LENGTH = 8;

// Deliberately loose. The only thing worth catching here is a typo obvious
// enough to lock somebody out of an account nobody can reset for them (there
// is no password-reset email in this app) — a missing @, a stray space, a
// name typed into the email box. Anything stricter starts rejecting addresses
// that genuinely work.
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Returns what's wrong with a password in words the person can act on, or
// null if it's fine. Length is the only rule: complexity rules push people
// towards "Passw0rd!" and towards writing it on a sticky note, and this team
// is small enough that an admin hands the first password over in person.
export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `The password must be at least ${MIN_PASSWORD_LENGTH} letters or numbers long.`;
  }
  if (password.trim() !== password) {
    return "The password can't start or end with a space.";
  }
  return null;
}
