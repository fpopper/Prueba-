#!/usr/bin/env python3
"""Arma ventas.json: el reporte comercial que consulta el asistente.

Toma el export del analisis de ventas (data.json del artifact "Ventas FACBSA"),
se queda con las filas de los clientes que estan en fichas.json, y les agrega
las filas sinteticas del cliente de prueba. Despues recalcula la ficha del
cliente de prueba desde esas mismas filas, para que la ficha y el reporte no
puedan contradecirse.

    python3 construir-ventas.py <ruta a data.json>

Ventanas (las mismas que uso el analisis, verificadas contra EDESUR y DISCUALCO):
    12 meses  = los ultimos 12 del reporte
    trimestre = los ultimos 3 contra los 3 anteriores
"""
import json, sys, unicodedata, re, os

RUTA = sys.argv[1] if len(sys.argv) > 1 else "data.json"

def norm(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]", " ", s.lower())).strip()

D = json.load(open(RUTA, encoding="utf-8"))
F = json.load(open("fichas.json", encoding="utf-8"))

# --- ligar cada ficha con su cliente del reporte ---
porNombre = {}
for i, c in enumerate(D["cli"]):
    porNombre.setdefault(norm(c[0]), i)
destino = {}
for j, f in enumerate(F):
    if f.get("prueba"):
        continue
    i = porNombre.get(norm(f["n"]))
    if i is None:
        cand = [k for k in porNombre if len(norm(f["n"])) >= 10 and k.startswith(norm(f["n"])[:18])]
        i = porNombre[cand[0]] if len(cand) == 1 else None
    if i is None:
        raise SystemExit(f"sin ligar al reporte: {f['n']}")
    destino[i] = j

# --- filas reales ---
artUsados, filas = {}, []
for m, ci, ag, ai, cant, pesos, usd, dia, cb, nro, kil in D["f"]:
    j = destino.get(ci)
    if j is None:
        continue
    if ai not in artUsados:
        artUsados[ai] = len(artUsados)
    filas.append([m, j, artUsados[ai], round(cant, 2), int(pesos), round(usd, 1), dia, cb, nro, round(kil, 1)])
art = [None] * len(artUsados)
for ai, k in artUsados.items():
    art[k] = [D["art"][ai][0], D["art"][ai][1]]

# --- cliente de prueba: filas inventadas, declaradas como tales ---
iPrueba = next((j for j, f in enumerate(F) if f.get("prueba")), None)
if iPrueba is not None:
    mesIdx = {m: i for i, m in enumerate(D["mes"])}
    RUB = D["rub"]
    def nuevoArt(nombre, rubro):
        art.append([nombre, RUB.index(rubro)])
        return len(art) - 1
    JAB = nuevoArt("JABALINA 5/8 x 1,50 IRAM 2309 (PRUEBA)", "JABALINAS IRAM 2309")
    TOM = nuevoArt("TOMACABLE STANDARD 5/8 (PRUEBA)",        "TOMA STANDARD")
    CAB = nuevoArt("CABLE AW 7 HILOS IRAM 2467 (PRUEBA)",     "ALAMBRES AW")
    CON = nuevoArt("CONECTOR BIMETALICO (PRUEBA)",            "CONECTORES")
    PAR = nuevoArt("PARARRAYOS PUNTA SIMPLE (PRUEBA)",        "PARARRAYOS")
    KILOS = {JAB: 4.9, TOM: 0.9, CAB: 0.32, CON: 0.15, PAR: 2.4}
    TC = {"2024-10":1000,"2024-11":1010,"2024-12":1030,"2025-01":1070,"2025-02":1090,
          "2025-03":1105,"2025-04":1120,"2025-05":1160,"2025-06":1215,"2025-07":1270,
          "2025-08":1300,"2025-09":1320,"2025-10":1340,"2025-11":1365,"2025-12":1390,
          "2026-01":1420,"2026-02":1435,"2026-03":1450,"2026-04":1470,"2026-05":1485,
          "2026-06":1498,"2026-07":1510}
    GUION = [
        # (mes, dia, nro, [(articulo, cantidad, pesos)])
        ("2024-10", 15, 990095, [(JAB, 50, 2100000), (TOM, 22,  363000)]),
        ("2024-11",  8, 990096, [(JAB, 40, 1760000), (TOM, 20,  340000)]),
        ("2024-12", 12, 990097, [(CAB, 350, 1470000)]),
        ("2025-01", 22, 990098, [(CAB, 300, 1320000), (CON, 60, 258000)]),
        ("2025-02", 20, 990099, [(JAB, 45, 2070000), (CON, 40, 180000)]),
        # pararrayos solo en la ventana anterior: deja la gondola a los 12 meses
        ("2025-03", 18, 990099.5 and 990113, [(PAR, 12, 1800000)]),
        ("2025-04", 11, 990100, [(JAB, 60, 3000000), (TOM, 25,  475000)]),
        ("2025-05", 28, 990101, [(JAB, 50, 2550000), (TOM, 24,  444000)]),
        ("2025-07", 19, 990102, [(JAB, 55, 2970000), (CAB, 250, 1250000)]),
        ("2025-08", 14, 990103, [(CAB, 280, 1456000), (CON, 35, 175000)]),
        # --- ultimos 12 meses ---
        ("2025-10",  9, 990104, [(JAB, 55, 3190000), (TOM, 25,  550000)]),
        ("2025-11", 20, 990105, [(CAB, 200, 1080000)]),
        ("2025-12", 16, 990106, [(JAB, 35, 2100000), (CON, 30, 240000)]),
        ("2026-02",  5, 990107, [(JAB, 40, 2520000), (TOM, 20,  480000)]),
        ("2026-03", 11, 990108, [(CAB, 150,  885000)]),
        ("2026-04", 21, 990109, [(JAB, 55, 3575000), (CON, 25, 215000)]),
        ("2026-05", 14, 990110, [(TOM, 32,  800000)]),
        ("2026-06",  3, 990111, [(CAB, 180, 1098000)]),
        ("2026-07", 19, 990112, [(JAB, 55, 3740000), (TOM, 18,  477000)]),
    ]
    cbFAC = D["cbte"].index("FAC") if "FAC" in D["cbte"] else 0
    for mes, dia, nro, items in GUION:
        for a, cant, pesos in items:
            filas.append([mesIdx[mes], iPrueba, a, cant, pesos,
                          round(pesos / TC[mes], 1), dia, cbFAC, nro, round(cant * KILOS[a], 1)])

