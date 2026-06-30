# Poängbogey-kalkylator ⛳

Mobilanpassad webbapp för att beräkna poängbogey-resultat under en golfrunda. Fungerar som en fristående HTML-fil — ingen server behövs.

## Funktioner

- **1–4 spelare** i samma bollsällskap, varje spelare med eget handicapindex
- **Scramble-läge** för 4 spelare i 2 lag — lagets spelhandicap beräknas automatiskt
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

## Spelarregister

Spara dina vanliga medspelare för snabb återanvändning:

- **Namn, smeknamn och handicapindex** — smeknamnet visas i spelet om det är angivet
- **Profilbild** — lägg till ett foto per spelare med inbyggd beskärningsfunktion (pan + zoom)
- **Snabbval** — välj en sparad spelare från dropdown i spelarkorten vid rundan
- Profilbilderna visas på resultatsidan och i delad bild

## Live-poäng och ledartavla

- **Poäng per hål** visas direkt under scoreinmatningen (färgkodad: bogey/par/birdie/eagle)
- **Ledare markeras** med grön kolumn i scoretabellen — uppdateras efter varje hål
- **Poängtotal** visas i tabellens sidfot och uppdateras löpande

## Rundhistorik

Alla spelade rundor sparas automatiskt och kan bläddras i efterhand:

- Visa rankingresultat och hålvis scoredetaljer per spelare
- **Dela** en sparad runda via delningsknapp per runda
- **Ta bort** enskilda rundor

## Dela resultat

Resultatsidan och sparade rundor kan delas via **📤 Dela**-knappen:

- På mobil delas en **bildkort** (PNG) med profilbilder, rankning och poäng
- På desktop kopieras resultattexten till urklipp som reserv
- Bilden innehåller kursnamn, tee, antal hål och datum

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

Data är hämtad från [mScorecard.com](https://www.mscorecard.com).

## Exportera och importera data

All lokal data kan säkerhetskopieras och återställas via **📅 Sparade rundor → Exportera / importera**:

- Välj vad som ska exporteras: **Rundor**, **Banor** och/eller **Spelare**
- Exporten sparas som en JSON-fil med dagens datum
- Import sammanfogar data utan att skriva över befintliga poster (deduplicering via ID)

## Senaste banor

De tre mest spelade banorna visas som snabbvalsknappar längst upp på startsidan, rangordnade efter antal spelade rundor.

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
