# Poängbogey-kalkylator ⛳

Mobilanpassad webbapp för att beräkna poängbogey-resultat under en golfrunda. Fungerar som en fristående HTML-fil — ingen server behövs.

## Funktioner

- **1–4 spelare** i samma bollsällskap, varje spelare med eget handicapindex
- **Scramble-, Bästboll- och Foursome-läge** för 4 spelare i 2 lag — laghandicap/spelhandicap beräknas automatiskt
- **Spelhandicap** beräknas med slope-formeln: `HI × (Slope / 113) + (CR − Par)`
- Stöd för **9 och 18 hål**, samt möjlighet att spela en 9-hålsbana som 18 hål (dubbelrunda)
- **Gul och Röd tee**
- Hålvis inmatning av par (3/4/5-knappar) och Hcp/Index från scorekortet
- **Sparar bandata** automatiskt — slope, CR, par och håldata återladdas nästa runda
- Rankingresultat med guld/silver/brons för alla spelare eller lag

## Spelformer

### Individuellt (1–4 spelare)
Varje spelare räknar poängbogey med sitt eget spelhandicap. Resultatsidan visar en rankinglista och hålvis poängtabell per spelare.

### Scramble (4 spelare, 2 lag)
Spelarna delas in i Lag A och Lag B. Lagets spelhandicap beräknas enligt:

```
Spelhandicap = round(lägst HI × 0,5 + högst HI × 0,4)
```

Laget spelar en gemensam score per hål. Resultatsidan visar vilket lag som vann.

### Bästboll (4 spelare, 2 lag)
Spelarna delas in i Lag A och Lag B, men till skillnad från Scramble spelar varje spelare sin egen boll och matar in sin egen score per hål med sitt eget spelhandicap. Lagets poäng på varje hål är den bästa av de två lagmedlemmarnas poäng. Resultatsidan visar båda spelarnas individuella scorekort och markerar vilken spelares poäng som räknades för laget på varje hål.

### Foursome (4 spelare, 2 lag)
Spelarna delas in i Lag A och Lag B och spelar en gemensam boll där lagmedlemmarna slår varannan gång, precis som i Scramble matar laget in **en** score per hål. Lagets spelhandicap beräknas som snittet av lagmedlemmarnas egna spelhandicap:

```
Spelhandicap = round((Spelhandicap spelare 1 + Spelhandicap spelare 2) / 2)
```

Under scoreinmatningen visar appen vem i respektive lag som slår ut på varje hål (🎯) — ordningen växlar automatiskt hål för hål mellan lagmedlemmarna.

## Spelarregister

Spara dina vanliga medspelare för snabb återanvändning:

- **Namn, efternamn, smeknamn och handicapindex** — smeknamnet visas i spelet om det är angivet
- **Profilbild** — lägg till ett foto per spelare med inbyggd beskärningsfunktion (pan + zoom)
- **Snabbval** — välj en sparad spelare från dropdown i spelarkorten vid rundan
- **Inline-redigering** — ändra namn, efternamn, smeknamn och handicap direkt i registret
- Profilbilderna visas på resultatsidan och i delad bild

## Spelarstatistik och historik

Klicka på en spelare i registret för att se spelhistorik och statistik:

- **Översikt** — antal rundor, vinster och parsprocent
- **Poäng** — bästa runda, snittpoäng och totalt spelade hål
- **Hålresultat** — antal eagles, birdies, pars, bogeyn och dubbel+
- **Poänggraf** — stapeldiagram över de senaste 5 rundorna
- **Form mot hcp** — trendkurva över hur många poäng spelaren snittar över/under sitt handicap (baslinje = 2 poäng/hål)
- **HCP-utveckling** — linjediagram över spelarens handicapindex över tid, baserat på HI:t som angavs vid varje runda
- **Hall of Fame** — jämförelsestatistik mellan alla sparade spelare (bästa runda, flest vinster, flest birdies m.m.)

## Säsong / Order of Merit

Under Spelarregister → **📅 Säsong** kan du se en sammanlagd poängtabell för alla spelare inom ett valfritt datumintervall (standard: innevarande år). Rundor spelade i Scramble- eller Foursome-läge räknas inte in eftersom laget då inte är knutet till enskilda spelare — Individuellt och Bästboll räknas båda in per spelare.

## Live-poäng och ledartavla

- **Poäng per hål** visas direkt under scoreinmatningen (färgkodad: bogey/par/birdie/eagle)
- **Ledare markeras** med grön kolumn i scoretabellen — uppdateras efter varje hål
- **Poängtotal** visas i tabellens sidfot och uppdateras löpande
- **Äran-banner** — efter varje avslutat hål visas vem som har äran och startar nästa hål, med spelarens profilbild

