# Research: Championship Manager: Season 01/02

## 1. Baggrund

| | |
|---|---|
| Udvikler / udgiver | Sports Interactive / Eidos Interactive |
| Udgivet | Oktober 2001 (PC), november 2001 (Mac) |
| Sidste patch | 3.9.68 |
| Status | Gjort gratis (freeware) af Eidos i 2008. Community'et (champman0102.net) laver stadig opdaterede databaser |
| Motor | CM3-motoren. Kun tekstkommentarer, ingen 2D/3D-kamp |

CM 01/02 var den sidste store CM-udgave før SI og Eidos gik hver til sit (SI tog koden med og lavede *Football Manager*). Spillet er kendt for:

- en meget hurtig spil-loop: en hel sæson på få timer
- en database med op til ~100 spilbare ligaer i 26 lande og ~50.000 spillere/staff
- legendariske "wonderkids" (Tonton Zola Moukoko, Cherno Samba, Maxim Tsigalko, To Madeira, Kennedy Bakircioglu, Mark Kerr, Ibrahima Bakayoko)
- kendte "exploit-taktikker" (fx 4-2-4 og 3-4-3 varianter), som matchmotoren belønnede

## 2. Feature-inventar (det vi skal genskabe)

### 2.1 Spilstart
- Vælg hvilke lande/ligaer der skal loades (spilbare vs. "view-only")
- Opret manager (navn, nationalitet, fødselsdato, favoritklub)
- Vælg klub, eller start som arbejdsløs og søg job
- Flere menneskelige managere på samme maskine (hotseat)
- Valgfri **attribute masking**: du ser kun attributter for spillere, som dine scouts kender

### 2.2 Spillere: datamodel (direkte fra `player.dat`/`staff.dat`)
Fra community-værktøjet CMScouter (reverse-engineered filformat):

**Synlige 1–20-attributter**
- *Teknisk:* Anticipation, Creativity, Crossing, Decisions, Dribbling, Finishing, Handling, Heading, Long Shots, Marking, Off the Ball, One on Ones, Passing, Positioning, Reflexes, Tackling, Technique, Throw-ins, Penalties, Corners, Free Kicks
- *Mental:* Aggression, Bravery, Determination, Flair, Influence, Teamwork, Work Rate
- *Fysisk:* Acceleration, Agility, Balance, Jumping, Pace, Stamina, Strength, Natural Fitness

**Skjulte attributter**
- Current Ability (CA, 1–200) og Potential Ability (PA, 1–200 eller -1/-2 = tilfældig)
- Consistency, Important Matches, Injury Proneness, Dirtiness, Versatility
- Adaptability, Ambition, Loyalty, Pressure, Professionalism, Sportsmanship, Temperament
- Reputation: current, domestic og world

**Positioner.** GK, SW, D, DM, M, AM, ST og Wing-back, hver rated 1–20. Dertil sider (R/L/C), "Free role" og venstre/højre fod (1–20).

**"Intrinsic" attributter.** Tekniske attributter gemmes på en intern skala og omregnes til 1–20 relativt til CA. Derfor kan samme spiller "stige" i alle tekniske attributter, når hans CA stiger.

**Dynamiske værdier.** Kondition (%), moral, form (sidste 5 kampe), skader (type og dage), karantæne, gule kort, kontrakt (løn, udløb, bonusser, frikøbsklausuler), transferstatus og squad status.

**Statistik per sæson.** Kampe (+ indskifter), mål, assists, MoM, gule/røde kort og gennemsnitsrating med 2 decimaler. Gemmes for alle sæsoner (op til 30).

### 2.3 Taktik
- Formationer på banen: drag-and-drop af 11 spillere + bænk (5 i 2001: 3 udskiftninger af 5)
- Presets: 4-4-2, 4-4-2 diamant, 4-3-3, 4-5-1, 3-5-2, 5-3-2, 3-4-3, 4-2-4, 5-4-1, 4-1-2-1-2 m.fl.
- **Holdinstruktioner:** Passing (short/mixed/long), Tempo, Style (normal/counter/direct), Width, Closing Down, Tackling (easy/normal/hard), Marking (zonal/man), Offside trap, Playmaker, Target man, Counter attack
- **Individuelle instruktioner:** Forward runs (often/mixed/rarely), Run with ball, Long shots, Through balls, Crossing, Closing down, Tight marking, Free role
- Bevægelsespile: spilleren har én position *uden* bold og en anden *med* bold
- Standardsituationer: straffespark, frispark, hjørnespark, kaptajn

