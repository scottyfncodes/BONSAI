import { Component, type ReactNode } from 'react';

/**
 * Last line of defence: if a screen throws while rendering, say so plainly
 * instead of leaving a blank page. Saves are written as the player works, so
 * reloading brings the collection back.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app">
        <main className="screen">
          <div className="empty" role="alert" style={{ paddingTop: 120 }}>
            <h2>The studio stumbled</h2>
            <p>Something went wrong on this screen. Your trees are saved on this device – reloading brings them back.</p>
            <button className="btn primary" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </main>
      </div>
    );
  }
}
