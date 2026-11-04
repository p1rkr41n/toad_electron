import React from 'react';
import ReactDOM from 'react-dom/client';

// Global BigInt serialization polyfill for Arrow / DuckDB query payload serialization
if (typeof BigInt !== 'undefined' && !(BigInt.prototype as any).toJSON) {
  (BigInt.prototype as any).toJSON = function () {
    const num = Number(this);
    return Number.isSafeInteger(num) ? num : this.toString();
  };
}

const App: React.FC = () => {
  return (
    <div
      className="toad-root"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        color: '#f1f5f9',
        background: '#0f172a',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <header
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #334155',
          fontWeight: 600,
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>Toad Data Analyzer</span>
      </header>
      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 500 }}>
            Toad Desktop (Tauri v2)
          </h2>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px' }}>
            High-Performance Native Forensics Engine & DuckDB 1.0 Runtime
          </p>
        </div>
      </main>
    </div>
  );
};

const container = document.getElementById('app') || document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

export default App;
