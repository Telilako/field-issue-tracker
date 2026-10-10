import type { Identity } from '../api';

const USERS: Record<Identity['role'], string> = {
  'field-worker': 'amara',
  coordinator: 'daniel',
};

export function Header({ identity, onChange }: { identity: Identity; onChange: (i: Identity) => void }) {
  return (
    <header className="header">
      <h1>Field Issue Tracker</h1>
      <label>
        Role
        <select
          value={identity.role}
          onChange={(e) => {
            const role = e.target.value as Identity['role'];
            onChange({ role, user: USERS[role] });
          }}
        >
          <option value="field-worker">Field worker</option>
          <option value="coordinator">Coordinator</option>
        </select>
      </label>
    </header>
  );
}