### 2.4 Kamp
- Tekstkommentar linje for linje i valgfri hastighed. Mål blinker
- Live statistik: possession, skud (på mål), hjørnespark, frispark, kort, offside
- Spillerkarakterer opdateres løbende, og der vises kondition
- Taktikændringer og udskiftninger undervejs, også ved pause
- Resultater fra andre kampe tikker ind (vidiprinter)
- Efter kampen: kamprapport, karakterer, Man of the Match og skader

### 2.5 Træning
- Skemaer med intensitet pr. kategori: General, Aerobic, Strength, Ball control, Tactics, Shooting, Defending, Goalkeeping, Set pieces
- Skemaer tildeles enkeltspillere eller hele truppen
- Udvikling styres af alder, PA, Determination/Professionalism, coachernes kvalitet og spilletid

### 2.6 Transfers og kontrakter
- Spillersøgning med filtre (position, alder, værdi, nationalitet, attributter)
- Shortlist og scoutrapporter
- Bud: kontant, afdrag og bytte-spillere. Klubberne svarer med accept, afslag eller modbud
- Kontraktforhandling: ugeløn, længde, sign-on fee, mål-bonus og frikøbsklausuler. Spilleren kan afvise ("ikke interesseret i at spille for en klub af jeres reputation")
- Udlejning (med/uden løndeling), transferlisten, "tilbyd spiller til klubber"
- **Bosman/EU-reglerne** fra september 2001: gratis skifte efter kontraktudløb, pre-contracts 6 mdr. før
- Arbejdstilladelser (UK) og udlændingekvoter
- Transfervinduer blev indført i 2002-sæsonen

### 2.7 Klub og økonomi
- Saldo, transferbudget, lønbudget
- Indtægter: billetsalg, TV, præmier, sponsorer og merchandise. Udgifter: løn og bonusser
- Stadion (kapacitet), ungdomsfaciliteter, træningsfaciliteter

### 2.8 Bestyrelse og job
- Bestyrelsens tillid (forventninger fastsat ved sæsonstart, fx "top-halvdel")
- Anmodninger: større budget, flere scouts eller coaches
- Fyring. Jobtilbud fra andre klubber, ansøgning til ledige jobs, landsholdsjobs

### 2.9 Staff
- Assistant manager, coaches, fysioterapeuter og scouts. Ansættelse og fyring
- Scouts kan sendes til lande eller regioner, eller på konkrete spillere/kampe
- Staff-attributter: Coaching, Judging Ability, Judging Potential, Physiotherapy, Motivating, Discipline, Tactics

### 2.10 Konkurrencer og verden
- Ligaer med op-/nedrykning og playoffs, nationale pokalturneringer
- Champions League (gruppespil i 2 runder i 2001/02), UEFA Cup, Intertoto Cup
- Landshold: VM/EM-kvalifikation. Spillere udtages og bliver væk ved samlinger
- AI-klubber handler indbyrdes og fyrer/ansætter managere

### 2.11 Nyheder, medier og historie
- Indbakke med alt: bud, skader, transfers i verden, rygter, Manager of the Month
- Presse: spillere og managere udtaler sig
- Sæsonpriser: Player/Young Player of the Year, Team of the Year, topscorer
- Historik: ligavindere, pokalvindere, klubrekorder, spillerkarrierer
- **Regens/newgens:** pensionerede spillere erstattes af nye fiktive unge spillere
- Holiday mode (spillet kører selv i en periode)

## 3. Datakilder til spillerdatabasen

