import { auth, db } from './firebase-config.js';
import { 
    collection, 
    query, 
    where, 
    orderBy, 
    getDocs, 
    doc, 
    updateDoc, 
    onSnapshot,
    limit,
    startAfter
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

class InboxManager {
    constructor() {
        this.currentFilter = 'pending';  // Changed from 'all' to 'pending'
        this.invitations = [];
        this.sentInvitations = []; 
        this.unsubscribe = null;
        this.sentUnsubscribe = null;
        this.pageSize = 20;
        this.lastDoc = null;
        this.hasMore = true;
        this.init();
    }
    
    async init() {
        auth.onAuthStateChanged((user) => {
            if (user) {
                this.loadInvitations(user.uid);
                this.setupEventListeners();
            } else {
                window.location.href = './login.html';
            }
        });
    }
    
    setupEventListeners() {
        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentFilter = btn.dataset.filter;
                this.renderInvitations();
            });
        });
    }
    
    loadInvitations(userId) {
        // Existing query for received invitations
        const invitationsRef = collection(db, 'gameInvitations');
        let q = query(
            invitationsRef,
            where('toUserId', '==', userId),
            orderBy('createdAt', 'desc'),
            limit(this.pageSize)
        );
        
        this.unsubscribe = onSnapshot(q, (snapshot) => {
            this.invitations = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            
            this.renderInvitations();
            this.updateNotificationCount();
        });
        
        // Add query for sent invitations
        let sentQ = query(
            invitationsRef,
            where('fromUserId', '==', userId),
            orderBy('createdAt', 'desc'),
            limit(this.pageSize)
        );
        
        this.sentUnsubscribe = onSnapshot(sentQ, (snapshot) => {
            this.sentInvitations = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                isSent: true // Flag to identify sent invitations
            }));
            
            this.renderInvitations();
        });
    }
    
    renderInvitations() {
        const container = document.getElementById('inbox-content');
        if (!container) return;
        
        // Filter invitations based on current filter
        let filteredInvitations = [];
        
        if (this.currentFilter === 'outbox') {
            filteredInvitations = this.sentInvitations;
        } else if (this.currentFilter === 'all') {
            // Show both received and sent invitations
            filteredInvitations = [...this.invitations, ...this.sentInvitations]
                .sort((a, b) => {
                    const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt);
                    const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt);
                    return dateB - dateA;
                });
        } else {
            // Filter received invitations by status
            filteredInvitations = this.invitations.filter(inv => inv.status === this.currentFilter);
        }
        
        if (filteredInvitations.length === 0) {
            const filterText = this.currentFilter === 'outbox' ? 'sent' : 
                             this.currentFilter === 'all' ? '' : this.currentFilter;
            container.innerHTML = `
                <div class="empty-inbox">
                    <i class="fas fa-inbox"></i>
                    <h3>No ${filterText} invitations</h3>
                    <p>${this.currentFilter === 'outbox' ? 
                        'Invitations you send to other players will appear here.' : 
                        'When other players invite you to games, they\'ll appear here.'}</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = filteredInvitations.map(invitation => this.createInvitationCard(invitation)).join('');
        
        // Add event listeners to action buttons
        this.setupActionListeners();
    }
    
    createInvitationCard(invitation) {
        const createdAt = invitation.createdAt?.toDate ? 
            invitation.createdAt.toDate() : 
            new Date(invitation.createdAt);
        
        const timeAgo = this.getTimeAgo(createdAt);
        const isSent = invitation.isSent || false;
        
        // Handle different invitation types
        let invitationContent = '';
        
        if (invitation.type === 'team_invite') {
            // Team invitation specific content
            invitationContent = `
                <div class="invitation-details">
                    <p>${invitation.message}</p>
                    <div class="team-invite-preview" style="background: #1a1a1a; padding: 1rem; border-radius: 4px; margin: 0.5rem 0;">
                        <h4 style="color: ${invitation.teamData.teamColor}; margin: 0 0 0.5rem 0;">
                            ${invitation.teamData.proposedTeamName}
                        </h4>
                        <p style="color: #888; font-size: 0.9em; margin: 0;">
                            Duos Ladder Team • Color: ${invitation.teamData.teamColor}
                        </p>
                    </div>
                </div>
            `;
        } else {
            // Game invitation content
            invitationContent = `
                <div class="invitation-details">
                    <p>${invitation.message}</p>
                </div>
            `;
        }
        
        return `
            <div class="invitation-card ${invitation.status} ${isSent ? 'sent-invitation' : ''}" data-invitation-id="${invitation.id}">
                <div class="invitation-header">
                    <div>
                        <div class="invitation-from">
                            ${isSent ? `To: ${invitation.toUsername}` : invitation.fromUsername}
                            ${isSent ? '<span class="sent-indicator"><i class="fas fa-paper-plane"></i> Sent</span>' : ''}
                        </div>
                        <div class="invitation-time">${timeAgo}</div>
                    </div>
                    <span class="status-badge status-${invitation.status}">${invitation.status}</span>
                </div>
                
                ${invitationContent}
                
                ${!isSent && invitation.status === 'pending' ? `
                    <div class="invitation-actions">
                        <button class="action-btn accept-btn" data-action="accept" data-invitation-id="${invitation.id}">
                            <i class="fas fa-check"></i> Accept
                        </button>
                        <button class="action-btn decline-btn" data-action="decline" data-invitation-id="${invitation.id}">
                            <i class="fas fa-times"></i> Decline
                        </button>
                        ${invitation.type !== 'team_invite' ? `
                            <button class="action-btn respond-btn" data-action="respond" data-invitation-id="${invitation.id}">
                                <i class="fas fa-reply"></i> Send Message
                            </button>
                        ` : ''}
                    </div>
                ` : ''}
                
                ${isSent && invitation.status === 'pending' ? `
                    <div class="invitation-actions">
                        <button class="action-btn cancel-btn" data-action="cancel" data-invitation-id="${invitation.id}">
                            <i class="fas fa-times"></i> Cancel Invitation
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    setupActionListeners() {
        document.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const action = btn.dataset.action;
                const invitationId = btn.dataset.invitationId;
                
                btn.disabled = true;
                const originalText = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                
                try {
                    switch (action) {
                        case 'accept':
                            await this.updateInvitationStatus(invitationId, 'accepted');
                            break;
                        case 'decline':
                            await this.updateInvitationStatus(invitationId, 'declined');
                            break;
                        case 'cancel':
                            await this.updateInvitationStatus(invitationId, 'cancelled');
                            break;
                        case 'respond':
                            this.openResponseModal(invitationId);
                            break;
                    }
                } catch (error) {
                    console.error(`Error performing ${action}:`, error);
                    alert(`Failed to ${action} invitation. Please try again.`);
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            });
        });
    }
    
    async updateInvitationStatus(invitationId, status) {
        try {
            const invitation = this.invitations.find(inv => inv.id === invitationId);
            
            if (invitation && invitation.type === 'team_invite' && status === 'accepted') {
                // Handle team creation
                await this.createTeamFromInvitation(invitation);
            }
            
            const invitationRef = doc(db, 'gameInvitations', invitationId);
            
            await updateDoc(invitationRef, {
                status: status,
                respondedAt: new Date()
            });
            
            // Update local cache immediately for better UX
            if (invitation) {
                invitation.status = status;
                invitation.respondedAt = new Date();
                this.renderInvitations();
            }
        } catch (error) {
            console.error('Error updating invitation status:', error);
            throw error;
        }
    }
    
    openResponseModal(invitationId) {
        // Find the invitation
        const invitation = this.invitations.find(inv => inv.id === invitationId);
        if (!invitation) return;
        
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Send Message to ${invitation.fromUsername}</h3>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <p>Regarding invitation to: <strong>${invitation.value}</strong></p>
                    <textarea id="response-message" placeholder="Type your message here..." rows="4"></textarea>
                </div>
                <div class="modal-footer">
                    <button class="action-btn respond-btn" id="send-response">Send Message</button>
                    <button class="action-btn" id="cancel-response">Cancel</button>
                </div>
            </div>
        `;
        
        // Add modal styles
        if (!document.getElementById('modal-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'modal-styles';
            styleEl.textContent = `
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.8);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }
                
                .modal-content {
                    background: #2a2a2a;
                    border-radius: 8px;
                    width: 90%;
                    max-width: 500px;
                    max-height: 90vh;
                    overflow-y: auto;
                }
                
                .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 1rem;
                    border-bottom: 1px solid #444;
                }
                
                .modal-close {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 1.5rem;
                    cursor: pointer;
                }
                
                .modal-body {
                    padding: 1rem;
                }
                
                .modal-body textarea {
                    width: 100%;
                    padding: 0.5rem;
                    background: #1a1a1a;
                    border: 1px solid #444;
                    color: white;
                    border-radius: 4px;
                    resize: vertical;
                    margin-top: 0.5rem;
                }
                
                .modal-footer {
                    display: flex;
                    gap: 0.5rem;
                    padding: 1rem;
                    border-top: 1px solid #444;
                }
            `;
            document.head.appendChild(styleEl);
        }
        
        document.body.appendChild(modal);
        
        // Modal event listeners
        modal.querySelector('.modal-close').addEventListener('click', () => modal.remove());
        modal.querySelector('#cancel-response').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        modal.querySelector('#send-response').addEventListener('click', () => {
            const message = document.getElementById('response-message').value.trim();
            if (message) {
                // Here you could implement a messaging system
                // For now, just show success and close modal
                alert('Message sent! (Feature will be fully implemented in future update)');
                modal.remove();
            }
        });
    }
    
    async createTeamFromInvitation(invitation) {
        try {
            // Import the team creation function
            const { createTeam } = await import('./ladderduos.js');
            
            const result = await createTeam(
                invitation.fromUsername, 
                invitation.toUsername, 
                invitation.teamData.proposedTeamName,
                invitation.teamData.teamColor
            );
            
            if (!result.success) {
                throw new Error(result.error);
            }
            
            // Show success message
            alert(`Team "${invitation.teamData.proposedTeamName}" created successfully!`);
            
        } catch (error) {
            console.error('Error creating team:', error);
            throw new Error('Failed to create team: ' + error.message);
        }
    }
    
    updateNotificationCount() {
        const pendingCount = this.invitations.filter(inv => inv.status === 'pending').length;
        const notificationDot = document.getElementById('inbox-notification');
        
        if (notificationDot) {
            if (pendingCount > 0) {
                notificationDot.style.display = 'inline-block';
                notificationDot.textContent = pendingCount > 9 ? '9+' : pendingCount;
            } else {
                notificationDot.style.display = 'none';
            }
        }
    }
    
    getTimeAgo(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString();
    }
    
    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
        }
        if (this.sentUnsubscribe) {
            this.sentUnsubscribe();
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new InboxManager();
});