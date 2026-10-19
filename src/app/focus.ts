export type FocusAction = 'skip-content' | 'help-open' | 'help-close' | 'reset-open' | 'reset-close';
export function focusTarget(action: FocusAction): string {
  return { 'skip-content': 'screen-heading', 'help-open': 'context-help-heading', 'help-close': 'context-help-trigger', 'reset-open': 'reset-cancel', 'reset-close': 'reset-trigger' }[action];
}
export function focusVisible(element: HTMLElement | null): void { element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'center' }); }
export function skipToContent(event: { preventDefault(): void }, root: Pick<Document, 'getElementById'> = document): void {
  event.preventDefault(); focusVisible(root.getElementById(focusTarget('skip-content')));
}
