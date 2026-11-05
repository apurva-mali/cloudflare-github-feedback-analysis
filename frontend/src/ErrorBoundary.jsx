import { Component } from 'react';

/** Shows what went wrong instead of a blank page if rendering ever fails. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Dashboard crashed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h1>The dashboard hit an error</h1>
        <p>Reloading usually fixes it. If it doesn't, send this message to whoever maintains the dashboard:</p>
        <pre>{String(error?.stack || error).split('\n').slice(0, 4).join('\n')}</pre>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
