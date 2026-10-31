# Matchmotoren

`src/game/engine/match.ts` er en zonebaseret event-simulation inspireret af CM3-motoren bag CM 01/02.

## Model

- **Banen** er 5 bånd (længde) × 3 baner (bredde) = 15 zoner i absolutte koordinater. Hjemmeholdet angriber mod x = 100.
- **Hver spiller** har en angrebs- og en forsvarsposition. De afledes af formationspladsen, mentalitet, bredde, presspil og individuelle instruktioner (løb fremad, fri rolle …). Spilleren dækker zonerne med en gaussisk vægt.
- **Et moment** (~240 pr. kamp): holdet med bolden vælger en boldholder i zonen. Ud fra bånd, bane og instruktioner vælges en handling: aflevering, lang bold, dribling, gennembrudsbold, indlæg eller skud.
- **Hver handling** er en duel mellem angriberens og en forsvarers sammensatte evner (fx afleveringer + beslutninger + teknik mod forudseenhed + positionering + presspil). Overtal i zonen indgår i duellen.
- **Skud** får en xG ud fra type og position (felt, distance, hovedstød, alene med målmanden, straffe, frispark) og presset i zonen. Om bolden går ind, afgøres af skytte mod målmand.
- **Kondition** falder løbende (udholdenhed, naturlig form, tempo, presspil) og sænker de effektive attributter.
- **Moral, form, hjemmebane, stabilitet og store kampe** modulerer spillernes niveau i kampen.
- **Dueller** kan give frispark, kort, straffespark og skader.

## Kalibrering

`npx tsx scripts/calibrate.ts 2000 GB1` (Premier League-hold mod hinanden):

| Målepunkt | Motor | Virkelighed |
|---|---|---|
| Mål pr. kamp | ~2,7 | ~2,7 |
| Hjemmesejre | ~46 % | ~45 % |
| Uafgjorte | ~24 % | ~25 % |
| Skud pr. hold | ~11,5 | ~12,5 |
| Gule kort pr. kamp | ~3 | ~3,5 |
| Tid pr. kamp | ~0,35 ms | – |

## Exploit-sikring (forbedring #8)

I det originale CM 01/02 kunne visse formationer (fx 4-2-4 med pile) vinde næsten alt. Her findes ingen særregler. Formationens form afgør alene, hvor holdet har overtal i zonerne:

- Fire angribere giver tomme midtbanezoner. Modstanderen vinder derfor flere dueller og mere boldbesiddelse.
- En spiller uden for sin position får en **fit-faktor**, der sænker de effektive attributter.

`tests/engine.test.ts` sikrer, at 4-2-4 med samme trup ikke kan hente mere end 1,75 point pr. kamp mod 4-4-2. I spillet kan du selv teste din taktik under **Assistent → Taktik-benchmark**. Benchmarken kører i en Web Worker.

## Gennemsigtighed (forbedring #3)

Hver kamp gemmer:

- xG og skudkort
- momentum pr. 5 minutter
- boldbesiddelse pr. zone (heatmap)
- zonekontrol

Assistenten bruger tallene til at forklare *hvorfor* kampen gik, som den gik.
