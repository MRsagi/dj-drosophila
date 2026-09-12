/**
 * Fake paper caption + the actual truth, in that order.
 * Funny, then precise. Do not let the joke eat the caveat.
 */

export const FAKE_CAPTION =
  'Hey, I trained a fruit fly to DJ — this is its set.';

export const FINE_PRINT = `Fine print (please read, even if you came for the eyes): this page is scientific comedy. It is not a connectome analysis and not an upload. “Trained a fruit fly” means MaleCNS-named actuator proxies + our DJ mind / unsupervised policy on a shared live stream — the fruit fly does not understand music, is not conscious here, was not uploaded, and was not animal-trained. Photoreceptor channels, DN-L / DN-R, and the Giant Fiber are labeled proxies / approximations — we do not claim those LIF toys are DNa02, GF/DNp01, or any typed MaleCNS cell. The separate owned DJ policy head (style presets + optional fit from your logs) is user-controlled heuristics — not MaleCNS plasticity, not artist cloning, and not a shipped imitation of any real DJ. Column counts are a visualizer budget (TODO ~1771), not ommatidia. Credit: MaleCNS connectome data from FlyEM / HHMI Janelia, the Cambridge Connectomics Group / MRC LMB, and Google Research, licensed CC BY. Explore the real thing at neuprint.janelia.org (dataset male-cns:v1.0). Do not cut flies for a nightclub.`;

export function mountCaptions(el) {
  el.innerHTML = `
    <p class="fake-caption">“<span>${FAKE_CAPTION}</span>”</p>
    <p class="fine-print">${FINE_PRINT}</p>
  `;
}
