import { useEffect, useState } from 'react';
import { getIdentity, setIdentity, type Identity, type ServerReport } from './api';
import { startSyncEngine } from './syncEngine';
import { refreshLocalStatuses } from './serverCache';
import { useSyncCounts } from './hooks/useReports';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { Banner } from './components/Banner';
import { Header } from './components/Header';
import { ReportList } from './pages/ReportList';
import { ReportForm } from './pages/ReportForm';
import { ReportDetails } from './pages/ReportDetails';
import { CoordinatorList } from './pages/CordinatorList';

type View =
  | { name: 'list' }
  | { name: 'form'; reportId?: string }
  | { name: 'details'; id: string; initial?: ServerReport };

export default function App() {
  const [identity, setIdentityState] = useState<Identity>(getIdentity);
  const [view, setView] = useState<View>({ name: 'list' });
  const online = useOnlineStatus();
  const counts = useSyncCounts();

  // After every sync run, also pull newer statuses from the server onto this device.
  useEffect(() => startSyncEngine(() => void refreshLocalStatuses()), []);

  function changeIdentity(next: Identity) {
    setIdentity(next);
    setIdentityState(next);
    setView({ name: 'list' });
  }

  const goList = () => setView({ name: 'list' });

  return (
    <div className="app">
      <Header identity={identity} onChange={changeIdentity} />
      <Banner online={online} counts={counts} />
      <main>
        {view.name === 'form' ? (
          <ReportForm reportId={view.reportId} onDone={goList} onCancel={goList} />
        ) : view.name === 'details' ? (
          <ReportDetails
            key={view.id}
            id={view.id}
            initial={view.initial}
            identity={identity}
            online={online}
            onBack={goList}
          />
        ) : identity.role === 'coordinator' ? (
          <CoordinatorList online={online} onOpen={(r) => setView({ name: 'details', id: r.id, initial: r })} />
        ) : (
          <ReportList
            onNew={() => setView({ name: 'form' })}
            onOpenDraft={(id) => setView({ name: 'form', reportId: id })}
            onOpenReport={(id) => setView({ name: 'details', id })}
          />
        )}
      </main>
    </div>
  );
}