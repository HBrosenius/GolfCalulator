# Poängbogey-kalkylator ⛳

Mobilanpassad webbapp för att beräkna poängbogey-resultat under en golfrunda. Fungerar som statiska filer utan backend eller byggsteg.

## Funktioner

- **1–4 spelare** i samma bollsällskap, varje spelare med eget handicapindex
- **Scramble-, Bästboll- och Foursome-läge** för 4 spelare i 2 lag — laghandicap/spelhandicap beräknas automatiskt
- **Spelhandicap** beräknas med slope-formeln: `HI × (Slope / 113) + (CR − Par)`
- Stöd för **9 och 18 hål**, samt möjlighet att spela en 9-hålsbana som 18 hål (dubbelrunda)
- Stöd för både **traditionella teefärger** (Gul, Röd) och **Hektometersystemet** (T60, T57, T53, T48, m.fl.) — spelare i samma runda kan spela från **olika tee** och ändå tävla rättvist mot varandra
- Hålvis inmatning av par (3/4/5-knappar) och Hcp/Index från scorekortet
- **Sparar bandata** automatiskt — slope, CR, par och håldata återladdas nästa runda
- Rankingresultat med guld/silver/brons för alla spelare eller lag
- **Live-runda** — dela en kod så alla spelare kan mata in sin egen score från sin egen telefon under rundan

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

### Matchspel (2 spelare, 1v1)
Hål-för-hål-match mellan två spelare. Varje hål vinns av den med flest poäng (netto) — lika poäng ger delat hål. Den som är fler hål upp än det finns hål kvar vinner matchen. Under scoreinmatningen visas matchställningen live (**⚔️ X upp / Delad**) och resultatsidan visar utfallet, t.ex. **3&2** eller *Delad match*.

## Olika tee i samma runda

I spelformer där varje spelare spelar sin egen boll (Individuellt, Bästboll och Matchspel) kan varje spelare välja **eget tee** i spelarkortet — t.ex. en från Gul och en från Röd i samma boll. Väljaren visas bara när banan har mer än ett tee registrerat.

Rättvisan sköter sig själv via spelhandicapformeln: `HI × (Slope / 113) + (CR − Par)`. Termen `(CR − Par)` är precis den tee-justering som gör att nettoresultat från olika tee går att jämföra — den som spelar från ett svårare tee får fler slag. Hålens par och index är desamma oavsett tee, så poängbogey-poängen blir direkt jämförbara.

Under scoreinmatningen visas varje spelares tee i tabellhuvudet, och i historiken märks sådana rundor som **⛳ Blandat tee**. Scramble och Foursome spelar en gemensam boll och använder därför rundans gemensamma tee.

### Tee-namn och Hektometersystemet

När en bana läggs till kan tee väljas bland snabbvalen **Gul, Röd, T60, T57, T53, T48** eller anges fritt (t.ex. `T65`). Hektometersystemet namnger tee efter ungefärlig längd i hektometer (100 m) istället för färg, så att spelare väljer tee efter slaglängd snarare än kön — men Course Rating och Slope gäller per tee precis som förut, så spelhandicap-formeln och poängberäkningen är exakt densamma oavsett vilket namnsystem banan använder. Färg- och hektometer-tee kan finnas sida vid sida på samma bana.

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
- **Inbördes möten** — vinst–förlust–oavgjort (V–F–O) mot varje motspelare, baserat på individuella-, bästboll- och matchspelsrundor
- **HCP-utveckling** — linjediagram över spelarens handicapindex över tid, baserat på HI:t som angavs vid varje runda
- **Hall of Fame** — jämförelsestatistik mellan alla sparade spelare (bästa runda, flest vinster, flest birdies m.m.)

## Banrekord

