/**
 * Leaky integrate-and-fire stub.
 * Euler step: tau dV/dt = -(V - Vrest) + I
 * This is a classroom neuron, not a reconstructed MaleCNS cell.
 */

export class LIFNeuron {
  constructor({
    name,
    tau = 0.025,
    vRest = 0,
    vReset = 0,
    vTh = 1,
    refractory = 0.004,
    rateWindow = 0.25,
  }) {
    this.name = name;
    this.tau = tau;
    this.vRest = vRest;
    this.vReset = vReset;
    this.vTh = vTh;
    this.refractory = refractory;
    this.rateWindow = rateWindow;
    this.v = vRest;
    this.lastSpike = -Infinity;
    this.spikes = [];
    this.rate = 0;
    this.fired = false;
  }

  step(I, dt, t) {
    this.fired = false;
    if (t - this.lastSpike < this.refractory) {
      this.v = this.vReset;
      return false;
    }
    this.v += (dt * (-(this.v - this.vRest) + I)) / this.tau;
    if (this.v >= this.vTh) {
      this.v = this.vReset;
      this.lastSpike = t;
      this.spikes.push(t);
      this.fired = true;
    }
    const cutoff = t - this.rateWindow;
    if (this.spikes.length && this.spikes[0] < cutoff) {
      this.spikes = this.spikes.filter((s) => s >= cutoff);
    }
    this.rate = this.spikes.length / this.rateWindow;
    return this.fired;
  }
}
