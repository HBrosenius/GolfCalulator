# Poängbogey-kalkylator ⛳

Mobilanpassad webbapp för att beräkna poängbogey-resultat under en golfrunda. Fungerar som en fristående HTML-fil — ingen server behövs.

## Funktioner

- **1–4 spelare** i samma bollsällskap, varje spelare med eget handicapindex
- **Spelhandicap** beräknas automatiskt med slope-formeln: `HI × (Slope / 113) + (CR − Par)`
- Stöd för **9 och 18 hål**
- **Gul och Röd tee**
- Hålvis inmatning av par (3/4/5-knappar) och Hcp/Index från scorekortet
- **Sparar bandata** automatiskt — slope, CR, par och håldata återladdas nästa runda
- Rankingresultat med guld/silver/brons för alla spelare

## Kom igång

1. Ladda ner `index.html`
2. Öppna filen i **Safari eller Chrome** (dubbelklicka i Finder)
3. Lägg till en bana via **+ Lägg till ny bana**
4. Fyll i slope, CR och par från scorekortet för vald tee
5. Mata in par och Hcp/Index per hål (sparas automatiskt till nästa gång)

> **Obs:** Öppna alltid via samma webbläsare för att bandata ska vara tillgänglig — sparning kräver `localStorage` och fungerar inte i privat/inkognito-läge.

## Teknisk info

- Ren HTML/CSS/JavaScript — inga beroenden eller byggsteg
- All data sparas lokalt i webbläsarens `localStorage` under nyckeln `golf_courses_db`
- Fungerar offline efter första laddning