Under Spelarregister → **🏟️ Banrekord** visas en topp 3-lista per bana (grupperat på banans namn och antal hål) över de bästa enskilda rundorna som spelats där, med spelare, poäng, datum och tee. Precis som i Säsong räknas Scramble- och Foursome-rundor inte in eftersom laget delar en gemensam score som inte kan knytas till en enskild spelares prestation.

## Säsong / Order of Merit

Under Spelarregister → **📅 Säsong** kan du se en sammanlagd poängtabell för alla spelare inom ett valfritt datumintervall (standard: innevarande år). Rundor spelade i Scramble- eller Foursome-läge räknas inte in eftersom laget då inte är knutet till enskilda spelare — Individuellt och Bästboll räknas båda in per spelare.

## Tour

Under Spelarregister → **🚌 Tour** kan du sätta upp en tour för ett fast startfält (valfritt antal sparade spelare, gärna fler än 4) som spelar på en eller flera utvalda banor under en tidsperiod, och få en löpande — och till slut slutgiltig — ställning.

- **Skapa en tour** med namn, start- och slutdatum, valfritt antal deltagare samt en eller flera banor (från Sparade banor) som ska räknas — plus en valfri inställning för att bara räkna spelarens bästa X rundor (annars räknas alla)
- **Inga särskilda steg för att rapportera resultat** — deltagarna spelar helt vanliga rundor (valfritt antal spelare, valfri spelform, när som helst under turneringsperioden). Så fort en runda sparas på en av tourens banor, inom datumintervallet, och minst en av tourens deltagare är med i den, plockas den automatiskt upp av touren — övriga spelare i samma runda som inte är med i touren påverkar inte ställningen. **+ Ny runda** i tourvyn är bara en snabbgenväg som förifyller bansöket, ingen skillnad mot att starta rundan som vanligt
- **Poäng per runda** är spelarens vanliga poängbogey-poäng (totalPoints) från den rundan — ingen separat placeringspoäng. Scramble- och Foursome-rundor räknas inte in eftersom laget delar en gemensam score som inte går att knyta till en enskild spelare, samma princip som i Säsong/Banrekord
- **Ställningen** visar varje spelares totalpoäng (summan av deras bästa X rundor, eller alla om inget X är satt) samt hur många av deras spelade rundor som räknades
- **Avsluta touren** manuellt, eller låt den stänga automatiskt när slutdatumet passerats — vinnaren är den med mest totalpoäng; vid lika poäng vinner den med lägst handicapindex (svårare att nå samma poängsumma med lägre hcp)
- En borttagen tour påverkar inte de sparade rundorna — de finns kvar i Rundhistorik som vanligt

### Delad tour och gemensam liverapportering

En lokal tour kan publiceras med **Dela tour online**. Det skapar en fristående delad kopia och en inbjudningslänk. Befintliga lokala tourer ändras inte automatiskt; publiceringen är den uttryckliga migreringen och de gamla lokala rundorna ligger kvar orörda.

