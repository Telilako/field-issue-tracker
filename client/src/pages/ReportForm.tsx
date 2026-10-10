import { useEffect, useState } from 'react';
import { CATEGORIES, PRIORITIES, type FieldError } from '@fit/shared';
import {
  createDraft,
  getLocalReport,
  ReportServiceError,
  submitReport,
  updateDraft,
  type DraftFields,
} from '../reportService';
import { CATEGORY_LABELS, PRIORITY_LABELS } from '../labels';

interface Props {
  reportId?: string; // set when editing an existing draft
  onDone: () => void;
  onCancel: () => void;
}

export function ReportForm({ reportId, onDone, onCancel }: Props) {
  const [id, setId] = useState<string | undefined>(reportId);
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [description, setDescription] = useState('');
  const [locationText, setLocationText] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Load an existing draft into the form.
  useEffect(() => {
    if (!reportId) return;
    getLocalReport(reportId).then((r) => {
      if (!r || r.workflowStatus !== 'Draft') return onCancel();
      setCategory(r.category);
      setPriority(r.priority);
      setDescription(r.description);
      setLocationText(r.locationText ?? '');
      if (r.latitude !== undefined && r.longitude !== undefined) setCoords({ lat: r.latitude, lng: r.longitude });
    });
  }, [reportId, onCancel]);

  const errorFor = (...fields: string[]) => errors.find((e) => fields.includes(e.field))?.message;

  function currentFields(): DraftFields {
    return {
      category,
      priority,
      description,
      locationText: locationText.trim() || undefined,
      latitude: coords?.lat,
      longitude: coords?.lng,
    };
  }

  // Every save goes to the device first.
  async function persist(): Promise<string> {
    if (id) {
      await updateDraft(id, currentFields());
      return id;
    }
    const draft = await createDraft(currentFields());
    setId(draft.id);
    return draft.id;
  }

  async function handleSaveDraft() {
    setBusy(true);
    setErrors([]);
    try {
      await persist();
      onDone();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save the draft.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    setBusy(true);
    setErrors([]);
    setMessage('');
    try {
      const savedId = await persist();
      await submitReport(savedId);
      onDone();
    } catch (e) {
      if (e instanceof ReportServiceError && e.code === 'VALIDATION_FAILED') {
        setErrors(e.errors ?? []);
        setMessage('Saved as a draft. Fix the highlighted fields to submit it.');
      } else {
        setMessage(e instanceof Error ? e.message : 'Could not submit the report.');
      }
    } finally {
      setBusy(false);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setMessage('GPS is not available on this device. Describe the location instead.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setMessage('');
      },
      () => setMessage('Could not get your GPS position. Describe the location instead.'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <section className="form">
      <h2>{reportId ? 'Edit draft' : 'New report'}</h2>

      <label>
        Category
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose...</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
        {errorFor('category') && <span className="error-text">{errorFor('category')}</span>}
      </label>

      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Choose...</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
        {errorFor('priority') && <span className="error-text">{errorFor('priority')}</span>}
      </label>

      <label>
        What is the problem?
        <textarea
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what you see, at least 10 characters"
        />
        {errorFor('description') && <span className="error-text">{errorFor('description')}</span>}
      </label>

      <label>
        Where is it?
        <input
          value={locationText}
          onChange={(e) => setLocationText(e.target.value)}
          placeholder="Village, landmark or address"
        />
      </label>
      <div className="gps">
        <button type="button" className="secondary" onClick={useMyLocation}>Use my GPS</button>
        {coords && (
          <span className="muted">
            {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}{' '}
            <button type="button" className="link" onClick={() => setCoords(null)}>Clear</button>
          </span>
        )}
      </div>
      {errorFor('locationText', 'latitude', 'longitude') && (
        <span className="error-text">{errorFor('locationText', 'latitude', 'longitude')}</span>
      )}

      {message && <p className="notice">{message}</p>}

      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="secondary" onClick={handleSaveDraft} disabled={busy}>Save draft</button>
        <button type="button" onClick={handleSubmit} disabled={busy}>Submit</button>
      </div>
    </section>
  );
}