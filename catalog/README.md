# Svensk bankatalog

Katalogen byggs från offentliga uppgifter men publicerar endast kompletta banor. SGF:s
klubbregister används som arbetskö; varje bana måste därefter kontrolleras mot klubbens
egen webbplats, scorekort eller slopetabell.

Kör `npm run catalog:inventory` för att skriva det normaliserade klubbregistret till
standardutmatningen. Administrativa poster, utländska klubbar och poster utan svensk
besöksadress/GPS filtreras bort. Resultatet är en granskningskö, inte publicerbar bandata.

Verifieringsstatus:

- `verified` — alla publicerade tees, CR/slope, par och index har kontrollerats mot angiven källa.
- `needs-review` — en klubbkälla finns men scoreuppgifterna behöver kontrolleras.
- `legacy` — äldre katalogdata utan fullständig källkedja.

Gissa aldrig saknade värden. En bana publiceras först när varje hål och teevariant som
läggs in klarar katalogens validering. Spara källans URL och datum för senaste kontroll.

Verifierade dataset ligger i `catalog/verified/`. Skapa migrations-SQL på standardutmatningen
med `npm run catalog:build -- catalog/verified/<fil>.json`. Importverktyget stoppar poster som
saknar komplett scoredata, säker källänk, verifieringsdatum eller status `verified`.

En tee kan ha `ratings` för `men`, `women` eller `all`. När samma fysiska tee har olika
CR/slope skapas separata val, till exempel `55 · Herrar` och `55 · Damer`, så att en variant
aldrig skriver över den andra på enheten.

## Verifierade källor

`ekerum.json` kontrollerades 2026-08-14 mot Ekerums officiella golfsida och dess länkar:

- Långe Jans slope: `https://ekerum.cdn.prismic.io/ekerum/aOTFuJ5xUNkB1qu6_Hektometer-25LJ.pdf`
- Långe Eriks slope: `https://ekerum.cdn.prismic.io/ekerum/aOTFuJ5xUNkB1qu5_Hektometer-25LE.pdf`
- Par och index för båda banorna: `https://www.caddee.se/klubb/ekerum-golfklubb`

`kalmar.json` kontrollerades 2026-08-14 mot Kalmar Golfklubbs egna sidor och dokument:

- Gamla Banans par och index: `https://www.kalmargk.se/spela/banguide-gamla-banan/`
- Nya Banans par och index: `https://www.kalmargk.se/spela/banguide-nya-banan`
- Klubbens länkar till slopetabeller: `https://www.kalmargk.se/spela/slopetabeller`
- Gamla Banan herrar: `https://www.kalmargk.se/media/jbrhuf53/gamla-banan-herrar.pdf`
- Gamla Banan damer: `https://www.kalmargk.se/media/c3yowsuc/kalmar_gk_gamla_banan_women.pdf`
- Nya Banan herrar: `https://www.kalmargk.se/media/dtkp0y3t/nya-banan-herrar.pdf`
- Nya Banan damer: `https://www.kalmargk.se/media/45ddzqxg/nya-banan-damer.pdf`

`jonkoping-varnamo-vetlanda.json` kontrollerades 2026-08-14 mot klubbarnas egna sidor:

- Jönköpings banguide: `https://www.jonkopingsgk.se/spela-gaest/banguide-old`
- Jönköpings slopetabeller: `https://www.jonkopingsgk.se/spela-gaest/slopetabell/`
- Värnamos klubbpublicerade Caddee-guide: `https://www.caddee.se/klubb/varnamo-golfklubb`
- Värnamos slopetabeller: `https://www.varnamogk.se/spela-golf/banor/`
- Vetlandas banguide: `https://vetlandagk.com/vaara-banor/18-haalsbana/`
- Vetlandas slopetabeller: `https://vetlandagk.com/vaara-banor/slopetabell-18-haalsbana/`

Värnamo publiceras tills vidare endast som Västra/Östra. Övriga slingkombinationer
väntar tills kombinationsspecifika hålindex kan verifieras utan antaganden.
