# neuPrint notes (MaleCNS)

This MVP does **not** call neuPrint. These snippets are a starting point for a future “real neuPrint” hook (`TODO`).

**Verify every type name in the explorer** before you treat it as a MaleCNS fact. Names that are solid in hemibrain / MANC / BANC are not automatically identical here.

## Server and dataset

- Server: `https://neuprint.janelia.org`
- Dataset: `male-cns:v1.0`
- Token: create an account on the site, then copy your API token.
- Docs: [neuprint-python](https://connectome-neuprint.github.io/neuprint-python/docs/quickstart.html)
- Download notes: [male-cns.janelia.org/download](https://male-cns.janelia.org/download/)

## Python client

```python
# pip install neuprint-python
from neuprint import Client, fetch_neurons, NeuronCriteria as NC

client = Client(
    "https://neuprint.janelia.org",
    dataset="male-cns:v1.0",
    token=token,  # from the neuPrint account page
)
client.fetch_version()
```

## Example: type DNa02

DNa02 is a published descending type (turning / walking literature). Whether MaleCNS uses exactly the string `DNa02` is **verify-in-explorer**.

```python
# Convenience API
neurons, roi = fetch_neurons(NC(type="DNa02"))
print(neurons[["bodyId", "type", "instance", "pre", "post"]])

# Regex if the type is decorated (e.g. suffixes)
neurons_rx, _ = fetch_neurons(NC(type="DNa02.*", regex=True))
```

```cypher
// Custom Cypher via client.fetch_custom(q)
MATCH (n:Neuron)
WHERE n.type = 'DNa02' OR n.type =~ 'DNa02.*'
RETURN n.bodyId AS bodyId, n.type AS type, n.instance AS instance,
       n.pre AS pre, n.post AS post
ORDER BY n.pre + n.post DESC
LIMIT 50
```

## Descending-neuron superclass

The field that means “this is a DN” may be `type`, `instance`, `superclass`, or a cell-class tag. **Verify-in-explorer.** Do not assume hemibrain conventions.

```python
# Try a few honest probes; keep the ones that return rows.
for q in ("DN.*", "DNa.*", "DNg.*", "DNp.*"):
    df, _ = fetch_neurons(NC(type=q, regex=True))
    print(q, len(df), df["type"].nunique() if len(df) else 0)
```

```cypher
MATCH (n:Neuron)
WHERE n.type STARTS WITH 'DN' OR n.instance =~ '(?i).*descending.*'
   OR coalesce(n.superclass, '') =~ '(?i).*descending.*'
RETURN n.type AS type, count(*) AS n
ORDER BY n DESC
LIMIT 80
```

## Giant Fiber / GF

Often **GF** or **DNp01** in other datasets. MaleCNS spelling is **verify-in-explorer**.

```python
gf, _ = fetch_neurons(NC(type="Giant Fiber|GF|DNp01|DNp01.*", regex=True))
print(gf[["bodyId", "type", "instance"]])
```

```cypher
MATCH (n:Neuron)
WHERE n.type IN ['Giant Fiber', 'GF', 'DNp01']
   OR n.type =~ '(?i).*(giant.?fiber|DNp01).*'
   OR n.instance =~ '(?i).*(giant.?fiber|\\bGF\\b).*'
RETURN n.bodyId AS bodyId, n.type AS type, n.instance AS instance
LIMIT 20
```

## Photoreceptors (R1–R8)

Expect type strings like `R1-6`, `R1`, `R8`, or optic-lobe photoreceptor classes. **Verify-in-explorer.** Our visualizer does not fetch these.

```python
pr, _ = fetch_neurons(NC(type="^R[1-8]", regex=True))
print(pr["type"].value_counts().head(20))
```

```cypher
MATCH (n:Neuron)
WHERE n.type =~ 'R[1-8].*' OR n.type =~ '(?i).*photoreceptor.*'
RETURN n.type AS type, count(*) AS n
ORDER BY n DESC
LIMIT 40
```

## T4 / T5

Optic-lobe ON/OFF motion detectors. Direction subtypes exist in other datasets (`T4a`…, `T5a`…). **Verify-in-explorer.** In this app they are only a `TODO` (kick gag), not a query result.

```python
t45, _ = fetch_neurons(NC(type="T4.*|T5.*", regex=True))
print(t45["type"].value_counts())
```

```cypher
MATCH (n:Neuron)
WHERE n.type =~ 'T[45].*'
RETURN n.type AS type, count(*) AS n
ORDER BY type
```

## Connectivity sketch (once types check out)

```python
from neuprint import fetch_adjacencies

# Example only — replace with a bodyId you actually fetched.
out_edges, info = fetch_adjacencies("DNa02")
in_edges, info2 = fetch_adjacencies(None, "DNa02")
```

```cypher
MATCH (a:Neuron)-[c:ConnectsTo]->(b:Neuron)
WHERE a.type STARTS WITH 'DNa02'
RETURN a.bodyId, a.type, b.bodyId, b.type, c.weight
ORDER BY c.weight DESC
LIMIT 25
```

## How this repo would use a real fetch

1. Confirm type strings above in the explorer.
2. Store `bodyId`s, not nicknames.
3. Do **not** rename our LIF toys to `DNa02` just because a query returned rows. The stub is still a stub. The honest UI line is: *proxy, unless wired to these bodyIds.*
