/**
 * Redaction helper shared by the incident log and the disk journal.
 *
 * It is deliberately dependency-free (Node built-ins only) so a crashing process
 * can still sanitize a record before persisting it, even when the application
 * module graph — or the database — is the very thing that is failing.
 */
export function sanitizeIncidentText(value: unknown, limit: number): string {
  return String(value ?? "")
    .replace(/\b(?:mysql|mariadb):\/\/[^\s"'<>]+/gi, "[database-url-redacted]")
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, "https://[credentials-redacted]@")
    .replace(/\b(password|passwd|secret|token|authorization|api[_-]?key|credential)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[credential-redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, limit);
}