- Alla som öppnar inbjudningslänken får en egen enhetsbehörighet och kan starta, spela och spara rundor kopplade till touren. Om samma enhet öppnar länken igen återanvänds dess befintliga behörighet i stället för att skapa en dubblett.
- Enhetsbehörigheten avgör bara vem som får rapportera. När en ny tourrunda startas kan varje behörig användare välja **vilken eller vilka spelare som helst ur hela tourens startfält**. Tourspelarna hämtas direkt från den delade touren och behöver inte kopplas till lokala spelarprofiler på enheten.
- Resultaten valideras och räknas om av servern. Varje spelare identifieras med sitt beständiga tourmedlems-ID, så en runda hamnar på rätt spelare oavsett vilken enhet som rapporterar den.
- Sparade resultat köas lokalt om nätet saknas och skickas igen automatiskt. Samma runda kan därför inte råka registreras två gånger vid återförsök.
- Den delade tourvyn visar tourens **villkor**, inkluderade banor, hålantal, tee, gräns för räknade rundor, startfält, ställning och rapporterade rundor.
- Ställningen uppdateras automatiskt var tionde sekund medan tourvyn är öppen, samt direkt när appen återgår till förgrunden eller nätverket kommer tillbaka. Uppdateringen stoppas när användaren lämnar tourvyn eller startar en runda.
- Servern avslutar automatiskt en delad tour när slutdatumet har passerat, även om ingen har appen öppen. Organisatören kan förlänga en automatiskt avslutad tour och öppna den igen.
- På startsidan visas **Pågående tourer** med aktiva lokala och delade tourer. En publicerad lokal tour visas inte en extra gång bredvid sin delade kopia.
- Organisatören kan redigera namn, datum, antal bästa rundor, regel för flera rundor per bana och banornas rundgränser efter publicering. Startfält och bansnapshots förblir låsta, och datum får inte utesluta redan registrerade rundor.
- Organisatören kan också kopiera eller byta inbjudningslänk, se behöriga enheter med anslutningstid, återkalla enskilda enheter samt avsluta touren. Efter ett manuellt avslut kan inga fler resultat läggas till.
- En pågående lokal eller delad tour kan **avbrytas** utan att resultaten raderas. Lokala tourer kan därefter tas bort från enheten; organisatören kan ta bort en delad tour permanent för alla, medan deltagare bara tar bort den från sin egen enhet.
- Om en tourrunda inte kan skickas visas en tydlig panel med antal försök och senaste fel. Rundan ligger kvar säkert på enheten, synkas automatiskt när nätverket återkommer och kan även skickas igen med **Försök synka igen**.
- Vanliga säkerhetskopior innehåller inte tourens hemliga organisations- eller enhetsnycklar; de ligger bara på den enhet där länken öppnades eller touren publicerades.

## Live-poäng och ledartavla

- **Poäng per hål** visas direkt under scoreinmatningen (färgkodad: bogey/par/birdie/eagle)
- **Ledare markeras** med grön kolumn i scoretabellen — uppdateras efter varje hål
- **Poängtotal** visas i tabellens sidfot och uppdateras löpande
- **Sticky rubrik och totalsumma** — spelarnas namn ligger kvar överst och poängtotalen kvar längst ner medan du bläddrar genom hålen
- **Äran-banner** — efter varje avslutat hål visas vem som har äran och startar nästa hål, med spelarens profilbild

## Live-runda (flera enheter)

Låt varje spelare mata in sin egen score på sin egen telefon under rundan, istället för att en person matar in allt:

- **📡 Starta som live-runda** finns längst ner i steg 3 (Spelare) — startar rundan precis som vanligt men visar sedan en delbar **4-teckens kod**
- Övriga spelare trycker **📡 Anslut till live-runda** på startsidan, matar in koden och väljer **vilken spelare de är** i listan — redan valda spelare visas gråtonade
- Varje enhet kan bara mata in score för sin egen spelare — övriga spelares kolumner visas gråtonade och skrivskyddade, och uppdateras automatiskt (var ~4 sekund) när den spelaren matar in sin score
- **🎯 Närmast pinnen** och **💥 Längsta drive** synkas också mellan enheterna, men bara den som startade rundan (först i listan) kan välja vinnare — övriga ser valet men kan inte ändra det
- Fungerar som vanligt om nätverket ligger nere tillfälligt — din egen scoreinmatning och den vanliga återupptagningen (se nästa avsnitt) påverkas inte, och osparade poäng skickas iväg så snart uppkopplingen är tillbaka
- En live-runda sparas ändå lokalt precis som en vanlig runda och hamnar i **Rundhistorik** när den räknas klart
- **💰 Satsa på hål** — vem som helst av de anslutna spelarna kan föreslå en satsning i kronor på att vinna ett hål; alla övriga måste acceptera innan den låses in, en enda nekad satsning avbryter den helt. Vinnare avgörs av ensam bästa nettoscore på hålet (delad bästa score = ingen vinner). Efter rundan visas en avräkning under resultatet med vem som ska betala vem, och den sparas med i Rundhistorik

