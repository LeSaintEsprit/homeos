import { describe, expect, it } from 'vitest';
import { alertBadgeCount, moveWidget, resolveDashboard, toggleWidget, DASHBOARD_WIDGETS, newId, type Alert } from '@homeos/shared';
import { Harness } from './helpers';

describe('tableau de bord personnalisable', () => {
  it('ordre par défaut, identifiants inconnus ignorés, nouveaux widgets ajoutés', () => {
    const def = resolveDashboard(undefined);
    expect(def.order).toEqual(DASHBOARD_WIDGETS.map((w) => w.id));
    expect(def.visible).toEqual(def.order);
    const r = resolveDashboard({ order: ['liste', 'ancien-widget', 'prevoir', 'liste'], hidden: ['depenses', 'inconnu'] });
    expect(r.order.slice(0, 2)).toEqual(['liste', 'prevoir']);
    expect(r.order).toHaveLength(DASHBOARD_WIDGETS.length);
    expect(r.hidden).toEqual(['depenses']);
    expect(r.visible).not.toContain('depenses');
  });
  it('déplacer et masquer produisent des préférences complètes', () => {
    let p = moveWidget(undefined, 'liste', -1);
    expect(p.order.slice(0, 3)).toEqual(['prevoir', 'liste', 'indicateurs']);
    p = moveWidget(p, 'prevoir', -1); // déjà en tête : inchangé
    expect(p.order[0]).toBe('prevoir');
    p = toggleWidget(p, 'mouvements', false);
    expect(resolveDashboard(p).visible).not.toContain('mouvements');
    p = toggleWidget(p, 'mouvements', true);
    expect(resolveDashboard(p).visible).toContain('mouvements');
  });
  it('préférences enregistrées par membre et réaffichage des alertes masquées', () => {
    const h = new Harness();
    h.ok('member.updateSelf', { prefs: { dashboard: toggleWidget(undefined, 'depenses', false), dismissed: { 'stock_low:x:2026-11-02': '2026-11-02' } } });
    const alice = h.store.list('member', { userId: 'user-alice' })[0];
    expect(alice.prefs.dashboard!.hidden).toEqual(['depenses']);
    expect(Object.keys(alice.prefs.dismissed!)).toHaveLength(1);
    expect(h.store.list('member', { userId: 'user-bob' })[0].prefs.dashboard).toBeUndefined();
    h.ok('member.updateSelf', { prefs: { clearDismissed: true } });
    expect(h.store.list('member', { userId: 'user-alice' })[0].prefs.dismissed).toEqual({});
    expect(h.store.list('member', { userId: 'user-alice' })[0].prefs.dashboard!.hidden).toEqual(['depenses']);
  });
});

describe('pastille des notifications', () => {
  const a = (kind: Alert['kind'], severity: Alert['severity'], at = '2026-11-10T10:00:00.000Z'): Alert => ({ key: newId(), kind, severity, title: '', body: '', at });
  it('compte les alertes importantes et les modifications non lues des autres membres', () => {
    const alerts = [a('stock_out', 'critical'), a('expiring', 'warning'), a('inventory_check', 'info'), a('important_change', 'info', '2026-11-10T09:00:00.000Z'), a('important_change', 'info', '2026-11-10T11:00:00.000Z')];
    expect(alertBadgeCount(alerts, undefined)).toBe(4);
    expect(alertBadgeCount(alerts, '2026-11-10T10:00:00.000Z')).toBe(3);
    expect(alertBadgeCount([], undefined)).toBe(0);
  });
});
