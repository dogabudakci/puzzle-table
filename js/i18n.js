// The app in English, Turkish or German.
//
// The app is written in English; this translates what's on screen as it appears. Each row of
// TEXTS is [English, Türkçe, Deutsch]. A {placeholder} matches any text (a name, a number…),
// which is carried over into the translation. Texts joined with " · " are translated part by
// part. Anything not listed simply stays in English.
//
// The language is the browser's (if it's one of these), or the one picked in Settings.

const LANGUAGE_KEY = 'puzzle-language';
export const LANGUAGES = { en: 'English', tr: 'Türkçe', de: 'Deutsch' };
const COLUMN = { tr: 1, de: 2 };

const TEXTS = [
  // ----- Start page -----
  ['Puzzle Table · Piece by Piece, Find Your Peace', 'Puzzle Table · Parça parça, huzurunu bul', 'Puzzle Table · Stück für Stück zur Ruhe finden'],
  ['Turn your favorite memories and photos into jigsaw puzzles. Pick your pace, choose a table, and play alone or with a friend.',
    'En sevdiğin anıları ve fotoğrafları yapboza dönüştür. Temponu seç, bir masa seç; tek başına ya da bir arkadaşınla oyna.',
    'Mach aus deinen liebsten Erinnerungen und Fotos Puzzles. Wähle dein Tempo und einen Tisch und spiel allein oder mit Freunden.'],
  ['My gallery', 'Galerim', 'Meine Galerie'],
  ['Friends', 'Arkadaşlar', 'Freunde'],
  ['Settings', 'Ayarlar', 'Einstellungen'],
  ['Sign in', 'Giriş yap', 'Anmelden'],
  ['A little time for yourself', 'Kendine biraz zaman', 'Ein wenig Zeit für dich'],
  ['Make space for a quiet moment.', 'Sakin bir ana yer aç.', 'Schaff Raum für einen ruhigen Moment.'],
  ['Turn your favorite memories & photos into puzzles, find your rhythm, and enjoy the beauty of every piece.',
    'En sevdiğin anıları ve fotoğrafları yapboza dönüştür, ritmini bul ve her parçanın güzelliğinin tadını çıkar.',
    'Mach aus deinen liebsten Erinnerungen und Fotos Puzzles, finde deinen Rhythmus und genieße die Schönheit jedes Teils.'],
  ['Piece by Piece, Find Your Peace.', 'Parça parça, huzurunu bul.', 'Stück für Stück zur Ruhe finden.'],
  ['Continue your puzzle', 'Yapbozuna devam et', 'Setz dein Puzzle fort'],
  ['Continue', 'Devam et', 'Weiter'],
  ['Discard', 'Sil', 'Verwerfen'],
  ['Daily', 'Günlük', 'Täglich'],
  ['Daily ·', 'Günlük ·', 'Täglich ·'],
  ['Today among friends', 'Bugün arkadaşlar arasında', 'Heute unter Freunden'],
  ['Choose a photo', 'Bir fotoğraf seç', 'Wähle ein Foto'],
  ['Drop a photo here, or', 'Bir fotoğrafı buraya bırak ya da', 'Zieh ein Foto hierher oder'],
  ['browse', 'göz at', 'durchsuche'],
  ['JPG, PNG or WebP · at least 300 px on the short side', 'JPG, PNG veya WebP · kısa kenarı en az 300 px', 'JPG, PNG oder WebP · kurze Seite mindestens 300 px'],
  ['Replace', 'Değiştir', 'Ersetzen'],
  ['Allow peeking', 'Bakmaya izin ver', 'Spicken erlauben'],
  ['Show the reference picture during the game (R)', 'Oyun sırasında örnek resmi göster (R)', 'Vorlage während des Spiels zeigen (R)'],
  ['Mystery puzzle', 'Gizemli yapboz', 'Überraschungspuzzle'],
  ['A random photo from the library, kept secret until it’s finished.', 'Kütüphaneden rastgele bir fotoğraf; bitene kadar gizli kalır.', 'Ein zufälliges Foto aus der Bibliothek, geheim bis es fertig ist.'],
  ['Or pick one from our library', 'Ya da kütüphanemizden birini seç', 'Oder wähle eins aus unserer Bibliothek'],
  ['How long would you like to stay?', 'Ne kadar kalmak istersin?', 'Wie lange möchtest du bleiben?'],
  ['Choose a photo first.', 'Önce bir fotoğraf seç.', 'Wähle zuerst ein Foto.'],
  ['Pace', 'Tempo', 'Tempo'],
  ['Choose an exact number of pieces', 'Tam parça sayısını seç', 'Genaue Teilezahl wählen'],
  ['Number of pieces', 'Parça sayısı', 'Anzahl der Teile'],
  ['Table surface', 'Masa yüzeyi', 'Tischoberfläche'],
  ['Timer', 'Zamanlayıcı', 'Zeitmesser'],
  ['Timer mode', 'Zamanlayıcı türü', 'Zeitmodus'],
  ['Stopwatch', 'Kronometre', 'Stoppuhr'],
  ['Counts up, no pressure', 'İleri sayar, baskı yok', 'Zählt hoch, ganz ohne Druck'],
  ['Countdown', 'Geri sayım', 'Countdown'],
  ['Beat the clock', 'Zamana karşı', 'Gegen die Uhr'],
  ['{a} min', '{a} dk', '{a} Min.'],
  ['1 hour', '1 saat', '1 Stunde'],
  ['Custom', 'Özel', 'Eigene'],
  ['minutes', 'dakika', 'Minuten'],
  ['Your puzzle', 'Yapbozun', 'Dein Puzzle'],
  ['Your photo will appear here, cut into pieces.', 'Fotoğrafın burada parçalara ayrılmış olarak görünecek.', 'Hier erscheint dein Foto, in Teile geschnitten.'],
  ['Pieces', 'Parçalar', 'Teile'],
  ['Table', 'Masa', 'Tisch'],
  ['Start puzzle', 'Yapboza başla', 'Puzzle starten'],
  ['Your photos stay on this device.', 'Fotoğrafların bu cihazda kalır.', 'Deine Fotos bleiben auf diesem Gerät.'],
  ['Your puzzles are saved privately to your account.', 'Yapbozların hesabına gizli olarak kaydedilir.', 'Deine Puzzles werden privat in deinem Konto gespeichert.'],
  ['About this site', 'Bu site hakkında', 'Über diese Seite'],
  ['Privacy', 'Gizlilik', 'Datenschutz'],
  ['Terms', 'Koşullar', 'Nutzungsbedingungen'],
  ['Contact', 'İletişim', 'Kontakt'],
  ['A quick break', 'Kısa bir mola', 'Eine kurze Pause'],
  ['Settle in', 'Yerleş', 'Mach es dir gemütlich'],
  ['Stay a while', 'Biraz kal', 'Bleib eine Weile'],
  ['Lose yourself', 'Kendini kaptır', 'Versink darin'],
  ['{a} pieces', '{a} parça', '{a} Teile'],
  ['about {a} min', 'yaklaşık {a} dk', 'etwa {a} Min.'],
  ['Your photo or screen is too small for this many pieces', 'Fotoğrafın ya da ekranın bu kadar parça için çok küçük', 'Dein Foto oder Bildschirm ist für so viele Teile zu klein'],
  ['Not available here', 'Burada kullanılamaz', 'Hier nicht verfügbar'],
  ['Suggested for {a} pieces: {b} minutes.', '{a} parça için önerilen: {b} dakika.', 'Empfohlen für {a} Teile: {b} Minuten.'],
  ['Countdown · {a} min', 'Geri sayım · {a} dk', 'Countdown · {a} Min.'],
  ['Photo resolution is too low for this many pieces', 'Fotoğraf çözünürlüğü bu kadar parça için çok düşük', 'Die Auflösung des Fotos reicht für so viele Teile nicht'],
  ['Pieces would be too small on this screen', 'Parçalar bu ekranda çok küçük olurdu', 'Die Teile wären auf diesem Bildschirm zu klein'],
  ['That file is not an image. Please choose a JPG, PNG or WebP photo.', 'Bu dosya bir resim değil. Lütfen JPG, PNG veya WebP bir fotoğraf seç.', 'Diese Datei ist kein Bild. Bitte wähle ein JPG-, PNG- oder WebP-Foto.'],
  ['This image could not be read. Try another photo.', 'Bu resim okunamadı. Başka bir fotoğraf dene.', 'Dieses Bild konnte nicht gelesen werden. Versuch ein anderes Foto.'],
  ['Too small', 'Çok küçük', 'Zu klein'],
  ['Low resolution', 'Düşük çözünürlük', 'Geringe Auflösung'],
  ['Good', 'İyi', 'Gut'],
  ['Excellent', 'Mükemmel', 'Ausgezeichnet'],
  ['This photo is too small to make a puzzle. Please use one that is at least 300 px on its shorter side.',
    'Bu fotoğraf yapboz için çok küçük. Lütfen kısa kenarı en az 300 px olan bir fotoğraf kullan.',
    'Dieses Foto ist für ein Puzzle zu klein. Bitte nimm eins mit mindestens 300 px an der kürzeren Seite.'],
  ['This will work, but pieces may look blurry. A smaller number of pieces is recommended.', 'Olur, ama parçalar bulanık görünebilir. Daha az parça öneririz.', 'Das geht, aber die Teile können unscharf wirken. Weniger Teile sind empfehlenswert.'],
  ['Good resolution. Pieces will look sharp.', 'İyi çözünürlük. Parçalar net görünecek.', 'Gute Auflösung. Die Teile werden scharf.'],
  ['Excellent resolution. You can make a puzzle with lots of pieces.', 'Mükemmel çözünürlük. Çok parçalı bir yapboz yapabilirsin.', 'Ausgezeichnete Auflösung. Du kannst ein Puzzle mit vielen Teilen machen.'],
  ["That photo couldn't be loaded. Try another one.", 'Bu fotoğraf yüklenemedi. Başka birini dene.', 'Dieses Foto konnte nicht geladen werden. Versuch ein anderes.'],
  ["A mystery photo couldn't be loaded. Try again.", 'Gizemli fotoğraf yüklenemedi. Tekrar dene.', 'Das Überraschungsfoto konnte nicht geladen werden. Versuch es noch einmal.'],
  ['Photo library', 'Fotoğraf kütüphanesi', 'Fotobibliothek'],

  // ----- Daily puzzle -----
  ['{a}-day streak', '{a} günlük seri', '{a} Tage in Folge'],
  ['Start a streak today', 'Bugün bir seri başlat', 'Starte heute eine Serie'],
  ['Lovely work. A new puzzle arrives in {a} h {b} min. See you tomorrow.', 'Harika iş. Yeni yapboz {a} sa {b} dk sonra geliyor. Yarın görüşürüz.', 'Schön gemacht. Das nächste Puzzle kommt in {a} Std. {b} Min. Bis morgen!'],
  ['Done for today', 'Bugünlük tamam', 'Für heute erledigt'],
  ['Play today to keep your {a}-day streak going.', '{a} günlük serini sürdürmek için bugün oyna.', 'Spiel heute, damit deine Serie von {a} Tagen weitergeht.'],
  ['A new {a}-piece puzzle every day, the same one for everyone.', 'Her gün herkes için aynı, yeni bir {a} parçalık yapboz.', 'Jeden Tag ein neues Puzzle mit {a} Teilen, für alle dasselbe.'],
  ['Play today’s puzzle', 'Bugünün yapbozunu oyna', 'Spiel das heutige Puzzle'],
  ["Today's puzzle couldn't be loaded. Try again in a moment.", 'Bugünün yapbozu yüklenemedi. Birazdan tekrar dene.', 'Das heutige Puzzle konnte nicht geladen werden. Versuch es gleich noch einmal.'],
  ['Daily puzzle done', 'Günlük yapboz tamam', 'Tagespuzzle geschafft'],
  ['streak started', 'seri başladı', 'Serie gestartet'],
  ['#{a} of {b} friends today', 'bugün {b} arkadaş arasında {a}.', 'heute Platz {a} von {b} Freunden'],
  ['Daily puzzle', 'Günlük yapboz', 'Tagespuzzle'],
  ['You', 'Sen', 'Du'],

  // ----- Continue -----
  ['{a} played', '{a} oynandı', '{a} gespielt'],
  ['just now', 'az önce', 'gerade eben'],
  ['{a} min ago', '{a} dk önce', 'vor {a} Min.'],
  ['{a} h ago', '{a} sa önce', 'vor {a} Std.'],
  ['{a} days ago', '{a} gün önce', 'vor {a} Tagen'],
  ["That puzzle couldn't be opened. Try starting a new one.", 'Bu yapboz açılamadı. Yeni bir tane başlatmayı dene.', 'Dieses Puzzle ließ sich nicht öffnen. Starte am besten ein neues.'],

  // ----- Playing -----
  ['Leave puzzle', 'Yapbozdan çık', 'Puzzle verlassen'],
  ['Pause (P)', 'Duraklat (P)', 'Pause (P)'],
  ['Resume (P)', 'Devam et (P)', 'Fortsetzen (P)'],
  ['Hint (H)', 'İpucu (H)', 'Tipp (H)'],
  ['Hint (H): show two pieces that fit', 'İpucu (H): birbirine uyan iki parçayı göster', 'Tipp (H): zwei passende Teile zeigen'],
  ['Undo (Ctrl+Z)', 'Geri al (Ctrl+Z)', 'Rückgängig (Strg+Z)'],
  ['Undo last move (Ctrl+Z)', 'Son hamleyi geri al (Ctrl+Z)', 'Letzten Zug rückgängig machen (Strg+Z)'],
  ['Edges only (E)', 'Sadece kenarlar (E)', 'Nur Ränder (E)'],
  ['Edges only (E): fade the inner pieces', 'Sadece kenarlar (E): iç parçaları soluklaştır', 'Nur Ränder (E): innere Teile ausblenden'],
  ['{a} of {b} pieces connected', '{b} parçanın {a} tanesi birleşti', '{a} von {b} Teilen verbunden'],
  ['complete', 'tamamlandı', 'fertig'],
  ['Send a reaction', 'Tepki gönder', 'Reaktion senden'],
  ['Reference picture (R)', 'Örnek resim (R)', 'Vorlage (R)'],
  ['Tips', 'İpuçları', 'Tipps'],
  ['Music (M)', 'Müzik (M)', 'Musik (M)'],
  ['Change table', 'Masayı değiştir', 'Tisch wechseln'],
  ['Sound', 'Ses', 'Ton'],
  ['Sound on', 'Ses açık', 'Ton an'],
  ['Sound off', 'Ses kapalı', 'Ton aus'],
  ['Full screen (F)', 'Tam ekran (F)', 'Vollbild (F)'],
  ['Exit full screen (F)', 'Tam ekrandan çık (F)', 'Vollbild beenden (F)'],
  ['Zoom', 'Yakınlaştırma', 'Zoom'],
  ['Zoom in (+)', 'Yakınlaştır (+)', 'Vergrößern (+)'],
  ['Zoom out (−)', 'Uzaklaştır (−)', 'Verkleinern (−)'],
  ['See the whole table (0)', 'Tüm masayı gör (0)', 'Ganzen Tisch zeigen (0)'],
  ['The finished picture', 'Bitmiş resim', 'Das fertige Bild'],
  ['Reference', 'Örnek', 'Vorlage'],
  ['Hide reference picture', 'Örnek resmi gizle', 'Vorlage ausblenden'],
  ['{a}-piece puzzle', '{a} parçalık yapboz', 'Puzzle mit {a} Teilen'],
  ['Mystery puzzle · {a} pieces', 'Gizemli yapboz · {a} parça', 'Überraschungspuzzle · {a} Teile'],
  ['Mystery revealed: {a}', 'Gizem çözüldü: {a}', 'Das Geheimnis ist gelüftet: {a}'],
  ['solved without peeking', 'bakmadan çözüldü', 'ohne Spicken gelöst'],
  ['A quarter done. Nice and steady.', 'Dörtte biri tamam. Sakin ve istikrarlı.', 'Ein Viertel geschafft. Schön gleichmäßig.'],
  ['Halfway there. Take your time.', 'Yarı yoldasın. Acele etme.', 'Halbzeit. Lass dir Zeit.'],
  ['Three quarters done. Almost there.', 'Dörtte üçü tamam. Az kaldı.', 'Drei Viertel geschafft. Fast da.'],
  ['Get ready…', 'Hazır ol…', 'Mach dich bereit…'],
  ['Open the pouch and spill {a} pieces', 'Keseyi aç ve {a} parçayı dök', 'Öffne den Beutel und schütte {a} Teile aus'],
  ['Click the pouch to spill {a} pieces', '{a} parçayı dökmek için keseye tıkla', 'Klick auf den Beutel, um {a} Teile auszuschütten'],
  ['Cutting your pieces…', 'Parçaların kesiliyor…', 'Deine Teile werden geschnitten…'],
  ['Paused', 'Duraklatıldı', 'Pausiert'],
  ['The clock is stopped and the table is hidden.', 'Saat durdu ve masa gizlendi.', 'Die Uhr steht und der Tisch ist verdeckt.'],
  ['Resume', 'Devam et', 'Fortsetzen'],
  ["Time's up", 'Süre doldu', 'Die Zeit ist um'],
  ['You got {a}% of the puzzle done. Keep going without the clock, or start over?', 'Yapbozun %{a} kadarını bitirdin. Saat olmadan devam mı, yoksa baştan mı?', 'Du hast {a} % geschafft. Ohne Uhr weitermachen oder neu anfangen?'],
  ['New puzzle', 'Yeni yapboz', 'Neues Puzzle'],
  ['Keep going', 'Devam et', 'Weitermachen'],
  ['Puzzle complete', 'Yapboz tamamlandı', 'Puzzle fertig'],
  ['Time', 'Süre', 'Zeit'],
  ['Moves', 'Hamle', 'Züge'],
  ['Hints', 'İpucu', 'Tipps'],
  ['To spare', 'Kalan süre', 'Übrig'],
  ['None', 'Yok', 'Keine'],
  ['Game', 'Oyun', 'Spiel'],
  ['Play again', 'Tekrar oyna', 'Nochmal spielen'],
  ['Rematch', 'Rövanş', 'Revanche'],
  ['Games', 'Oyunlar', 'Spiele'],
  ['View in gallery', 'Galeride gör', 'In der Galerie ansehen'],
  ['Framed and hung in your gallery', 'Çerçevelendi ve galerine asıldı', 'Gerahmt und in deiner Galerie aufgehängt'],
  ['Achievement unlocked: {a}', 'Başarı kazanıldı: {a}', 'Erfolg freigeschaltet: {a}'],
  ['New personal best · {a} pieces', 'Yeni kişisel rekor · {a} parça', 'Neue Bestzeit · {a} Teile'],
  ['Your best: {a}', 'En iyi süren: {a}', 'Deine Bestzeit: {a}'],
  ["Couldn't save to your gallery: this browser isn't allowing storage.", 'Galerine kaydedilemedi: bu tarayıcı depolamaya izin vermiyor.', 'Konnte nicht in deiner Galerie speichern: Dieser Browser erlaubt keinen Speicher.'],
  ['Connection lost. Reconnecting…', 'Bağlantı koptu. Yeniden bağlanılıyor…', 'Verbindung verloren. Neu verbinden…'],
  ['Go!', 'Başla!', 'Los!'],

  // ----- Tips -----
  ['Drag the pieces', 'Parçaları sürükle', 'Zieh die Teile'],
  ['Pieces that belong together snap into place when you bring them close. Build the picture on the mat in the middle.',
    'Birbirine ait parçalar yaklaştırınca yerine oturur. Resmi ortadaki altlıkta oluştur.',
    'Zusammengehörige Teile rasten ein, wenn du sie nah zusammenbringst. Leg das Bild auf der Unterlage in der Mitte.'],
  ['Zoom in for a closer look', 'Daha yakından bakmak için yakınlaştır', 'Zoom für einen genaueren Blick'],
  ['Pinch, or use the mouse wheel, to zoom. Drag the empty table to look around. The buttons in the corner do the same.',
    'Yakınlaştırmak için iki parmakla sıkıştır ya da fare tekerleğini kullan. Etrafa bakmak için boş masayı sürükle. Köşedeki düğmeler de aynı işi yapar.',
    'Zum Zoomen zwei Finger spreizen oder das Mausrad nutzen. Zieh den leeren Tisch, um dich umzusehen. Die Knöpfe in der Ecke tun dasselbe.'],
  ['A little help', 'Biraz yardım', 'Ein bisschen Hilfe'],
  ['The bulb shows two pieces that fit. The edge button fades the inner pieces, so the border is easier to find.',
    'Ampul birbirine uyan iki parçayı gösterir. Kenar düğmesi iç parçaları soluklaştırır, böylece kenarı bulmak kolaylaşır.',
    'Die Glühbirne zeigt zwei passende Teile. Der Rand-Knopf blendet die inneren Teile aus, so findest du den Rand leichter.'],
  ['Tip {a} of {b}', 'İpucu {a}/{b}', 'Tipp {a} von {b}'],
  ['Skip', 'Geç', 'Überspringen'],
  ['Got it', 'Anladım', 'Verstanden'],
  ['Next', 'İleri', 'Weiter'],

  // ----- Music -----
  ['Music', 'Müzik', 'Musik'],
  ['Hide music panel', 'Müzik panelini gizle', 'Musikbereich ausblenden'],
  ['Mood', 'Ruh hali', 'Stimmung'],
  ['Play music', 'Müzik çal', 'Musik abspielen'],
  ['Pause music', 'Müziği duraklat', 'Musik pausieren'],
  ['Not playing', 'Çalmıyor', 'Keine Musik'],
  ['Playing', 'Çalıyor', 'Läuft'],
  ['Volume', 'Ses düzeyi', 'Lautstärke'],
  ['Play your own music files', 'Kendi müzik dosyalarını çal', 'Eigene Musikdateien abspielen'],
  ['{a} file loaded', '{a} dosya yüklendi', '{a} Datei geladen'],
  ['{a} files loaded', '{a} dosya yüklendi', '{a} Dateien geladen'],
  ['choose others', 'başkalarını seç', 'andere wählen'],
  ['Made live in your browser: free to enjoy, no licences or downloads.', 'Tarayıcında canlı üretilir: lisans ya da indirme gerekmeden ücretsiz.', 'Live in deinem Browser erzeugt: kostenlos, ohne Lizenzen oder Downloads.'],
  ['Audio could not start. Press Play to try again.', 'Ses başlatılamadı. Tekrar denemek için Oynat’a bas.', 'Der Ton konnte nicht starten. Drück auf Abspielen, um es erneut zu versuchen.'],
  ['Soft piano', 'Yumuşak piyano', 'Sanftes Klavier'],
  ['Gentle notes, slow chords', 'Nazik notalar, yavaş akorlar', 'Sanfte Töne, langsame Akkorde'],
  ['Warm ambient', 'Sıcak ambiyans', 'Warme Klangflächen'],
  ['Slow pads and soft bells', 'Yavaş tınılar ve yumuşak çanlar', 'Langsame Flächen und sanfte Glocken'],
  ['Lo-fi', 'Lo-fi', 'Lo-fi'],
  ['Mellow beats and chords', 'Yumuşak ritimler ve akorlar', 'Entspannte Beats und Akkorde'],
  ['Music box', 'Müzik kutusu', 'Spieluhr'],
  ['A tiny lullaby', 'Minik bir ninni', 'Ein kleines Schlaflied'],
  ['Rain', 'Yağmur', 'Regen'],
  ['Soft rainfall', 'Hafif yağmur', 'Leiser Regen'],
  ['Forest', 'Orman', 'Wald'],
  ['Breeze and birdsong', 'Esinti ve kuş sesleri', 'Brise und Vogelgesang'],

  // ----- Tables -----
  ['Oak', 'Meşe', 'Eiche'],
  ['Walnut', 'Ceviz', 'Nussbaum'],
  ['White marble', 'Beyaz mermer', 'Weißer Marmor'],
  ['Cream marble', 'Krem mermer', 'Cremefarbener Marmor'],
  ['Black marble', 'Siyah mermer', 'Schwarzer Marmor'],
  ['Green felt', 'Yeşil keçe', 'Grüner Filz'],
  ['Linen', 'Keten', 'Leinen'],
  ['Leather', 'Deri', 'Leder'],

  // ----- Gallery -----
  ['Back', 'Geri', 'Zurück'],
  ['Achievements', 'Başarılar', 'Erfolge'],
  ['Finished puzzles', 'Bitmiş yapbozlar', 'Fertige Puzzles'],
  ['The wall is empty for now. Finish a puzzle and it will be framed and hung here.', 'Duvar şimdilik boş. Bir yapboz bitir; çerçevelenip buraya asılsın.', 'Die Wand ist noch leer. Leg ein Puzzle fertig, dann wird es gerahmt und hier aufgehängt.'],
  ['Puzzle details', 'Yapboz ayrıntıları', 'Puzzle-Details'],
  ['Remove', 'Kaldır', 'Entfernen'],
  ['Click again to remove', 'Kaldırmak için tekrar tıkla', 'Zum Entfernen erneut klicken'],
  ['Download', 'İndir', 'Herunterladen'],
  ['Puzzle it again', 'Tekrar yapboz yap', 'Nochmal puzzeln'],
  ['Earned', 'Kazanıldı', 'Erreicht'],
  ['earned {a}', '{a} tarihinde kazanıldı', 'erreicht am {a}'],
  ['total time', 'toplam süre', 'Gesamtzeit'],
  ['Finished', 'Bitirildi', 'Fertig'],
  ['None, solved unaided', 'Yok, yardımsız çözüldü', 'Keine, ohne Hilfe gelöst'],
  ['beat the clock ✓', 'süreyi yendi ✓', 'Uhr geschlagen ✓'],
  ['finished after time ran out', 'süre bittikten sonra bitirildi', 'nach Ablauf der Zeit beendet'],
  ['{a}, {b} pieces. Open', '{a}, {b} parça. Aç', '{a}, {b} Teile. Öffnen'],
  ["Your gallery can't be opened: this browser isn't allowing storage.", 'Galerin açılamıyor: bu tarayıcı depolamaya izin vermiyor.', 'Deine Galerie lässt sich nicht öffnen: Dieser Browser erlaubt keinen Speicher.'],
  ['First Masterpiece', 'İlk Başyapıt', 'Erstes Meisterwerk'],
  ['Finish your first puzzle', 'İlk yapbozunu bitir', 'Leg dein erstes Puzzle fertig'],
  ['Collector', 'Koleksiyoncu', 'Sammlerin'],
  ['Finish 5 puzzles', '5 yapboz bitir', 'Leg 5 Puzzles fertig'],
  ['Curator', 'Küratör', 'Kuratorin'],
  ['Finish 15 puzzles', '15 yapboz bitir', 'Leg 15 Puzzles fertig'],
  ['Centurion', 'Yüzbaşı', 'Zenturio'],
  ['Finish a puzzle with 100 or more pieces', '100 veya daha fazla parçalı bir yapboz bitir', 'Leg ein Puzzle mit 100 oder mehr Teilen fertig'],
  ['Grand Master', 'Büyük Usta', 'Großmeister'],
  ['Finish a puzzle with 300 or more pieces', '300 veya daha fazla parçalı bir yapboz bitir', 'Leg ein Puzzle mit 300 oder mehr Teilen fertig'],
  ['Beat the Clock', 'Zamanı Yen', 'Schneller als die Uhr'],
  ['Finish a countdown puzzle before time runs out', 'Geri sayımlı bir yapbozu süre dolmadan bitir', 'Leg ein Countdown-Puzzle fertig, bevor die Zeit abläuft'],
  ['Quick Hands', 'Çevik Eller', 'Flinke Hände'],
  ['Finish 48 or more pieces in under 5 minutes', '48 veya daha fazla parçayı 5 dakikadan kısa sürede bitir', 'Leg 48 oder mehr Teile in unter 5 Minuten'],
  ['Unaided', 'Yardımsız', 'Ganz allein'],
  ['Finish 48 or more pieces without a hint', '48 veya daha fazla parçayı ipucu almadan bitir', 'Leg 48 oder mehr Teile ohne Tipp'],
  ['Table Hopper', 'Masa Gezgini', 'Tischwechsler'],
  ['Finish puzzles on 3 different tables', '3 farklı masada yapboz bitir', 'Leg Puzzles auf 3 verschiedenen Tischen'],

  // ----- Account -----
  ['Close', 'Kapat', 'Schließen'],
  ['Welcome', 'Hoş geldin', 'Willkommen'],
  ['Welcome!', 'Hoş geldin!', 'Willkommen!'],
  ['Sign in to keep your puzzles, streak and gallery with your account.', 'Yapbozlarını, serini ve galerini hesabında saklamak için giriş yap.', 'Melde dich an, um Puzzles, Serie und Galerie in deinem Konto zu behalten.'],
  ['Sign in or create an account', 'Giriş yap ya da hesap oluştur', 'Anmelden oder Konto erstellen'],
  ['Create account', 'Hesap oluştur', 'Konto erstellen'],
  ['Email or username', 'E-posta veya kullanıcı adı', 'E-Mail oder Benutzername'],
  ['Password', 'Şifre', 'Passwort'],
  ['At least 10 characters. A short phrase of a few words is easy to remember and hard to guess.',
    'En az 10 karakter. Birkaç kelimelik kısa bir cümle hem kolay hatırlanır hem de zor tahmin edilir.',
    'Mindestens 10 Zeichen. Ein kurzer Satz aus ein paar Wörtern ist leicht zu merken und schwer zu erraten.'],
  ['At least 10 characters. A short phrase of a few words is easy to remember and hard to guess. By creating an account you agree to the',
    'En az 10 karakter. Birkaç kelimelik kısa bir cümle hem kolay hatırlanır hem de zor tahmin edilir. Hesap oluşturarak şunları kabul etmiş olursun:',
    'Mindestens 10 Zeichen. Ein kurzer Satz aus ein paar Wörtern ist leicht zu merken und schwer zu erraten. Mit dem Erstellen eines Kontos stimmst du zu:'],
  ['and', 've', 'und'],
  ['Privacy policy', 'Gizlilik politikası', 'Datenschutzerklärung'],
  ['Forgot your password?', 'Şifreni mi unuttun?', 'Passwort vergessen?'],
  ['Reset your password', 'Şifreni sıfırla', 'Passwort zurücksetzen'],
  ['Enter the email of your account. If it’s confirmed, we’ll send you a link to choose a new password.', 'Hesabının e-postasını gir. Onaylıysa, yeni bir şifre seçmen için bir bağlantı göndereceğiz.', 'Gib die E-Mail deines Kontos ein. Wenn sie bestätigt ist, schicken wir dir einen Link für ein neues Passwort.'],
  ['Email', 'E-posta', 'E-Mail'],
  ['Send reset link', 'Sıfırlama bağlantısı gönder', 'Link zum Zurücksetzen senden'],
  ['Back to sign in', 'Girişe dön', 'Zurück zur Anmeldung'],
  ['Choose a new password', 'Yeni bir şifre seç', 'Wähle ein neues Passwort'],
  ['This signs you out on every other device.', 'Bu, diğer tüm cihazlarda oturumunu kapatır.', 'Damit wirst du auf allen anderen Geräten abgemeldet.'],
  ['New password', 'Yeni şifre', 'Neues Passwort'],
  ['Save new password', 'Yeni şifreyi kaydet', 'Neues Passwort speichern'],
  ['OK', 'Tamam', 'OK'],
  ['Your account', 'Hesabın', 'Dein Konto'],
  ['Signed in as', 'Giriş yapan:', 'Angemeldet als'],
  ['Sign out', 'Çıkış yap', 'Abmelden'],
  ['Resend confirmation email', 'Onay e-postasını tekrar gönder', 'Bestätigungs-E-Mail erneut senden'],
  ['Sent. Check your inbox', 'Gönderildi. Gelen kutunu kontrol et', 'Gesendet. Schau in dein Postfach'],
  ['Download my data', 'Verilerimi indir', 'Meine Daten herunterladen'],
  ['Admin', 'Yönetim', 'Verwaltung'],
  ['Email for password recovery', 'Şifre kurtarma için e-posta', 'E-Mail zur Passwort-Wiederherstellung'],
  ['Change email', 'E-postayı değiştir', 'E-Mail ändern'],
  ['Add an email for password recovery', 'Şifre kurtarma için e-posta ekle', 'E-Mail zur Passwort-Wiederherstellung hinzufügen'],
  ['Your password', 'Şifren', 'Dein Passwort'],
  ['Send confirmation link', 'Onay bağlantısı gönder', 'Bestätigungslink senden'],
  ['Change password', 'Şifreyi değiştir', 'Passwort ändern'],
  ['Current password', 'Mevcut şifre', 'Aktuelles Passwort'],
  ['Delete account', 'Hesabı sil', 'Konto löschen'],
  ['This removes your account for good. Puzzles saved on this device stay here.', 'Bu, hesabını kalıcı olarak siler. Bu cihazda kayıtlı yapbozlar burada kalır.', 'Damit wird dein Konto endgültig gelöscht. Auf diesem Gerät gespeicherte Puzzles bleiben hier.'],
  ['Delete my account', 'Hesabımı sil', 'Mein Konto löschen'],
  ['Check {a} for a link to confirm it. Until then, a forgotten password can’t be reset.', '{a} adresine gelen onay bağlantısına bak. O zamana kadar unutulan şifre sıfırlanamaz.', 'Schau bei {a} nach dem Bestätigungslink. Bis dahin kann ein vergessenes Passwort nicht zurückgesetzt werden.'],
  ["Check {a} for a link to confirm it. Until then, a forgotten password can't be reset.", '{a} adresine gelen onay bağlantısına bak. O zamana kadar unutulan şifre sıfırlanamaz.', 'Schau bei {a} nach dem Bestätigungslink. Bis dahin kann ein vergessenes Passwort nicht zurückgesetzt werden.'],
  ['Email {a} is confirmed, so you can reset your password if you forget it.', '{a} onaylı; şifreni unutursan sıfırlayabilirsin.', '{a} ist bestätigt, du kannst dein Passwort also zurücksetzen, falls du es vergisst.'],
  ['Add an email so you can reset your password if you ever forget it.', 'Şifreni unutursan sıfırlayabilmek için bir e-posta ekle.', 'Füge eine E-Mail hinzu, damit du dein Passwort zurücksetzen kannst, falls du es vergisst.'],
  ["We've sent a link to {a}. Confirm it so you can reset your password if you ever forget it.", '{a} adresine bir bağlantı gönderdik. Onayla ki şifreni unutursan sıfırlayabilesin.', 'Wir haben einen Link an {a} geschickt. Bestätige ihn, damit du dein Passwort zurücksetzen kannst, falls du es vergisst.'],
  ['If that email belongs to an account and is confirmed, a reset link is on its way. It works for 30 minutes.', 'Bu e-posta onaylı bir hesaba aitse sıfırlama bağlantısı yolda. 30 dakika geçerli.', 'Wenn diese E-Mail zu einem bestätigten Konto gehört, ist ein Link unterwegs. Er gilt 30 Minuten.'],
  ['Password changed', 'Şifre değiştirildi', 'Passwort geändert'],
  ['{a} · password changed', '{a} · şifre değiştirildi', '{a} · Passwort geändert'],
  ["You're signed in with your new password. Every other device has been signed out.", 'Yeni şifrenle giriş yaptın. Diğer tüm cihazlarda oturum kapatıldı.', 'Du bist mit deinem neuen Passwort angemeldet. Alle anderen Geräte wurden abgemeldet.'],
  ['Email confirmed', 'E-posta onaylandı', 'E-Mail bestätigt'],
  ['You can now reset your password with this email if you ever forget it.', 'Artık şifreni unutursan bu e-postayla sıfırlayabilirsin.', 'Jetzt kannst du dein Passwort mit dieser E-Mail zurücksetzen, falls du es vergisst.'],
  ["That link didn't work", 'Bu bağlantı çalışmadı', 'Dieser Link hat nicht funktioniert'],
  ["Can't reach the server. Check your connection and try again.", 'Sunucuya ulaşılamıyor. Bağlantını kontrol edip tekrar dene.', 'Der Server ist nicht erreichbar. Prüf deine Verbindung und versuch es erneut.'],
  ['Something went wrong. Please try again.', 'Bir şeyler ters gitti. Lütfen tekrar dene.', 'Etwas ist schiefgelaufen. Bitte versuch es erneut.'],

  // ----- Settings -----
  ['Saved on this device.', 'Bu cihaza kaydedilir.', 'Auf diesem Gerät gespeichert.'],
  ['Sound effects', 'Ses efektleri', 'Soundeffekte'],
  ['Effects volume', 'Efekt ses düzeyi', 'Lautstärke der Effekte'],
  ['Music volume', 'Müzik ses düzeyi', 'Musiklautstärke'],
  ['Language', 'Dil', 'Sprache'],
  ['Help', 'Yardım', 'Hilfe'],
  ['Tips for new players', 'Yeni oyuncular için ipuçları', 'Tipps für neue Spieler'],
  ['Show again', 'Tekrar göster', 'Erneut zeigen'],
  ['The tips will show in your next puzzle.', 'İpuçları bir sonraki yapbozunda gösterilecek.', 'Die Tipps erscheinen bei deinem nächsten Puzzle.'],
  ['Keyboard:', 'Klavye:', 'Tastatur:'],
  ['H hint · E edges · R reference · P pause · M music · + / − zoom · 0 whole table · F full screen',
    'H ipucu · E kenarlar · R örnek · P duraklat · M müzik · + / − yakınlaştırma · 0 tüm masa · F tam ekran',
    'H Tipp · E Ränder · R Vorlage · P Pause · M Musik · + / − Zoom · 0 ganzer Tisch · F Vollbild'],

  // ----- Friends -----
  ['Choose a username', 'Bir kullanıcı adı seç', 'Wähle einen Benutzernamen'],
  ["Friends add you by your username. It's the only thing they see about you: never your email.", 'Arkadaşların seni kullanıcı adınla ekler. Senin hakkında gördükleri tek şey budur, e-postan asla görünmez.', 'Freunde fügen dich über deinen Benutzernamen hinzu. Nur ihn sehen sie von dir, nie deine E-Mail.'],
  ['Username', 'Kullanıcı adı', 'Benutzername'],
  ["3–24 characters: letters, numbers, dots, dashes or underscores. It can't be changed later.", '3–24 karakter: harf, rakam, nokta, tire veya alt çizgi. Sonradan değiştirilemez.', '3–24 Zeichen: Buchstaben, Zahlen, Punkte, Binde- oder Unterstriche. Er lässt sich später nicht ändern.'],
  ['Save username', 'Kullanıcı adını kaydet', 'Benutzernamen speichern'],
  ['Play with friends', 'Arkadaşlarla oyna', 'Mit Freunden spielen'],
  ['Your username is', 'Kullanıcı adın:', 'Dein Benutzername ist'],
  ['. Share it so friends can add you.', '. Arkadaşların seni ekleyebilsin diye paylaş.', '. Teile ihn, damit Freunde dich hinzufügen können.'],
  ["Your friend's username", 'Arkadaşının kullanıcı adı', 'Benutzername deines Freundes'],
  ['Add friend', 'Arkadaş ekle', 'Freund hinzufügen'],
  ['No friends yet. Ask a friend for their username and add them here.', 'Henüz arkadaşın yok. Bir arkadaşından kullanıcı adını iste ve buradan ekle.', 'Noch keine Freunde. Frag jemanden nach dem Benutzernamen und füge ihn hier hinzu.'],
  ['No games yet. Pick a friend and press Play.', 'Henüz oyun yok. Bir arkadaş seç ve Oyna’ya bas.', 'Noch keine Spiele. Wähle einen Freund und drück auf Spielen.'],
  ['Friend requests', 'Arkadaşlık istekleri', 'Freundschaftsanfragen'],
  ['Your friends', 'Arkadaşların', 'Deine Freunde'],
  ['Waiting for an answer', 'Yanıt bekleniyor', 'Warten auf Antwort'],
  ['Blocked', 'Engellenenler', 'Blockiert'],
  ['Unblock', 'Engeli kaldır', 'Blockierung aufheben'],
  ['Online now', 'Şu an çevrimiçi', 'Gerade online'],
  ['Offline', 'Çevrimdışı', 'Offline'],
  ['Accept', 'Kabul et', 'Annehmen'],
  ['Decline', 'Reddet', 'Ablehnen'],
  ['Play', 'Oyna', 'Spielen'],
  ['Cancel', 'İptal', 'Abbrechen'],
  ['Sure?', 'Emin misin?', 'Sicher?'],
  ['More for {a}', '{a} için diğer seçenekler', 'Mehr zu {a}'],
  ['Remove friend', 'Arkadaşlıktan çıkar', 'Freund entfernen'],
  ['Remove {a}? Open games with them end too.', '{a} çıkarılsın mı? Açık oyunlarınız da biter.', '{a} entfernen? Offene Spiele mit ihr oder ihm enden auch.'],
  ['Block', 'Engelle', 'Blockieren'],
  ["Block {a}? You won't be friends any more and they can't send you requests.", '{a} engellensin mi? Artık arkadaş olmazsınız ve sana istek gönderemez.', '{a} blockieren? Ihr seid dann keine Freunde mehr und es kommen keine Anfragen mehr.'],
  ['Report…', 'Şikâyet et…', 'Melden…'],
  ['Tap again to confirm', 'Onaylamak için tekrar dokun', 'Zum Bestätigen erneut tippen'],
  ['{a} is blocked.', '{a} engellendi.', '{a} ist blockiert.'],
  ['You and {a} are friends now.', 'Sen ve {a} artık arkadaşsınız.', 'Du und {a} seid jetzt Freunde.'],
  ['Request sent. Once {a} accepts, you can play together.', 'İstek gönderildi. {a} kabul edince birlikte oynayabilirsiniz.', 'Anfrage gesendet. Sobald {a} annimmt, könnt ihr zusammen spielen.'],
  ['You {a} – {b}', 'Sen {a} – {b}', 'Du {a} – {b}'],
  ['{a} together', '{a} birlikte', '{a} gemeinsam'],
  ['({a} drawn)', '({a} berabere)', '({a} unentschieden)'],
  ['Play with', 'Birlikte oyna:', 'Spielen mit'],
  ['How to play', 'Nasıl oynanır', 'Spielart'],
  ['Together', 'Birlikte', 'Gemeinsam'],
  ['Race', 'Yarış', 'Wettrennen'],
  ['Challenge', 'Meydan okuma', 'Herausforderung'],
  ['together', 'birlikte', 'gemeinsam'],
  ['race', 'yarış', 'Wettrennen'],
  ['challenge', 'meydan okuma', 'Herausforderung'],
  ['One table. Both of you move pieces at the same time.', 'Tek masa. İkiniz de aynı anda parça taşırsınız.', 'Ein Tisch. Ihr bewegt beide gleichzeitig Teile.'],
  ['Start at the same moment. The first to finish wins.', 'Aynı anda başlayın. İlk bitiren kazanır.', 'Startet im selben Moment. Wer zuerst fertig ist, gewinnt.'],
  ['Each plays whenever you like. The faster time wins.', 'Herkes istediği zaman oynar. Daha hızlı olan kazanır.', 'Jeder spielt, wann er will. Die schnellere Zeit gewinnt.'],
  ['Puzzle', 'Yapboz', 'Puzzle'],
  ['Same for both', 'İkiniz için aynı', 'Für beide gleich'],
  ['Pick for each other', 'Birbiriniz için seçin', 'Füreinander aussuchen'],
  ['Photo for both of you', 'İkiniz için fotoğraf', 'Foto für euch beide'],
  ['Photo for {a}', '{a} için fotoğraf', 'Foto für {a}'],
  ['{a} picks yours when they accept.', '{a} kabul ederken seninkini seçecek.', '{a} sucht deins aus, wenn die Einladung angenommen wird.'],
  ['Use your own photo', 'Kendi fotoğrafını kullan', 'Eigenes Foto verwenden'],
  ['Picked: {a}', 'Seçilen: {a}', 'Ausgewählt: {a}'],
  ['Pick a photo from the library, or use your own.', 'Kütüphaneden bir fotoğraf seç ya da kendininkini kullan.', 'Wähle ein Foto aus der Bibliothek oder nimm dein eigenes.'],
  ['Please pick a photo first.', 'Lütfen önce bir fotoğraf seç.', 'Bitte wähle zuerst ein Foto.'],
  ['Send invite', 'Davet gönder', 'Einladung senden'],
  ['Send challenge', 'Meydan oku', 'Herausforderung senden'],
  ['Pick a puzzle for', 'Şunun için bir yapboz seç:', 'Wähle ein Puzzle für'],
  ['{a} picked a puzzle for you. Now pick one for them: {b} pieces.', '{a} senin için bir yapboz seçti. Şimdi sen onun için seç: {b} parça.', '{a} hat ein Puzzle für dich ausgesucht. Jetzt suchst du eins aus: {b} Teile.'],
  ['Accept and send', 'Kabul et ve gönder', 'Annehmen und senden'],
  ['Open games', 'Açık oyunlar', 'Offene Spiele'],
  ['Earlier', 'Önceki', 'Früher'],
  ['Together with {a}', '{a} ile birlikte', 'Gemeinsam mit {a}'],
  ['Race with {a}', '{a} ile yarış', 'Wettrennen mit {a}'],
  ['Challenge with {a}', '{a} ile meydan okuma', 'Herausforderung mit {a}'],
  ['{a} invited you', '{a} seni davet etti', '{a} hat dich eingeladen'],
  ['Waiting for {a} to answer', '{a} yanıt bekleniyor', 'Warten auf die Antwort von {a}'],
  ['{a} said no this time', '{a} bu sefer hayır dedi', '{a} hat diesmal abgesagt'],
  ['Cancelled', 'İptal edildi', 'Abgebrochen'],
  ['Finished together in {a}', '{a} sürede birlikte bitirildi', 'Gemeinsam fertig in {a}'],
  ['Finished together', 'Birlikte bitirildi', 'Gemeinsam fertig'],
  ['{a} vs {b}', '{a} – {b}', '{a} gegen {b}'],
  ['You won', 'Kazandın', 'Du hast gewonnen'],
  ['{a} won', '{a} kazandı', '{a} hat gewonnen'],
  ['A draw', 'Berabere', 'Unentschieden'],
  ['Your time: {a}. Waiting for {b} to play', 'Süren: {a}. {b} oynaması bekleniyor', 'Deine Zeit: {a}. Warten, bis {b} spielt'],
  ['You started: the clock is running', 'Başladın: saat işliyor', 'Du hast angefangen: die Uhr läuft'],
  ['{a} has played. Your turn!', '{a} oynadı. Sıra sende!', '{a} hat gespielt. Du bist dran!'],
  ['Your turn: play whenever you like', 'Sıra sende: istediğin zaman oyna', 'Du bist dran: spiel, wann du willst'],
  ['In progress', 'Devam ediyor', 'Läuft'],
  ['Ready: join the table with {a}', 'Hazır: {a} ile masaya otur', 'Bereit: setz dich mit {a} an den Tisch'],
  ['picked for each other', 'birbiriniz için seçildi', 'füreinander ausgesucht'],
  ['Pick & accept', 'Seç ve kabul et', 'Aussuchen und annehmen'],
  ['Join table', 'Masaya otur', 'An den Tisch'],
  ['Leave', 'Ayrıl', 'Verlassen'],
  ['Give up', 'Pes et', 'Aufgeben'],
  ['{a} invited you: {b}, {c} pieces', '{a} seni davet etti: {b}, {c} parça', '{a} hat dich eingeladen: {b}, {c} Teile'],
  ['Open', 'Aç', 'Öffnen'],
  ['{a} is at the table', '{a} masada', '{a} sitzt am Tisch'],
  ['Join', 'Katıl', 'Beitreten'],
  ['{a} accepted your challenge', '{a} meydan okumanı kabul etti', '{a} hat deine Herausforderung angenommen'],
  ["{a} can't play right now", '{a} şu an oynayamıyor', '{a} kann gerade nicht spielen'],
  ['You won the challenge', 'Meydan okumayı kazandın', 'Du hast die Herausforderung gewonnen'],
  ['{a} won the challenge', '{a} meydan okumayı kazandı', '{a} hat die Herausforderung gewonnen'],
  ['See', 'Gör', 'Ansehen'],
  ['Dismiss', 'Kapat', 'Schließen'],
  ['{a} hasn’t answered yet.', '{a} henüz yanıt vermedi.', '{a} hat noch nicht geantwortet.'],
  ["{a} hasn't answered yet.", '{a} henüz yanıt vermedi.', '{a} hat noch nicht geantwortet.'],
  ['This game is over.', 'Bu oyun bitti.', 'Dieses Spiel ist vorbei.'],

  // ----- Playing with a friend -----
  ['Together with {a} · {b} pieces', '{a} ile birlikte · {b} parça', 'Gemeinsam mit {a} · {b} Teile'],
  ['Race with {a} · {b} pieces', '{a} ile yarış · {b} parça', 'Wettrennen mit {a} · {b} Teile'],
  ['Challenge with {a} · {b} pieces', '{a} ile meydan okuma · {b} parça', 'Herausforderung mit {a} · {b} Teile'],
  ['with {a}', '{a} ile', 'mit {a}'],
  ['vs {a}', '{a} karşısında', 'gegen {a}'],
  ['Race against {a}', '{a} ile yarış', 'Wettrennen gegen {a}'],
  ['Puzzling with {a}', '{a} ile yapboz', 'Puzzeln mit {a}'],
  ['Waiting for {a} to join the table…', '{a} masaya gelmesi bekleniyor…', 'Warten, bis {a} an den Tisch kommt…'],
  ['{a} finished first in {b}. Finish yours for fun!', '{a} {b} sürede önce bitirdi. Seninkini keyfine bitir!', '{a} war nach {b} zuerst fertig. Mach deins zum Spaß fertig!'],
  ['This game with {a} has ended.', '{a} ile bu oyun sona erdi.', 'Dieses Spiel mit {a} ist beendet.'],
  ['{a} left the table. You can finish on your own.', '{a} masadan ayrıldı. Tek başına bitirebilirsin.', '{a} hat den Tisch verlassen. Du kannst allein weitermachen.'],
  ['{a} gave up. You win the race!', '{a} pes etti. Yarışı sen kazandın!', '{a} hat aufgegeben. Du gewinnst das Rennen!'],
  ['{a} left the game.', '{a} oyundan ayrıldı.', '{a} hat das Spiel verlassen.'],
  ['Finished together with {a} in {b}', '{a} ile birlikte {b} sürede bitirildi', 'Gemeinsam mit {a} fertig in {b}'],
  ['Finished together with {a}', '{a} ile birlikte bitirildi', 'Gemeinsam mit {a} fertig'],
  ['{a} finished first. Well played!', '{a} önce bitirdi. İyi oyundu!', '{a} war zuerst fertig. Gut gespielt!'],
  ['You won the race against {a}!', '{a} karşısında yarışı kazandın!', 'Du hast das Rennen gegen {a} gewonnen!'],
  ["Your time is in. {a} hasn't played yet: we'll let you know.", 'Süren kaydedildi. {a} henüz oynamadı; haber vereceğiz.', 'Deine Zeit ist eingetragen. {a} hat noch nicht gespielt: Wir sagen dir Bescheid.'],
  ['You won the challenge against {a} ({b} vs {c})!', '{a} karşısında meydan okumayı kazandın ({b} – {c})!', 'Du hast die Herausforderung gegen {a} gewonnen ({b} gegen {c})!'],
  ['You won the challenge against {a}!', '{a} karşısında meydan okumayı kazandın!', 'Du hast die Herausforderung gegen {a} gewonnen!'],
  ['{a} won this one ({b} vs {c}). Rematch?', 'Bunu {a} kazandı ({b} – {c}). Rövanş?', 'Diesmal hat {a} gewonnen ({b} gegen {c}). Revanche?'],
  ['{a} won this one. Rematch?', 'Bunu {a} kazandı. Rövanş?', 'Diesmal hat {a} gewonnen. Revanche?'],
  ['A draw with {a} ({b} vs {c})', '{a} ile berabere ({b} – {c})', 'Unentschieden gegen {a} ({b} gegen {c})'],
  ['A draw with {a}', '{a} ile berabere', 'Unentschieden gegen {a}'],
  ['{a} is here', '{a} burada', '{a} ist da'],
  ['{a} is away', '{a} uzakta', '{a} ist weg'],
  ['{a}% done', '%{a} tamam', '{a} % fertig'],

  // ----- Reports -----
  ['Report', 'Şikâyet et:', 'Melden:'],
  ["Reports are private: the player isn't told who reported them. We look at every one.", 'Şikâyetler gizlidir: oyuncuya kimin şikâyet ettiği söylenmez. Her birine bakıyoruz.', 'Meldungen sind vertraulich: Niemand erfährt, wer gemeldet hat. Wir sehen uns jede an.'],
  ["What's wrong?", 'Sorun ne?', 'Was ist los?'],
  ['Offensive username', 'Rahatsız edici kullanıcı adı', 'Beleidigender Benutzername'],
  ['Harassment or unkind behaviour', 'Taciz veya kaba davranış', 'Belästigung oder unfreundliches Verhalten'],
  ['Spam or unwanted requests', 'Spam veya istenmeyen istekler', 'Spam oder unerwünschte Anfragen'],
  ['Inappropriate photo', 'Uygunsuz fotoğraf', 'Unangemessenes Foto'],
  ['Cheating', 'Hile', 'Schummeln'],
  ['Something else', 'Başka bir şey', 'Etwas anderes'],
  ['Anything else we should know? (optional)', 'Bilmemiz gereken başka bir şey var mı? (isteğe bağlı)', 'Sollen wir noch etwas wissen? (optional)'],
  ['Also block them', 'Ayrıca engelle', 'Auch blockieren'],
  ['Send report', 'Şikâyeti gönder', 'Meldung senden'],
  ['Thank you. Your report was sent.', 'Teşekkürler. Şikâyetin gönderildi.', 'Danke. Deine Meldung wurde gesendet.'],
  ['Back to friends', 'Arkadaşlara dön', 'Zurück zu den Freunden'],

  // ----- Library photo names (photos added later keep the name they were given) -----
  ['Lake pier', 'Göl iskelesi', 'Seesteg'],
  ['Blue dome', 'Mavi kubbe', 'Blaue Kuppel'],
  ['Windmill', 'Yel değirmeni', 'Windmühle'],
  ['Orchids', 'Orkideler', 'Orchideen'],
  ['Still lake', 'Durgun göl', 'Stiller See'],
  ['Coastal rocks', 'Kıyı kayaları', 'Küstenfelsen'],
  ['Alpine house', 'Alp evi', 'Alpenhaus'],
  ['Ocean sunset', 'Okyanusta gün batımı', 'Sonnenuntergang am Meer'],
  ['Misty mountains', 'Sisli dağlar', 'Nebelberge'],
  ['Snow cabin', 'Karlı kulübe', 'Schneehütte'],
  ['Meadow', 'Çayır', 'Wiese'],
  ['Pink clouds', 'Pembe bulutlar', 'Rosa Wolken'],
  ['Rainy window', 'Yağmurlu pencere', 'Regenfenster'],
  ['Summer storm', 'Yaz fırtınası', 'Sommergewitter'],
  ['Eiffel Tower', 'Eyfel Kulesi', 'Eiffelturm'],
  ['Stonechat', 'Taşkuşu', 'Schwarzkehlchen'],
  ['Flower window', 'Çiçekli pencere', 'Blumenfenster'],
  ['Sunset pier', 'Gün batımında iskele', 'Steg im Abendlicht'],
  ['Paris rooftops', 'Paris çatıları', 'Pariser Dächer'],
  ['Pink tulip', 'Pembe lale', 'Rosa Tulpe'],
  ['Wildflower hills', 'Kır çiçekli tepeler', 'Wildblumenhügel'],
  ['Alpine valley', 'Alp vadisi', 'Alpental'],
  ['Painted bricks', 'Boyalı tuğlalar', 'Bemalte Ziegel'],
  ['Turquoise lake', 'Turkuaz göl', 'Türkiser See'],
  ['Prism light', 'Prizma ışığı', 'Prismenlicht'],
  ['Glass kaleidoscope', 'Cam kaleydoskop', 'Glaskaleidoskop'],
  ['Paris bridge', 'Paris köprüsü', 'Pariser Brücke'],
  ['Red sneakers', 'Kırmızı spor ayakkabılar', 'Rote Turnschuhe'],
  ['Golden palace', 'Altın saray', 'Goldener Palast'],
  ['Palm sunset', 'Palmiyeler ve gün batımı', 'Palmen im Abendrot'],
  ['Green mosaic', 'Yeşil mozaik', 'Grünes Mosaik'],
  ['Spring orchard', 'Bahar bahçesi', 'Obstgarten im Frühling'],
  ['Cliff walk', 'Uçurum yolu', 'Klippenweg'],
  ['Blue brushstrokes', 'Mavi fırça darbeleri', 'Blaue Pinselstriche'],
  ['River landscape', 'Nehir manzarası', 'Flusslandschaft'],
  ['Paros harbour', 'Paros limanı', 'Hafen von Paros'],
  ['Boat from above', 'Yukarıdan tekne', 'Boot von oben'],
  ['Parthenon', 'Parthenon', 'Parthenon'],
  ['Blue garden gate', 'Mavi bahçe kapısı', 'Blaues Gartentor'],
  ['Bougainvillea dome', 'Begonvilli kubbe', 'Kuppel mit Bougainvillea'],
  ['Nyhavn harbour', 'Nyhavn limanı', 'Hafen Nyhavn'],
  ['Nyhavn sunset', 'Nyhavn\'da gün batımı', 'Nyhavn im Abendlicht'],
  ['Florence skyline', 'Floransa silueti', 'Skyline von Florenz'],
  ['Tuscany sunset', 'Toskana\'da gün batımı', 'Sonnenuntergang in der Toskana'],
  ['Grand Canal', 'Büyük Kanal', 'Canal Grande'],
  ['Rialto bridge', 'Rialto köprüsü', 'Rialtobrücke'],
  ['Palace gate', 'Saray kapısı', 'Palasttor'],
  ['Maidens Tower', 'Kız Kulesi', 'Leanderturm'],
  ['Lake house', 'Göl evi', 'Haus am See'],
  ['Autumn waterfall', 'Sonbahar şelalesi', 'Herbstwasserfall'],
  ['Autumn bench', 'Sonbahar bankı', 'Herbstbank'],
  ['Autumn leaves', 'Sonbahar yaprakları', 'Herbstlaub'],
  ['White cat', 'Beyaz kedi', 'Weiße Katze'],
  ['Kittens in a basket', 'Sepetteki yavru kediler', 'Kätzchen im Korb'],
  ['Dog with flowers', 'Çiçekli köpek', 'Hund mit Blumen'],
  ['Beach dog', 'Sahildeki köpek', 'Strandhund'],
  ['Pink cloud', 'Pembe bulut', 'Rosa Wolke'],
  ['Dancing party', 'Dans partisi', 'Tanzparty'],
  ['Acropolis sunset', 'Akropolis\'te gün batımı', 'Akropolis im Abendlicht'],
  ['Cherry blossom street', 'Kiraz çiçekli sokak', 'Kirschblütenstraße'],
  ['Santorini', 'Santorini', 'Santorini'],
  ['{a} pieces in {b} × {c}. Each piece shows about {d} × {e} px of your photo.', '{a} parça, {b} × {c}. Her parça fotoğrafının yaklaşık {d} × {e} px kadarını gösterir.', '{a} Teile in {b} × {c}. Jedes Teil zeigt etwa {d} × {e} px deines Fotos.'],

  // ----- Messages from the server -----
  ["Choose a username first, so your friend knows who's asking.", 'Önce bir kullanıcı adı seç ki arkadaşın kimin istediğini bilsin.', 'Wähle zuerst einen Benutzernamen, damit dein Freund weiß, wer fragt.'],
  ['No player has that username. Check the spelling with your friend.', 'Bu kullanıcı adına sahip bir oyuncu yok. Yazımı arkadaşınla kontrol et.', 'Niemand hat diesen Benutzernamen. Prüf die Schreibweise mit deinem Freund.'],
  ['Not found.', 'Bulunamadı.', 'Nicht gefunden.'],
  ['Passwords can be at most {a} characters.', 'Şifre en fazla {a} karakter olabilir.', 'Passwörter dürfen höchstens {a} Zeichen haben.'],
  ["Please choose what's wrong.", 'Lütfen sorunun ne olduğunu seç.', 'Bitte wähle, was los ist.'],
  ['Please enter a valid email address.', 'Lütfen geçerli bir e-posta adresi gir.', 'Bitte gib eine gültige E-Mail-Adresse ein.'],
  ["Please enter your friend's username.", 'Lütfen arkadaşının kullanıcı adını gir.', 'Bitte gib den Benutzernamen deines Freundes ein.'],
  ['Please pick a photo.', 'Lütfen bir fotoğraf seç.', 'Bitte wähle ein Foto.'],
  ['Please sign in first.', 'Lütfen önce giriş yap.', 'Bitte melde dich zuerst an.'],
  ['Please use at least {a} characters for your password.', 'Lütfen şifren için en az {a} karakter kullan.', 'Bitte verwende mindestens {a} Zeichen für dein Passwort.'],
  ["Puzzle Table's storage is full right now, so this couldn't be saved. Sorry!", 'Puzzle Table’ın depolama alanı şu an dolu, bu yüzden kaydedilemedi. Üzgünüz!', 'Der Speicher von Puzzle Table ist gerade voll, deshalb konnte das nicht gespeichert werden. Tut uns leid!'],
  ['That email belongs to another account.', 'Bu e-posta başka bir hesaba ait.', 'Diese E-Mail gehört zu einem anderen Konto.'],
  ['That email now belongs to another account.', 'Bu e-posta artık başka bir hesaba ait.', 'Diese E-Mail gehört jetzt zu einem anderen Konto.'],
  ["That email/username and password don't match.", 'E-posta/kullanıcı adı ve şifre eşleşmiyor.', 'E-Mail/Benutzername und Passwort passen nicht zusammen.'],
  ["That game doesn't exist.", 'Böyle bir oyun yok.', 'Dieses Spiel gibt es nicht.'],
  ['That name is already taken. Try signing in instead.', 'Bu ad zaten alınmış. Bunun yerine giriş yapmayı dene.', 'Dieser Name ist schon vergeben. Versuch dich stattdessen anzumelden.'],
  ['That password is too easy to guess. Try a short phrase of a few words.', 'Bu şifre tahmin edilmesi çok kolay. Birkaç kelimelik kısa bir cümle dene.', 'Dieses Passwort ist zu leicht zu erraten. Versuch einen kurzen Satz aus ein paar Wörtern.'],
  ["That password isn't right.", 'Bu şifre doğru değil.', 'Dieses Passwort stimmt nicht.'],
  ["That photo isn't in the library.", 'Bu fotoğraf kütüphanede yok.', 'Dieses Foto ist nicht in der Bibliothek.'],
  ["That request isn't there any more.", 'Bu istek artık yok.', 'Diese Anfrage gibt es nicht mehr.'],
  ['That username is taken. Try another one.', 'Bu kullanıcı adı alınmış. Başka birini dene.', 'Dieser Benutzername ist vergeben. Versuch einen anderen.'],
  ["That's a lot at once. Please wait a few minutes and try again.", 'Bir anda çok fazla oldu. Lütfen birkaç dakika bekleyip tekrar dene.', 'Das ist gerade sehr viel auf einmal. Bitte warte ein paar Minuten und versuch es erneut.'],
  ["That's your own username.", 'Bu senin kendi kullanıcı adın.', 'Das ist dein eigener Benutzername.'],
  ['The {a} is too large.', 'Dosya çok büyük.', 'Die Datei ist zu groß.'],
  ['The {a} must be a JPEG.', 'Dosya JPEG olmalı.', 'Die Datei muss ein JPEG sein.'],
  ["There's no email waiting to be confirmed.", 'Onay bekleyen bir e-posta yok.', 'Es wartet keine E-Mail auf Bestätigung.'],
  ["This account has been suspended. If you think that's a mistake, please contact us.", 'Bu hesap askıya alındı. Bunun bir hata olduğunu düşünüyorsan lütfen bizimle iletişime geç.', 'Dieses Konto wurde gesperrt. Wenn du das für einen Fehler hältst, melde dich bitte bei uns.'],
  ["This game hasn't started yet.", 'Bu oyun henüz başlamadı.', 'Dieses Spiel hat noch nicht begonnen.'],
  ["This game isn't open.", 'Bu oyun açık değil.', 'Dieses Spiel ist nicht offen.'],
  ["This invite isn't open any more.", 'Bu davet artık açık değil.', 'Diese Einladung ist nicht mehr offen.'],
  ['This link has expired or was already used. Please ask for a new one.', 'Bu bağlantının süresi dolmuş ya da zaten kullanılmış. Lütfen yenisini iste.', 'Dieser Link ist abgelaufen oder wurde schon benutzt. Bitte fordere einen neuen an.'],
  ['This link has expired or was already used. You can send a new one from your account.', 'Bu bağlantının süresi dolmuş ya da zaten kullanılmış. Hesabından yenisini gönderebilirsin.', 'Dieser Link ist abgelaufen oder wurde schon benutzt. Du kannst in deinem Konto einen neuen senden.'],
  ['This puzzle is too large to save.', 'Bu yapboz kaydedilemeyecek kadar büyük.', 'Dieses Puzzle ist zu groß zum Speichern.'],
  ['Too many attempts. Please wait 15 minutes and try again.', 'Çok fazla deneme. Lütfen 15 dakika bekleyip tekrar dene.', 'Zu viele Versuche. Bitte warte 15 Minuten und versuch es erneut.'],
  ['Too many new accounts from here. Please try again later.', 'Buradan çok fazla yeni hesap açıldı. Lütfen daha sonra tekrar dene.', 'Zu viele neue Konten von hier. Bitte versuch es später erneut.'],
  ['Usernames are 3–24 characters: letters, numbers, dots, dashes or underscores.', 'Kullanıcı adları 3–24 karakterdir: harf, rakam, nokta, tire veya alt çizgi.', 'Benutzernamen haben 3–24 Zeichen: Buchstaben, Zahlen, Punkte, Binde- oder Unterstriche.'],
  ["We've sent a few emails already. Please check your inbox, or try again later.", 'Zaten birkaç e-posta gönderdik. Lütfen gelen kutunu kontrol et ya da daha sonra tekrar dene.', 'Wir haben schon ein paar E-Mails geschickt. Bitte schau in dein Postfach oder versuch es später.'],
  ['You already have a username.', 'Zaten bir kullanıcı adın var.', 'Du hast schon einen Benutzernamen.'],
  ['You can only invite friends.', 'Yalnızca arkadaşlarını davet edebilirsin.', 'Du kannst nur Freunde einladen.'],
  ["You can only report players you've had contact with.", 'Yalnızca iletişimde olduğun oyuncuları şikâyet edebilirsin.', 'Du kannst nur Spieler melden, mit denen du Kontakt hattest.'],
  ['You have a lot of open invites. Wait for some answers first.', 'Çok fazla açık davetin var. Önce bazı yanıtları bekle.', 'Du hast viele offene Einladungen. Warte erst auf ein paar Antworten.'],
  ['You have too many friends or open requests for now.', 'Şimdilik çok fazla arkadaşın ya da açık isteğin var.', 'Du hast gerade zu viele Freunde oder offene Anfragen.'],
  ["You're already friends.", 'Zaten arkadaşsınız.', 'Ihr seid schon Freunde.'],
  ["You've already asked. Your friend needs to accept.", 'Zaten istek gönderdin. Arkadaşının kabul etmesi gerekiyor.', 'Du hast schon gefragt. Dein Freund muss noch annehmen.'],
  ["You've blocked this player. Unblock them first.", 'Bu oyuncuyu engelledin. Önce engeli kaldır.', 'Du hast diese Person blockiert. Heb die Blockierung zuerst auf.'],
  ["Your account's storage is full. Remove a few puzzles to make room.", 'Hesabının depolama alanı dolu. Yer açmak için birkaç yapboz kaldır.', 'Der Speicher deines Kontos ist voll. Entferne ein paar Puzzles, um Platz zu schaffen.'],
  ["Your current password isn't right.", 'Mevcut şifren doğru değil.', 'Dein aktuelles Passwort stimmt nicht.'],
  ['Your gallery is full. Remove a few puzzles to make room.', 'Galerin dolu. Yer açmak için birkaç yapboz kaldır.', 'Deine Galerie ist voll. Entferne ein paar Puzzles, um Platz zu schaffen.'],
  ["Your password isn't right.", 'Şifren doğru değil.', 'Dein Passwort stimmt nicht.'],
  ["Your password shouldn't contain your username or email.", 'Şifren kullanıcı adını veya e-postanı içermemeli.', 'Dein Passwort sollte weder Benutzernamen noch E-Mail enthalten.'],
];

