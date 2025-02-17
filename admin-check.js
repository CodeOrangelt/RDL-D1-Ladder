import { ADMIN_EMAILS } from './admin-config.js';

export function isAdmin(email) {
    return ADMIN_EMAILS.includes(email);
}