Live-rundor skyddas med privata värd- och spelartokens. Koden används bara för
att hitta rundan och kan inte ensam användas för att ändra en upptagen spelares
score, markörer eller anteckningar.

> **För utvecklare:** kräver en egen driftsatt sync-relä (Cloudflare Worker) — se `sync-worker/README.md`.

## Återuppta pågående runda

Rundan sparas automatiskt efter varje inmatad score. Om sidan laddas om eller webbläsaren stängs mitt i rundan visas en banner på startsidan med **Fortsätt rundan ▶** — alla inmatade scorer, poäng och ledarmarkering återställs. Snapshoten rensas när rundan beräknas klart eller när du väljer **Släng** (en bekräftelseruta visas innan rundan slängs, så du inte råkar radera av misstag).

## Rundhistorik

Alla spelade rundor sparas automatiskt och kan bläddras i efterhand:

- **Filtrera** sparade rundor på bana, format, spelare och/eller datumintervall (🔎 Filter) — spelarfiltret matchar även lagmedlemmar i Scramble/Foursome
- Visa rankingresultat och hålvis scoredetaljer per spelare
- **Väder & anteckning** — lägg till väderförhållande (☀️/⛅/🌧️/💨) och en kort anteckning på rundan; visas i historiken och i den delade texten
- **Redigera** en sparad runda med ✏️ — öppna scoreinmatningen igen, rätta felskrivna slag och räkna om (rundan uppdateras på plats)
- **Dela** en sparad runda via delningsknapp per runda
- **Ta bort** enskilda rundor

## Dela resultat

Resultatsidan och sparade rundor kan delas via **📤 Dela**-knappen:

- På mobil delas en **bildkort** (PNG) med profilbilder, rankning, poäng och en **✨ Höjdpunkter**-sektion (bästa hål, flest birdies/eagles, tuffaste hålet, närmast pinnen, längsta drive m.m.) — höjdpunkterna ritas direkt in i bilden så att de alltid syns, oavsett vilken app du delar till
- På desktop kopieras resultattexten till urklipp som reserv, med samma höjdpunkter som text
- Bilden innehåller kursnamn, tee, antal hål och datum

## Höjdpunkter

Resultatsidan (och en återöppnad sparad runda) visar ett **✨ Höjdpunkter**-kort med rundans roligaste statistik: bästa hål, flest birdies, eagle eller bättre, flest nollor och tuffaste hålet. Birdies och eagles räknas på det faktiska slagresultatet mot par (inte poängbogey-poängen), så en spelare får bara credit för en riktig birdie eller eagle.

I matchspel visas höjdpunkterna tillsammans med matchresultatet (t.ex. **3&2**), inte istället för det.

I början av varje runda lottas ett par-3-hål för **🎯 närmast pinnen** och ett par-4/5-hål för **💥 längsta drive**. När du matar in scoren dyker en vinnarväljare upp direkt vid det utlottade hålet, och vinnarna visas sedan i höjdpunkterna.

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
| Oskarshamns Golfklubb | Gul / Röd | 18 |

