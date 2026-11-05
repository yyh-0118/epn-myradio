import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import EmbeddedApp from './host/EmbeddedApp';
import './styles.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Afterglow render error', error, info.componentStack); }
  render() {
    if (this.state.failed) return <main className="fatal-error"><h1>这页暂时没能打开。</h1><p>已经保存的本地笔记不会被删除。请刷新重试。</p><button className="button primary" onClick={() => location.reload()}>重新打开</button></main>;
    return this.props.children;
  }
}

const hostMode = new URLSearchParams(window.location.search).get('host') === 'mineradio';
createRoot(document.getElementById('root')!).render(<ErrorBoundary>{hostMode ? <EmbeddedApp /> : <App />}</ErrorBoundary>);
