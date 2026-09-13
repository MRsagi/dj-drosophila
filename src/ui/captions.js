/**
 * One line gag. One line of fact. Credits live in #story.
 */

export const FAKE_CAPTION = 'I trained a fruit fly to DJ. This is the set.';

export const FINE_PRINT =
  'MaleCNS-named toys + a leave/fade mind on a shared stream. Not a connectome run, not an animal. Data: FlyEM / Janelia, Cambridge, Google Research · CC BY · male-cns:v1.0 · neuprint.janelia.org';

export function mountCaptions(el) {
  if (!el) return;
  el.innerHTML = `
    <p class="fake-caption">“<span>${FAKE_CAPTION}</span>”</p>
    <p class="fine-print">${FINE_PRINT}</p>
  `;
}
