import { useEffect, useState } from 'react';
import { getIdentity, setIdentity, type Identity } from './api';
import { startSyncEngine } from './syncEngine';
import { useSyncCounts } from './hooks/useReports';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { Banner } from './components/Banner';
import { Header } from './components/Header';
import { ReportList } from './pages/ReportList';
import { ReportForm } from './pages/ReportForm';

type View = { name: 'list' } | { name: 'form'; reportId?: string };

export default function App() {
  const [identity, setIdentityState] = useState<Identity>(getIdentity);
  const [view, setView] = useState<View>({ name: 'list' });
  const online = useOnlineStatus();
  const counts = useSyncCounts();

  useEffect(() => startSyncEngine(), []);

  function changeIdentity(next: Identity) {
    setIdentity(next);
    setIdentityState(next);
  }

  return (
    <div className="app">
      <Header identity={identity} onChange={changeIdentity} />
      <Banner online={online} counts={counts} />
               <main>
           {view.name === 'list' ? (
             <ReportList
               onNew={() => setView({ name: 'form' })}
               onOpenDraft={(id) => setView({ name: 'form', reportId: id })}
             />
           ) : (
             <ReportForm
               reportId={view.reportId}
               onDone={() => setView({ name: 'list' })}
               onCancel={() => setView({ name: 'list' })}
             />
           )}
         </main>
    </div>
  );
}