import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StateResponseSchema } from '@senselayer/shared';

function App() {
  const [status, setStatus] = useState('Connecting…');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/state', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Server unavailable');
        StateResponseSchema.parse(await response.json());
        setStatus('Server connected.');
      })
      .catch(() => { if (!controller.signal.aborted) setStatus('Server unavailable.'); });
    return () => controller.abort();
  }, []);
  return <main><h1>SenseLayer</h1><p>Accessibility foundation</p><p role="status">{status}</p></main>;
}

createRoot(document.getElementById('root')!).render(<App />);
