import { useState } from 'react';
import type { ScanSuggestion, ScanSuggestionLayer, SuggestionCatalog } from '../lib/scan-suggestions';
import { suggestionAnchor, suggestionId, suggestionPercent } from '../lib/scan-suggestions';

interface Props {
  layer: ScanSuggestionLayer; catalog: SuggestionCatalog; viewerReady: boolean; canAddPin: boolean;
  onShow: (item: ScanSuggestion) => void; onPin: (item: ScanSuggestion) => void;
  onDismiss: (item: ScanSuggestion, dismissed: boolean) => void;
}
export function ScanSuggestions({ layer, catalog, viewerReady, canAddPin, onShow, onPin, onDismiss }: Props) {
  const [showDismissed, setShowDismissed] = useState(false);
  const active = layer.data.items.filter((item) => !layer.dismissed.includes(suggestionId(item)));
  const suggested = active.filter((item) => item.suggested).sort((a, b) => b.maxProbability - a.maxProbability);
  const lower = active.filter((item) => !item.suggested).sort((a, b) => b.maxProbability - a.maxProbability);
  const dismissed = layer.data.items.filter((item) => layer.dismissed.includes(suggestionId(item)));

  function entry(item: ScanSuggestion, isDismissed = false) {
    const id = suggestionId(item), pinned = layer.pinned.includes(id);
    const question = catalog.get(item.checklistItemId)?.question ?? item.question;
    const reason = !item.position ? 'No 3D location was provided by the model.' : !viewerReady ? 'Open the viewer and wait for the room to load to show this location.' : '';
    return <li key={id} id={suggestionAnchor(item)} tabIndex={-1} className="scan-suggestion">
      <h5>{question}</h5>
      <p><strong>Model estimate: {suggestionPercent(item)}% likely</strong> · {item.framesAboveThreshold} of {layer.data.scan.framesAnalyzed} frames above threshold</p>
      <p className="small-text">An unverified model estimate; review the area yourself. {pinned ? 'Added as a family-placed pin. This does not confirm the concern.' : ''}</p>
      {item.thumbnail ? <img className="scan-suggestion-thumbnail" src={item.thumbnail} alt={`Frame the local AI model looked at when suggesting review: ${question}`} loading="lazy" decoding="async" /> : <p className="small-text">No evidence thumbnail was provided.</p>}
      {reason ? <p className="small-text" id={`${suggestionAnchor(item)}-reason`}>{reason}</p> : null}
      {isDismissed ? <button className="secondary" onClick={() => onDismiss(item, false)} aria-label={`Restore suggestion: ${question}`}>Restore suggestion</button>
        : <div className="button-row">
          <button className="secondary" disabled={Boolean(reason)} aria-describedby={reason ? `${suggestionAnchor(item)}-reason` : undefined} onClick={() => onShow(item)} aria-label={`Show in 3D: ${question}`}>Show in 3D</button>
          <button className="secondary" disabled={!item.position || pinned || !canAddPin} onClick={() => onPin(item)} aria-label={`Add as pin: ${question}`}>{pinned ? 'Added as pin' : 'Add as pin'}</button>
          <button className="secondary" onClick={() => onDismiss(item, true)} aria-label={`Dismiss suggestion: ${question}`}>Dismiss</button>
        </div>}
      {!canAddPin && !pinned && !isDismissed ? <p className="small-text">The room pin limit has been reached. Remove a pin before adding another.</p> : null}
    </li>;
  }
  return <section className="scan-suggestions" aria-labelledby="scan-suggestions-heading">
    <h4 id="scan-suggestions-heading">Model suggestions</h4>
    <p>Suggested by a local AI model (StartLux-Decision). Areas to review — not findings. They never answer or confirm the checklist.</p>
    <p className="small-text">Model: {layer.data.model.name} · MLX · License: {layer.data.model.license}</p>
    <p className="small-text">{layer.data.notice}</p>
    {layer.droppedItems > 0 ? <p className="notice" role="status">{layer.droppedItems} model suggestion(s) were dropped because their checklist/concern links are unknown or no longer match the catalog.</p> : null}
    {suggested.length ? <ul className="scan-suggestion-list">{suggested.map((item) => entry(item))}</ul> : <p className="small-text">No active items exceeded the model’s suggestion threshold. This does not certify safety.</p>}
    {lower.length ? <details className="scan-suggestion-details"><summary>Lower-probability items ({lower.length})</summary><ul className="scan-suggestion-list">{lower.map((item) => entry(item))}</ul></details> : null}
    {dismissed.length ? <><button className="secondary" aria-expanded={showDismissed} aria-controls="scan-dismissed-suggestions" onClick={() => setShowDismissed((value) => !value)}>{showDismissed ? 'Hide dismissed' : 'Show dismissed'} ({dismissed.length})</button>
      {showDismissed ? <ul id="scan-dismissed-suggestions" className="scan-suggestion-list">{dismissed.map((item) => entry(item, true))}</ul> : null}</> : null}
  </section>;
}

export function ScanSuggestionChip({ item }: { item: ScanSuggestion }) {
  return <a className="scan-suggestion-chip" href={`#${suggestionAnchor(item)}`} onClick={() => {
    const target = document.getElementById(suggestionAnchor(item));
    const details = target?.closest('details');
    if (details) details.open = true;
    target?.focus({ preventScroll: true });
  }}>AI suggests reviewing · {suggestionPercent(item)}%</a>;
}
