export function isAdmin(email) {
    const ADMIN_EMAILS = ['admin@ladder.com', 'brian2af@outlook.com'];
    return email && ADMIN_EMAILS.includes(email.toLowerCase());
}