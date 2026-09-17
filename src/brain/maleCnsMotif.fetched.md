# MaleCNS motif freeze

- dataset: `male-cns:v1.0`
- fetchedAt: 2026-09-17T08:26:43Z
- cells: 4
- edges: 2
- misses: none
- roles: {'dnR': 10360, 'dnL': 523769, 'gf': 10001}

Identified bodies in this slice:

| role | type | instance | bodyId |
|------|------|----------|--------|
| dnR | DNa02 | DNa02_R | 10360 |
| dnL | DNa02 | DNa02_L | 523769 |
| gf | DNp01 | DNp01(GF)_R | 10001 |
| other | DNp01 | DNp01(GF)_L | 10010 |

**No DNa02 intra-motif synapses.** neuPrint returned no DNa02↔DNa02 or DNa02↔GF edges among these four cells. The only edges are GF_R↔GF_L (`10001`↔`10010`) at weight 1 each. Server leaky-rate **currents** from the show clock drive DNa02; those GF edges do not. Do not invent DNa02 synapses that this freeze did not return.