# --- senales propias del canal distribuidor, para todas las fichas ---
# meses: cada cuanto repone.  perd: familias que tenia en gondola y dejo de comprar.
mesL = D["mes"]
w12, wPrev = set(mesL[-12:]), set(mesL[-24:-12])
porCli = {}
for r in filas:
    porCli.setdefault(r[1], []).append(r)
for j, f in enumerate(F):
    mias = porCli.get(j, [])
    act, prev = {}, {}
    meses = set()
    for r in mias:
        m = mesL[r[0]]
        rubro = D["rub"][art[r[2]][1]]
        if m in w12:
            act[rubro] = act.get(rubro, 0) + r[4]
            meses.add(m)
        elif m in wPrev:
            prev[rubro] = prev.get(rubro, 0) + r[4]
    f["meses"] = len(meses)
    totPrev = sum(prev.values())
    perdidas = []
    for rubro, monto in prev.items():
        if rubro == "(sin rubro)":
            continue
        hoy = act.get(rubro, 0)
        if monto >= 100000 and monto >= 0.03 * totPrev and hoy <= 0.05 * monto:
            perdidas.append([rubro, int(monto)])
    f["perd"] = sorted(perdidas, key=lambda x: -x[1])[:4]

filas.sort(key=lambda r: (r[0], r[8]))
V = {"corte": D["meta"]["corte"], "mes": D["mes"], "rub": D["rub"],
     "cbte": D["cbte"], "art": art, "f": filas}

# --- recalcular la ficha de prueba desde sus propias filas ---
if iPrueba is not None:
    mes = D["mes"]
    w12, wPrev, t1, t0 = set(mes[-12:]), set(mes[-24:-12]), set(mes[-3:]), set(mes[-6:-3])
    mias = [r for r in filas if r[1] == iPrueba]
    suma = lambda ms: sum(r[4] for r in mias if mes[r[0]] in ms)
    f12, prev12, tri1, tri0 = suma(w12), suma(wPrev), suma(t1), suma(t0)
    porRubro = {}
    unidades = {}
    for r in mias:
        if mes[r[0]] not in w12:
            continue
        rubro = D["rub"][art[r[2]][1]]
        porRubro[rubro] = porRubro.get(rubro, 0) + r[4]
        unidades[rubro] = unidades.get(rubro, 0) + r[3]
    ultMes, ultDia = max((mes[r[0]], r[6]) for r in mias)
    from datetime import date
    ult = f"{ultMes}-{ultDia:02d}"
    corte = D["meta"]["corte"]
    dias = (date(*map(int, corte.split("-"))) - date(*map(int, ult.split("-")))).days
    totalEmpresa = sum(r[4] for r in filas if mes[r[0]] in w12)
    porCliente = {}
    for r in filas:
        if mes[r[0]] in w12:
            porCliente[r[1]] = porCliente.get(r[1], 0) + r[4]
    rank = sorted(porCliente.values(), reverse=True).index(f12) + 1
    f = F[iPrueba]
    f.update({
        "f12": f12,
        "vAnual": round(f12 / prev12 - 1, 6) if prev12 else None,
        "vTrim": round(tri1 / tri0 - 1, 6) if tri0 else None,
        "part": round(f12 / totalEmpresa, 6) if totalEmpresa else 0,
        "rank": rank,
        "ult": ult,
        "dias": dias,
        "ops": len({r[8] for r in mias if mes[r[0]] in w12}),
        "jab": round(unidades.get("JABALINAS IRAM 2309", 0)),
        "tom": round(unidades.get("TOMA STANDARD", 0)),
        "fam": sorted(([k, v] for k, v in porRubro.items()), key=lambda x: -x[1])[:5],
    })
    json.dump(F, open("fichas.json", "w", encoding="utf-8"), ensure_ascii=False)
    print("ficha de prueba recalculada:",
          json.dumps({k: f[k] for k in ("f12","vAnual","vTrim","part","rank","ult","dias","ops","jab","tom")},
                     ensure_ascii=False))

json.dump(V, open("ventas.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"ventas.json: {len(filas):,} filas · {len(art)} articulos · {os.path.getsize('ventas.json'):,} bytes")
