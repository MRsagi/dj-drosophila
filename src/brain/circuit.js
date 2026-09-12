/**
 * Toy circuit: DN-L, DN-R, Giant Fiber / escape proxy, plus mean rate.
 *
 * Labels are honest:
 *   DN-L / DN-R — proxies for DNa02 L/R *or* simple eye-asymmetry. We do not
 *   claim these LIF units are DNa02. DNa02 is a real descending type involved
 *   in walking/turning (literature); this stub is not that cell.
 *   Giant Fiber — escape-circuit proxy. In other datasets GF ≈ DNp01.
 *   Verify names in neuPrint explorer before quoting them as MaleCNS types.
 */

import { LIFNeuron } from './lif.js';

export function createCircuit() {
  const dnL = new LIFNeuron({
    name: 'DN-L',
    tau: 0.028,
    vTh: 1,
    refractory: 0.005,
    rateWindow: 0.28,
  });
  const dnR = new LIFNeuron({
    name: 'DN-R',
    tau: 0.028,
    vTh: 1,
    refractory: 0.005,
    rateWindow: 0.28,
  });
  const gf = new LIFNeuron({
    name: 'Giant Fiber (escape proxy)',
    tau: 0.012,
    vTh: 1.15,
    refractory: 0.35,
    rateWindow: 1.2,
  });

  const history = {
    dnL: new Float32Array(180),
    dnR: new Float32Array(180),
    gf: new Float32Array(180),
    i: 0,
  };

  let t = 0;

  function step(dt, currents) {
    t += dt;
    dnL.step(currents.dnL, dt, t);
    dnR.step(currents.dnR, dt, t);
    gf.step(currents.gf, dt, t);

    if (history.i % 2 === 0) {
      const k = (history.i / 2) % history.dnL.length;
      history.dnL[k] = dnL.v;
      history.dnR[k] = dnR.v;
      history.gf[k] = gf.v;
    }
    history.i += 1;

    return {
      t,
      dnL,
      dnR,
      gf,
      meanRate: 0.5 * (dnL.rate + dnR.rate),
      gfFired: gf.fired,
    };
  }

  return { dnL, dnR, gf, history, step, get t() { return t; } };
}
