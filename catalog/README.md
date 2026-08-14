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