Data är hämtad från [mScorecard.com](https://www.mscorecard.com).

## Exportera och importera data

All lokal data kan säkerhetskopieras och återställas via **📅 Sparade rundor → Exportera / importera**:

- Välj vad som ska exporteras: **Rundor**, **Banor** och/eller **Spelare**
- Exporten sparas som en JSON-fil med dagens datum
- Import sammanfogar data utan att skriva över befintliga poster (deduplicering via ID)
- Importerade säkerhetskopior valideras strikt, inklusive alla banor, spelare, rundor, hålrader och metadata; okända eller manipulerade fält avvisas innan något sparas

## Cloud-backup (Google Drive)

Under **📅 Sparade rundor → ☁️ Cloud-backup** kan all data (banor, rundor, spelare) säkerhetskopieras till Google Drive, och återställas därifrån:

- **Varje enhet/webbläsare får sin egen säkerhetskopia** — appen ger varje enhet ett unikt, sparat ID vid första användningen, så en säkerhetskopia från mobilen skriver inte över en från datorn
- **Namn på denna enhet** kan anges (t.ex. "Henriks iPhone") och sparas tillsammans med filen i Drive, så den går att känna igen senare
- **Säkerhetskopiera** loggar in med ditt Google-konto (första gången) och sparar all data i din egen Drive — appen har bara åtkomst till filer den själv skapat, inte resten av din Drive
- **Återställ** listar alla säkerhetskopior som finns i kontots Drive; finns det fler än en (flera enheter) visas en väljare med enhetsnamn och tidpunkt så du kan välja rätt en. En äldre säkerhetskopia från innan enhetsstöd fanns känns också igen automatiskt.
- Vald säkerhetskopia sammanfogas med lokal data via samma deduplicering som vanlig import — inget skrivs över
- Senaste säkerhetskopieringstidpunkt visas ovanför knapparna
- Varje användares data hamnar i just deras egen Drive — inget går via en delad server eller utvecklarens konto

> **För utvecklare:** kräver en Google OAuth 2.0 Client ID (se `GOOGLE_DRIVE_CLIENT_ID` i koden) från [Google Cloud Console](https://console.cloud.google.com/), med Drive API aktiverat. Så länge OAuth-samtycket är i **Testing**-läge måste varje användares Google-konto läggas till manuellt som testanvändare (max 100, ingen Google-verifiering krävs) — perfekt för en mindre grupp. Testanvändare behöver klicka igenom en "ej verifierad app"-varning, och åtkomsten förnyas var 7:e dag.

## Senaste banor

De tre mest spelade banorna visas som snabbvalsknappar längst upp på startsidan, rangordnade efter antal spelade rundor.

## Installera som app (PWA)

Appen kan installeras på hemskärmen och fungerar då helt offline:

- **iPhone/iPad**: Öppna sidan i Safari → Dela-knappen → **Lägg till på hemskärmen**
- **Android**: Öppna sidan i Chrome → meny (⋮) → **Installera app** / **Lägg till på startskärmen**

Appen öppnas då i eget fönster utan webbläsarens adressfält, med egen ikon, och all funktionalitet fungerar utan nätverkstäckning — perfekt ute på banan.

När en uppdatering är redo visas **En ny version finns** med knappen **Uppdatera nu**. Under en pågående runda väntar appen med meddelandet tills rundan är avslutad eller borttagen, så att scoreinmatningen inte avbryts. Cachegenerationer skapas automatiskt; utvecklare behöver inte längre ändra ett versionsnummer i `sw.js`.

## Utveckling och tester

Kärnlogiken ligger i fristående moduler under `src/`: poängberäkning, lokal lagring och migrering, live-API samt klientvalidering. Modulerna fungerar både direkt i webbläsaren och från Node-tester utan byggsteg. Rendering och vyhantering ligger fortfarande i `index.html`.

Kör hela testsviten med `npm test`. Den omfattar regel- och lagringstester, Worker-tester, återanslutning till live-rundor, export/import och migrering samt webbläsartester av en komplett sparad runda, delade tourinbjudningar, val av valfri tourspelare, offlinekö och synk, automatisk ställningsuppdatering, startsidevisning av pågående tourer, mobil/dark-mode-layout, offline-återladdning och säkra PWA-uppgraderingar.

Inför en release körs `npm run verify:release`. Kommandot kör hela testsviten, validerar Worker-konfigurationen med en torrkörning och kontrollerar båda beroendeträden efter kända sårbarheter. Första gången behövs `npm ci`, `npm ci --prefix sync-worker` och `npx playwright install chromium`.

### Checklista efter driftsättning

1. Kontrollera att Worker-endpointens `/health` svarar med `ok`.
2. Öppna den installerade appen och ladda om den offline.
3. Skapa en live-runda och anslut från en andra enhet; registrera resultat och kontrollera att score, markör och anteckning synkas åt båda håll.
4. Avsluta rundan och kontrollera att den finns i historiken på värdens enhet.
5. Exportera och återimportera en säkerhetskopia samt kontrollera att spelarkopplingar och historik finns kvar efter ett namnbyte.
6. Publicera en tour, öppna inbjudan på en andra enhet, välj en annan spelare ur tourens startfält och spara en runda; kontrollera att ställningen uppdateras automatiskt på båda enheterna.

## Kom igång

1. Ladda ner `index.html`
2. Öppna filen i **Safari eller Chrome** (dubbelklicka i Finder)
3. Välj en förinstallerad bana eller lägg till en ny via **+ Lägg till ny bana**
4. Fyll i slope, CR och par från scorekortet för vald tee
5. Mata in par och Hcp/Index per hål (sparas automatiskt till nästa gång)

Håldata valideras innan rundan startar: varje hål måste ha par och ett unikt index (fullständig 1–18 för 18-hålsbanor), och parsumman måste stämma med banans par — annars visas ett tydligt felmeddelande. Index anges alltid som scorekortets Hcp/Index (1–18).

> **Obs:** Öppna alltid via samma webbläsare för att data ska vara tillgänglig — sparning kräver `localStorage` och fungerar inte i privat/inkognito-läge.

## Konto och molnsynk

Kontofunktionen är frivillig: appen fortsätter fungera lokalt och offline utan
konto. Ett konto använder en lösenordsfri engångslänk via e-post och kan slå
ihop banor, rundor, spelare och lokala tourer mellan enheter.

- Inloggningslänkar gäller i 15 minuter och kan bara användas en gång.
- Sessioner kan återkallas och gäller i upp till 30 dagar.
- Synkronisering är icke-destruktiv och använder versionskontroll för samtidiga
  ändringar.
- Kontodata lagras i Cloudflare D1 och e-post levereras via Resend från
  `login@golf.brosenius.se`.
- Resend-nyckeln lagras endast som en Worker secret och skickas aldrig till
  webbläsaren.
- En inloggad användare kan koppla en post i spelarregistret till sin stabila
  spelarprofil. När en inbjudan öppnas kan profilen kopplas till rätt spelare i
  touren; detta begränsar inte vem som får registrera en annan spelares runda.
- Delade tourer som skapats eller accepterats med ett konto följer kontot. De
  hämtas automatiskt efter inloggning på en annan enhet, och samma konto får
  tillbaka sin roll utan en ny enhetsinbjudan.
- Äldre delade tourer och anonyma inbjudningar fortsätter fungera med lokala
  enhetstoken. Kontokopplingen är frivillig och bakåtkompatibel.

## Teknisk info

- Ren HTML/CSS/JavaScript — inga beroenden eller byggsteg
- Kärnlogiken för spelhandicap, slagfördelning, poängbogey och matchspel ligger i `src/scoring.js`. `npm test` kör poäng-, Worker- och webbläsartester lokalt.
- All data sparas lokalt i webbläsarens `localStorage`:
  - `golf_courses_db` — bandata
  - `golf_rounds_db` — rundhistorik
  - `golf_players_db` — spelarregister (inkl. profilbilder som base64)
  - `golf_last_cloud_backup` — tidpunkt för senaste Google Drive-säkerhetskopiering
  - `golf_origin_id` / `golf_origin_label` — unikt ID och namn för denna enhet/webbläsare, används för att skilja säkerhetskopior åt i Google Drive
- Fungerar offline efter första laddning — Google Identity Services laddas endast in på begäran när cloud-backup används, så vanligt spel påverkas inte
- Profilbilder komprimeras till 160×160 px JPEG via canvas innan lagring
