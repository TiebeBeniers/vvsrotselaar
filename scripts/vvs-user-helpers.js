// ===============================================
// VVS-USER-HELPERS.JS
// Gecentraliseerde helpers voor het nieuwe user-schema (v2).
// Importeer dit in elk JS-bestand dat user-data leest/schrijft.
//
// Nieuw schema:
//   users/{uid} → { name, uid, telnr, email, team[], permissions[], registered }
//   users/{uid}/stats (als Firestore map-veld) → { goals, assists, matches, minutes,
//                                                   yellowCard, redCard, motmPoints, motmHistory }
//   users/{uid}/information (als map-veld, enkel extern) → { validFrom, validUntil, wachtwoord }
// ===============================================

// ── Permission helpers ────────────────────────────────────────────────────────

/** Geeft true als de user admin-rechten heeft */
export function isAdmin(u) {
    return (u?.permissions || []).includes('admin');
}

/** Geeft true als de user een gewone speler is */
export function isSpeler(u) {
    return (u?.permissions || []).includes('speler');
}

/** Geeft true als de user een tijdelijk account is */
export function isTijdelijk(u) {
    return (u?.permissions || []).includes('tijdelijk');
}

/** Geeft true als de user een extern account is */
export function isExtern(u) {
    return (u?.permissions || []).includes('extern');
}

/** Controleert of een specifiek recht aanwezig is */
export function hasPermission(u, perm) {
    return (u?.permissions || []).includes(perm);
}

/**
 * Controleert of user afgevaardigde is.
 * @param {object} u - userData
 * @param {string|null} team - optioneel: controleer voor specifiek team
 */
export function isAfgevaardigde(u, team = null) {
    const perms = u?.permissions || [];
    if (team) {
        return perms.includes(`afgevaardigde:${team}`) || perms.includes('afgevaardigde:*');
    }
    return perms.some(p => p === 'afgevaardigde:*' || p.startsWith('afgevaardigde:'));
}

/**
 * Geeft het team van de afgevaardigde terug, of null.
 */
export function getAfgevaardigdeTeam(u) {
    const p = (u?.permissions || []).find(p => p.startsWith('afgevaardigde:'));
    if (!p) return null;
    const t = p.split(':')[1];
    return t === '*' ? null : t;
}

/** Geeft de teams (ploegen) als array */
export function getTeams(u) {
    return Array.isArray(u?.team) ? u.team : [];
}

/** Geeft het primaire team (eerste in array) */
export function getPrimaryTeam(u) {
    return getTeams(u)[0] || null;
}

/** Geeft de display-naam */
export function getDisplayName(u) {
    return u?.name || u?.email || 'Onbekend';
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

/** Lees een stat-veld veilig (0 als ontbrekend) */
export function getStat(u, field) {
    return u?.stats?.[field] ?? 0;
}

/** Geeft een volledig stats-object met defaults */
export function getStats(u) {
    return {
        goals:       u?.stats?.goals       ?? 0,
        assists:     u?.stats?.assists     ?? 0,
        matches:     u?.stats?.matches     ?? 0,
        minutes:     u?.stats?.minutes     ?? 0,
        yellowCard:  u?.stats?.yellowCard  ?? 0,
        redCard:     u?.stats?.redCard     ?? 0,
        motmPoints:  u?.stats?.motmPoints  ?? 0,
        motmHistory: u?.stats?.motmHistory ?? [],
    };
}

/** Geeft een leeg stats-object (voor reset) */
export function emptyStats() {
    return { goals: 0, assists: 0, matches: 0, minutes: 0, yellowCard: 0, redCard: 0, motmPoints: 0, motmHistory: [] };
}

// ── Schrijf-helpers ───────────────────────────────────────────────────────────

/**
 * Bouw een nieuw user-document op vanuit form-data.
 * @param {object} opts
 * @returns {object} Firestore-document voor users/{uid}
 */
export function buildUserDoc({ uid, name, email, telnr = '', teams = [], permissions = [], registered = null }) {
    const doc = {
        uid,
        name,
        email,
        telnr,
        team: teams,
        permissions,
        stats: emptyStats(),
    };
    if (registered) doc.registered = registered;
    return doc;
}

/**
 * Bouw een extern/tijdelijk account-document op.
 */
export function buildExternalUserDoc({ uid, name, email, permissions = [], validFrom, validUntil, wachtwoord = '', note = null }) {
    return {
        uid,
        name,
        email,
        telnr: '',
        team: [],
        permissions,
        stats: emptyStats(),
        information: {
            validFrom,
            validUntil,
            wachtwoord,
        },
        ...(note ? { note } : {}),
    };
}

// ── Label helpers (UI) ────────────────────────────────────────────────────────

/** Leesbaar label voor permissions-array */
export function permissionsLabel(permissions = []) {
    const labels = {
        admin:           'Admin',
        speler:          'Speler',
        tijdelijk:       'Tijdelijk',
        extern:          'Extern',
        score_invullen:  'Score invullen',
        rockwerchter:    'Rock Werchter',
        werken:          'Werklijst',
    };
    return permissions.map(p => {
        if (p.startsWith('afgevaardigde:')) {
            const t = p.split(':')[1];
            return t === '*' ? 'Afgevaardigde' : `Afgevaardigde (${t.charAt(0).toUpperCase() + t.slice(1)})`;
        }
        return labels[p] || p;
    }).join(' + ') || 'Geen rechten';
}

/** Leesbaar label voor teams-array */
export function teamsLabel(teams = []) {
    return teams.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' + ') || '—';
}