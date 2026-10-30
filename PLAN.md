# Rysowanka — plan

Prosta rysowanka dla 4–5-latka. Technika i styl jak w Rybkach, Tropicielu i Kuchciku: Canvas, czysty JS, lektor (`speechSynthesis`), działanie offline, GitHub Pages z automatycznym pushem.

## Ekran
- **Lewo, przybornik (12):** ołówek, kredka (woskowa faktura), flamaster, pędzel z farbą (półprzezroczysty, miękki brzeg), zakreślacz, świecący pisak (neon), tęczowy pisak, spray, brokat (kropki i gwiazdki), wiaderko (wypełnia pole), gumka, naklejki. Wybrany przybór wysuwa się z pudełka, a jego końcówka ma bieżący kolor.
- **Dół:** 16 kolorów. W trybie naklejek ten pasek pokazuje ostatnio używane naklejki i przycisk szuflady.
- **Prawo:** cofnij, 5 grubości (przy naklejkach to wielkość naklejki), nowa kartka (6 kolorów papieru, w tym czarny pod neon), zapisz (aparat), galeria, dźwięk.

## Zasady dla dziecka
- Bez czytania: lektor mówi nazwę przyboru, koloru, grubości i naklejki.
- Wybranie koloru przy gumce albo tęczy wraca do ostatniego pisaka.
- Nic nie ginie: nowa kartka i otwarcie innego rysunku same zapisują bieżący do galerii. Bieżący rysunek zapisuje się też w tle (autozapis po każdej kresce).
- Kosz w galerii wymaga dwóch dotknięć (pierwsze zmienia go w czerwony ptaszek).

## Technika
- Świat 1280×720, kartka 968×580, warstwa rysunku 1,6× gęstsza (`RES`).
- Kreska rysuje się na osobnej warstwie i dopiero po puszczeniu palca trafia na rysunek, więc półprzezroczyste narzędzia nie ciemnieją, gdy kreska sama się przecina.
- Wiaderko: wypełnianie liniami poziomymi z tolerancją i poszerzeniem o 1 px (bez jasnej obwódki).
- Cofanie: do 10 kroków.
- Naklejki to emoji (system rysuje je w kolorze), cache 96 px do interfejsu i 256 px do przyklejania.
- IndexedDB `rysowanka`: `rysunki` (id, t, paper, img PNG, thumb JPEG) i `stan/biezacy`.
- `localStorage`: `rysowanka-tool`, `-color`, `-size`, `-recent`, `-sound`.
- Konsola testowa: `__rysowanka.startGame()`, `.tool('kredka')`, `.color(i)`, `.size(i)`, `.line([{x,y},…])`, `.fill(x,y)`, `.sticker('🦁',x,y)`, `.undo()`, `.save()`, `.gallery()`, `.newPage('#FFFFFF')`.

## Pomysły na dalej
- ⏳ Kolorowanki: gotowe kontury (zwierzęta, auta) do malowania wiaderkiem.
- ⏳ Stempelki kształtów (koło, serce, gwiazda) i linijka.
- ⏳ Obracanie i przesuwanie naklejki po przyklejeniu.
- ⏳ Lustro (rysowanie symetryczne) i pędzel „konfetti”.
- ⏳ Układ pionowy na telefonie.
