# DJ Drosophila

A fruit-fly DJ runs one shared 24/7 radio. Visitors listen; they do not mix.

## Language

**Club**:
The public listening room: shared radio, eyes, fly body, booth readout.
_Avoid_: lab, mixer booth (as a visitor-controlled mix)

**Story**:
The written gag about training a fly to DJ.

**Shared radio**:
One encoder, one timeline, every visitor hears the same set.
_Avoid_: local mix, per-tab mix, private mix

**Crate**:
The CC0 records the fly can play.
_Avoid_: Spotify, playlist (for the mind's log)

**Show log**:
The ordered list of leave times, fade lengths, and next-track picks the fly already committed to.

**Show clock**:
Where we are on that log right now, as a public snapshot (playing vs blending, which edge, which records).
_Avoid_: set engine snapshot, wall clock (alone)

**Leave mind**:
The fly's choice of when to leave a record and how long to blend.
_Avoid_: policy, unsupervised, lab decide

**Blend plan**:
Cue-in, cue-out, and overlap taken from a show-log row so the encoder can crossfade without a hard cut.
_Avoid_: ffmpeg filtergraph, acrossfade

**Club frame**:
One tick of eyes, descending-neuron toys, fly body, and booth readout driven by the shared radio.
_Avoid_: main loop, rAF god object

**Booth FX**:
Filter, echo, loop, and pitch the fly applies on a visitor's local copy of the radio. The encoder stays dry.
_Avoid_: hands, visitor knobs, STREAM FX

**PLAYING**:
One record is the edge; the xfader is parked.

**TRANSITION**:
Two records overlap; the xfader travels to the other edge.

**xfaderEdge**:
Where the blend sits: parked at A or B, or travelling during TRANSITION.
