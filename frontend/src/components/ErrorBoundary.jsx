import { Component } from 'react';

// If any screen crashes while rendering, React would otherwise unmount EVERYTHING and leave a blank
// page. This catches that and shows what happened, with a way to recover.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('SlotBook crashed while rendering:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page page--narrow" role="alert">
        <div className="card">
          <h1>Something broke</h1>
          <p className="lede">This is a bug in the app, not something you did. Reloading usually fixes it.</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', color: 'var(--danger)' }}>
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
