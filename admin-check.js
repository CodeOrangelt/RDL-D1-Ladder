import { ADMIN_EMAILS } from './adminbackend.js';

export function isAdmin(email) {
    return ADMIN_EMAILS.includes(email);
}