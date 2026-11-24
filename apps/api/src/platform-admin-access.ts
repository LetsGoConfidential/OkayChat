export function isPlatformAdminEmail(email: string) {
  const configured = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  return configured.includes(email.trim().toLowerCase());
}
