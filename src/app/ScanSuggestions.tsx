import { authored, scanFailureMessage } from '../i18n/authored';
import { projectedCatalogText } from '../i18n/catalog';
import { useT, useLanguage } from '../i18n';
import { useState } from 'react';
import type { ScanSuggestion, ScanSuggestionLayer, SuggestionCatalog } from '../lib/scan-suggestions';
import type { ScanAsset } from '../lib/scan-model';
import { isSuggested, suggestionAnchor, suggestionId, suggestionScore, suggestionScoreText, validateSuggestionScene } from '../lib/scan-suggestions';

interface Props {
  asset: ScanAsset; layer: ScanSuggestionLayer; catalog: SuggestionCatalog; viewerReady: boolean; canAddPin: boolean;
  onShow: (item: ScanSuggestion) => void; onPin: (item: ScanSuggestion) => void;
  onDismiss: (item: ScanSuggestion, dismissed: boolean) => void;
}
export function ScanSuggestions({ asset, layer, catalog, viewerReady, canAddPin, onShow, onPin, onDismiss }: Props) {
  const t = useT(), language = useLanguage();
  const [showDismissed, setShowDismissed] = useState(false);
  const scene = validateSuggestionScene(layer.data, asset);
  if (!scene.ok) return <p role="alert" className="error-message">{scanFailureMessage(t, { code: scene.code, message: scene.error })}</p>;
  const active = layer.data.items.filter((item) => !layer.dismissed.includes(suggestionId(item)));
  const suggested = active.filter(isSuggested).sort((a, b) => (suggestionScore(b) ?? -1) - (suggestionScore(a) ?? -1));
  const below = active.filter((item) => 'status' in item && item.status === 'below-threshold');
  const notVisible = active.filter((item) => 'status' in item && item.status === 'not-visible');
  const older = active.filter((item) => !('status' in item) && !item.suggested);
  const dismissed = layer.data.items.filter((item) => layer.dismissed.includes(suggestionId(item)));

  const emptyMessage = active.length === 0
    ? (dismissed.length ? t("legacy.scansuggestions.1") : t("legacy.scansuggestions.2"))
    : notVisible.length === active.length ? t("legacy.scansuggestions.3")
    : older.length === active.length ? t("legacy.scansuggestions.4")
    : below.length === active.length ? t("legacy.scansuggestions.5")
    : t("legacy.scansuggestions.6");

  function entry(item: ScanSuggestion, isDismissed = false) {
    const id = suggestionId(item), pinned = layer.pinned.includes(id);
    const photo = catalog.get(item.checklistItemId);
    const question = projectedCatalogText(t, photo?.question ?? item.question);
    const localization = 'localization' in item ? item.localization : null;
    const located = Boolean(item.position) && localization?.status !== 'photo-only';
    const reason = !located ? t("legacy.scansuggestions.7") : !viewerReady ? t("legacy.scansuggestions.8") : '';
    return <li key={id} id={suggestionAnchor(item)} tabIndex={-1} className="scan-suggestion">
      <h5>{question}{language === 'es' ? ` ${t('check.originalQuestion')}` : null}</h5>
      <p className="small-text">{authored(t, photo?.limitation ?? '')}</p>
      <p className="small-text">{t("legacy.scansuggestions.9")}{projectedCatalogText(t, photo?.checklistPrompt ?? '')}</p>
      <p><strong>{language === 'en' ? suggestionScoreText(item, layer.data) : suggestionScore(item) === null ? t('scan.noScore') : 'calibration' in layer.data && layer.data.calibration ? t('scan.calibrated', { score: suggestionScore(item)?.toFixed(2), count: layer.data.calibration.trainExamples }) : t('scan.score', { score: suggestionScore(item)?.toFixed(2) })}</strong> · {item.framesAboveThreshold}{t("legacy.catalogviews.12")}{layer.data.scan.framesAnalyzed}{t("legacy.scansuggestions.10")}</p>
      {!('status' in item) && !item.suggested ? <p>{t("legacy.scansuggestions.11")}</p> : null}
      <p className="small-text">{t("legacy.scansuggestions.12")}{pinned ? t("legacy.scansuggestions.13") : ''}</p>
      <p className="small-text">{localization ? <>{t(`scan.localization.${localization.status}`)} {t(`scan.localization.reason.${localization.reason}`)}</> : t('scan.localization.unrecorded')}</p>
      {item.thumbnail ? <img className="scan-suggestion-thumbnail" src={item.thumbnail} alt={t("legacy.scansuggestions.14", { v0: question })} loading="lazy" decoding="async" /> : <p className="small-text">{t("legacy.scansuggestions.15")}</p>}
      {reason ? <p className="small-text" id={`${suggestionAnchor(item)}-reason`}>{reason}</p> : null}
      {isDismissed ? <button className="secondary" onClick={() => onDismiss(item, false)} aria-label={t("legacy.scansuggestions.16", { v0: question })}>{t("legacy.scansuggestions.17")}</button>
        : <div className="button-row">
          {located ? <><button className="secondary" disabled={Boolean(reason)} aria-describedby={reason ? `${suggestionAnchor(item)}-reason` : undefined} onClick={() => onShow(item)} aria-label={t("legacy.scansuggestions.18", { v0: question })}>{t("legacy.scansuggestions.19")}</button>
          <button className="secondary" disabled={!isSuggested(item) || !viewerReady || pinned || !canAddPin} onClick={() => onPin(item)} aria-label={t("legacy.scansuggestions.20", { v0: question })}>{pinned ? t("legacy.scansuggestions.21") : t("legacy.scansuggestions.22")}</button></> : null}
          <button className="secondary" onClick={() => onDismiss(item, true)} aria-label={t("legacy.scansuggestions.23", { v0: question })}>{t("legacy.scansuggestions.24")}</button>
        </div>}
      {!canAddPin && !pinned && !isDismissed ? <p className="small-text">{t("legacy.scansuggestions.25")}</p> : null}
    </li>;
  }
  return <section className="scan-suggestions" aria-labelledby="scan-suggestions-heading">
    <h4 id="scan-suggestions-heading">{t("legacy.scansuggestions.26")}</h4>
    <p>{t("legacy.scansuggestions.27")}</p>
    <p className="small-text">{t("legacy.scansuggestions.28")}{layer.data.model.name}{t("legacy.scansuggestions.29")}{layer.data.model.license}</p>
    <p className="small-text">{t("scan.notice")}</p>
    {layer.droppedItems > 0 ? <p className="notice" role="status">{layer.droppedItems}{t("legacy.scansuggestions.30")}</p> : null}
    <h5>{t("legacy.scansuggestions.31")}</h5>
    {suggested.length ? <ul className="scan-suggestion-list">{suggested.map((item) => entry(item))}</ul> : <p className="small-text">{emptyMessage}{t("legacy.scansuggestions.32")}</p>}
    {below.length ? <details className="scan-suggestion-details"><summary>{t("legacy.scansuggestions.33")}{below.length})</summary><ul className="scan-suggestion-list">{below.map((item) => entry(item))}</ul></details> : null}
    {notVisible.length ? <details className="scan-suggestion-details"><summary>{t("legacy.scansuggestions.34")}{notVisible.length})</summary><p className="small-text">{t("legacy.scansuggestions.35")}</p><ul className="scan-suggestion-list">{notVisible.map((item) => entry(item))}</ul></details> : null}
    {older.length ? <details className="scan-suggestion-details"><summary>{t("legacy.scansuggestions.36")}{older.length})</summary><ul className="scan-suggestion-list">{older.map((item) => entry(item))}</ul></details> : null}
    {dismissed.length ? <><button className="secondary" aria-expanded={showDismissed} aria-controls="scan-dismissed-suggestions" onClick={() => setShowDismissed((value) => !value)}>{showDismissed ? t("legacy.scansuggestions.37") : t("legacy.scansuggestions.38")} ({dismissed.length})</button>
      {showDismissed ? <ul id="scan-dismissed-suggestions" className="scan-suggestion-list">{dismissed.map((item) => entry(item, true))}</ul> : null}</> : null}
  </section>;
}

export function ScanSuggestionChip({ item }: { item: ScanSuggestion }) {
  const t = useT();
  return <a className="scan-suggestion-chip" href={`#${suggestionAnchor(item)}`} onClick={() => {
    const target = document.getElementById(suggestionAnchor(item));
    const details = target?.closest('details');
    if (details) details.open = true;
    target?.focus({ preventScroll: true });
  }}>{t("legacy.scansuggestions.39")}{suggestionScore(item)?.toFixed(2)}</a>;
}