| Kilde | Indhold | Licens | Vurdering |
|---|---|---|---|
| **[dcaribou/transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets)** | ~50.000 spillere (22.292 aktive i 2025/26), 800 klubber, 33 førstedivisioner (inkl. dansk Superliga), markedsværdier, 1,9 mio. kamp-optrædener (mål/assists/minutter/kort) | **CC0 (public domain)** | ✅ **Primær kilde.** Lovlig at bundle, aktuel, opdateres ugentligt |
| Originale CM 01/02-datafiler (`player.dat`, `staff.dat`…) | Den ægte 2001-database med alle attributter | © SI/Eidos. Spillet er freeware, men data må ikke redistribueres | ✅ **Valgfri importer:** brugeren peger på sin egen installation, og intet bundles |
| Community-opdateringer (champman0102.net) | Opdaterede 2025/26-databaser i CM-format | Uklart | ➖ Kan importeres via samme importer |
| FIFA/EA FC-datasæt (Kaggle) | 100+ attributter | EA-copyright | ❌ Undgås |

### Konvertering af Transfermarkt til CM-attributter
Transfermarkt har ikke 1–20-attributter, så de udledes deterministisk (seeded pr. `player_id`):

- **CA** ← log(markedsværdi) justeret for alder og ligaens styrke
- **PA** ← CA + alderskurve + forholdet mellem `highest_market_value` og nuværende værdi
- **Positionsprofil** ← `position`/`sub_position` giver en fordeling af attributter (fx kantspiller: Pace, Dribbling, Crossing høje)
- **Statistik-tweaks** ← mål/90 → Finishing og Off the Ball; assists/90 → Passing og Creativity; kort → Aggression og Dirtiness; højde → Heading og Jumping; fod → venstre/højre-fod; landskampe → Important Matches og Reputation
- Tilfældig støj (seeded), så to spillere med samme værdi ikke er ens

### Underdivisioner
Datasættet har kun førstedivisioner. 2. division bygges af klubber, der er rykket ud af datasættets ligaer (fx Leicester, Southampton, Ipswich, Lyngby, AaB). Deres spillere bruges, og resten fyldes op med genererede spillere (samme regen-generator som newgens).

## 4. Matchmotor: designnoter
CM3-motoren simulerer bolden mellem zoner (ikke koordinater) og vælger handlinger efter attributter, taktik og tilfældighed. Vi bygger en tilsvarende **zone-/possession-baseret event-simulation**:

1. Hver "tick" (~20–30 pr. halvleg pr. hold) har et hold bolden i en zone (eget felt, midtbane, angrebsfelt, left/right/center)
2. Bolden flyttes mellem zoner, og hver aktion (aflevering, dribling, tackling, skud) vælges ud fra spillerens attributter, holdinstruktioner og modstanderens markering
3. Skudchancer ender i mål, redning, forbi eller blokering. Udfaldet afhænger af Finishing/Composure mod GK Reflexes/Handling/One-on-ones
4. Kondition falder løbende (Stamina, Natural Fitness, tempo og closing down). Lav kondition sænker effektive attributter
5. Moral, form, hjemmebane, Important Matches og Consistency moduleres ind
6. Hver aktion giver ratingpoint, og kommentarlinjer genereres fra skabeloner

Motoren kalibreres mod rigtige statistikker: gennemsnitligt ~2,7 mål pr. kamp, ~45 % hjemmesejre, ~25 % uafgjorte og ~12 skud pr. hold.

## Kilder
- [StrategyWiki: Championship Manager: Season 01/02](https://strategywiki.org/wiki/Championship_Manager:_Season_01/02)
- [MobyGames: Championship Manager: Season 01/02](https://www.mobygames.com/game/5179)
- [FM Projects: Championship Manager 01/02](https://fmprojects.substack.com/p/championship-manager-0102)
- [ChrisReganXP/CMScouter](https://github.com/ChrisReganXP/CMScouter): CM0102-filformat og attributlayout
- [dcaribou/transfermarkt-datasets](https://github.com/dcaribou/transfermarkt-datasets): CC0-spillerdata
- [nckstwrt/CM0102Patcher](https://github.com/nckstwrt/CM0102Patcher), [kubawerlos/cm0102-data](https://github.com/kubawerlos/cm0102-data): community-værktøjer
