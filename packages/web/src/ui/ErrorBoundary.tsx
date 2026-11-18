import { Component, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

/**
 * Filet de sécurité : une erreur d'affichage n'aboutit jamais à un écran blanc.
 * Les données ne sont pas en cause (elles sont enregistrées avant tout affichage).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  override componentDidCatch(error: Error) {
    console.error('Erreur d’affichage', error);
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" role="alert" data-testid="error-boundary">
        <span className="empty-icon"><TriangleAlert size={28} /></span>
        <h3>Cet écran a rencontré un problème</h3>
        <p className="muted">Vos données ne sont pas affectées. Revenez en arrière ou rechargez l'application.</p>
        <button className="btn" onClick={() => location.reload()}><RefreshCw size={16} /> Recharger</button>
      </div>
    );
  }
}