## Återuppta pågående runda

Rundan sparas automatiskt efter varje inmatad score. Om sidan laddas om eller webbläsaren stängs mitt i rundan visas en banner på startsidan med **Fortsätt rundan ▶** — alla inmatade scorer, poäng och ledarmarkering återställs. Snapshoten rensas när rundan beräknas klart eller när du väljer **Släng**.

## Rundhistorik

Alla spelade rundor sparas automatiskt och kan bläddras i efterhand:

- Visa rankingresultat och hålvis scoredetaljer per spelare
- **Redigera** en sparad runda med ✏️ — öppna scoreinmatningen igen, rätta felskrivna slag och räkna om (rundan uppdateras på plats)
- **Dela** en sparad runda via delningsknapp per runda
- **Ta bort** enskilda rundor

## Dela resultat

Resultatsidan och sparade rundor kan delas via **📤 Dela**-knappen:

- På mobil delas en **bildkort** (PNG) med profilbilder, rankning och poäng
- På desktop kopieras resultattexten till urklipp som reserv
- Bilden innehåller kursnamn, tee, antal hål och datum

## Skriv ut / PDF-export

Resultatsidan och sparade rundor kan skrivas ut eller sparas som PDF via **🖨 Skriv ut / PDF**-knappen. Utskriften visar rankingen och det fullständiga hålvisa scorekortet för varje spelare, utan menyer och knappar.

## Förinstallerade banor

Appen levereras med kurs- och hålinformation för följande banor:

| Bana | Tee | Hål |
|------|-----|-----|
| Binga Golf | Gul / Röd | 9 |
| Kalmar GK – Gamla banan | Gul / Röd | 18 |
| Kalmar GK – Nya banan | Gul / Röd | 18 |
| Möre GK | Gul / Röd | 18 |
| Nybro GK | Gul / Röd | 18 |
| Emmaboda Golf Club | Gul / Röd | 18 |
| Links Golf Öland/Grönhögen | Gul / Röd | 18 |
| Saxnäs GK | Gul / Röd | 18 |
| Långe Erik, Ekerum | Gul / Röd | 18 |
| Långe Jan, Ekerum | Gul / Röd | 18 |

Data är hämtad från [mScorecard.com](https://www.mscorecard.com).

## Exportera och importera data

All lokal data kan säkerhetskopieras och återställas via **📅 Sparade rundor → Exportera / importera**:

- Välj vad som ska exporteras: **Rundor**, **Banor** och/eller **Spelare**
- Exporten sparas som en JSON-fil med dagens datum
- Import sammanfogar data utan att skriva över befintliga poster (deduplicering via ID)

## Senaste banor

De tre mest spelade banorna visas som snabbvalsknappar längst upp på startsidan, rangordnade efter antal spelade rundor.

## Installera som app (PWA)

Appen kan installeras på hemskärmen och fungerar då helt offline:

- **iPhone/iPad**: Öppna sidan i Safari → Dela-knappen → **Lägg till på hemskärmen**
- **Android**: Öppna sidan i Chrome → meny (⋮) → **Installera app** / **Lägg till på startskärmen**

Appen öppnas då i eget fönster utan webbläsarens adressfält, med egen ikon, och all funktionalitet fungerar utan nätverkstäckning — perfekt ute på banan.

> **För utvecklare:** bumpa `CACHE`-versionen i `sw.js` (t.ex. `golf-v2`) vid varje deploy så att installerade appar hämtar den nya versionen.

## Kom igång

1. Ladda ner `index.html`
2. Öppna filen i **Safari eller Chrome** (dubbelklicka i Finder)
3. Välj en förinstallerad bana eller lägg till en ny via **+ Lägg till ny bana**
4. Fyll i slope, CR och par från scorekortet för vald tee
5. Mata in par och Hcp/Index per hål (sparas automatiskt till nästa gång)

> **Obs:** Öppna alltid via samma webbläsare för att data ska vara tillgänglig — sparning kräver `localStorage` och fungerar inte i privat/inkognito-läge.

## Teknisk info

- Ren HTML/CSS/JavaScript — inga beroenden eller byggsteg
- All data sparas lokalt i webbläsarens `localStorage`:
  - `golf_courses_db` — bandata
  - `golf_rounds_db` — rundhistorik
  - `golf_players_db` — spelarregister (inkl. profilbilder som base64)
- Fungerar offline efter första laddning
- Profilbilder komprimeras till 160×160 px JPEG via canvas innan lagring
