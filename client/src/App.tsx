import { useEffect, useState } from 'react';
import { getIdentity, setIdentity, type Identity } from './api';
import { startSyncEngine } from './syncEngine';
import { createDraft, submitReport } from './reportService';
import { useLocalReports, useSyncCounts } from './hooks/useReports';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { Banner } from './components/Banner';
import { Header } from './components/Header';

export default function App() {
  const [identity, setIdentityState] = useState<Identity>(getIdentity);
  const online = useOnlineStatus();
  const reports = useLocalReports();
  const counts = useSyncCounts();

  // Starts the sync engine when the app opens, and stops it when the app closes.
  useEffect(() => startSyncEngine(), []);

  function changeIdentity(next: Identity) {
    setIdentity(next);
    setIdentityState(next);
  }

  // TEMPORARY: lets you test the banner and syncing. Removed in the next commit.
  async function addSample() {
    const draft = await createDraft({
      category: 'water_point',
      priority: 'high',
      description: `Sample report made at ${new Date().toLocaleTimeString()}`,
      locationText: 'Kebele 04',
    });
    await submitReport(draft.id);
  }

  return (
    <div className="app">
      <Header identity={identity} onChange={changeIdentity} />
      <Banner online={online} counts={counts} />
      <main>
        <button onClick={addSample}>Add sample report (temporary)</button>
        <ul className="temp-list">
          {reports.map((r) => (
            <li key={r.id}>
              {r.description} - {r.workflowStatus} - {r.syncState}
              {r.lastError ? ` (${r.lastError})` : ''}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}