/* ---------- Choosing the language ---------- */

export function currentLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved && LANGUAGES[saved]) return saved;
  } catch {
    // Storage unavailable: use the browser's language.
  }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (LANGUAGES[code]) return code;
  }
  return 'en';
}

// Saves the choice and reloads, so everything on the page is in the new language.
export function setLanguage(code) {
  try {
    localStorage.setItem(LANGUAGE_KEY, code);
  } catch {
    // Storage unavailable: the choice lasts until the page is reloaded.
  }
  location.reload();
}

/* ---------- Translating ---------- */

const language = currentLanguage();
const exact = new Map();
const patterns = [];

if (language !== 'en') {
  for (const row of TEXTS) {
    const [english] = row;
    const translated = row[COLUMN[language]];
    if (!translated) continue;
    if (english.includes('{')) {
      const names = [...english.matchAll(/\{(\w)\}/g)].map((m) => m[1]);
      const source = english.split(/\{\w\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)');
      patterns.push({ regex: new RegExp(`^${source}$`), names, translated, length: english.length });
    } else {
      exact.set(english, translated);
    }
  }
  patterns.sort((a, b) => b.length - a.length); // the most specific first
}

// The translation of one piece of text, or null when there's none.
function lookup(text) {
  if (exact.has(text)) return exact.get(text);
  if (!/[A-Za-z]/.test(text)) return null; // numbers, times, symbols
  for (const { regex, names, translated } of patterns) {
    const match = text.match(regex);
    if (!match) continue;
    // Fill in what was matched, translating it too when it's a known word ("race").
    return translated.replace(/\{(\w)\}/g, (_, name) => {
      const value = match[names.indexOf(name) + 1];
      return exact.get(value) ?? value;
    });
  }
  if (text.includes(' · ')) {
    const parts = text.split(' · ');
    const done = parts.map((part) => lookup(part) ?? part);
    return done.some((part, i) => part !== parts[i]) ? done.join(' · ') : null;
  }
  return null;
}

export function t(text) {
  return language === 'en' ? text : lookup(text) ?? text;
}

const ATTRIBUTES = ['title', 'aria-label', 'placeholder', 'alt'];

function translateTextNode(node) {
  const raw = node.nodeValue;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return;
  const translated = lookup(text);
  if (translated && translated !== text) {
    const lead = raw.match(/^\s*/)[0] ? ' ' : '';
    const trail = raw.match(/\s*$/)[0] ? ' ' : '';
    node.nodeValue = `${lead}${translated}${trail}`;
  }
}

function translateAttributes(el) {
  for (const name of ATTRIBUTES) {
    const value = el.getAttribute?.(name);
    if (!value) continue;
    const translated = lookup(value.trim());
    if (translated && translated !== value) el.setAttribute(name, translated);
  }
}

function skip(node) {
  return node.parentElement?.closest('script, style, textarea, .world');
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    if (!skip(root)) translateTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || root.closest('script, style, .world')) return;
  translateAttributes(root);
  for (const el of root.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
    if (!el.closest('.world')) translateAttributes(el);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!skip(node)) translateTextNode(node);
  }
}

// Translates the page now, and everything the app puts on it later.
export function startTranslating() {
  document.documentElement.lang = language;
  if (language === 'en') return;
  document.title = t(document.title);
  translateTree(document.body);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'characterData') {
        if (!skip(change.target)) translateTextNode(change.target);
      } else if (change.type === 'attributes') {
        if (!change.target.closest('.world')) translateAttributes(change.target);
      } else {
        for (const node of change.addedNodes) translateTree(node);
      }
    }
  }).observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ATTRIBUTES });
}
