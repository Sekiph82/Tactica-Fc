# TACTICA FC — Ayrıntılı Ürün Yol Haritası

Bu dosya aktif ve tamamlanmış tüm işlerin tek takip kaynağıdır. Plan hiyerarşisi: **Milestone → Sprint → tekil görev → kabul ölçütü**. Kodun yazılmış olması, gerçek çalışma/kabul testini tamamlamaz; bunlar ayrı görevlerdir.

## Ürün hedefi ve sabit kararlar

TACTICA FC; CM0102/CM2010 tarzında kariyer, kulüp yönetimi, haberler, antrenman, transferler, kupalar ve günlük dünya akışı sunar. TACTICA TypeScript kariyer ve maç motoru sonuçların tek otoritesidir. Gömülü Open Football viewer, yalnızca TACTICA'nın gerçek olaylarını ve oyuncu/top koordinatlarını animasyonla gösterir.

- Open Football'ın tam menajerlik oyunu TACTICA'nın yerine geçmez; 2026-11-01 kullanıcı yönlendirmesiyle viewer-only kullanım kararı yürürlüktedir.
- Ticari oyun ISO/yama dosyalarından kod, grafik veya veri kopyalanmaz.
- TACTICA markası ürün UI'sinde kullanılır; üçüncü taraf lisans/attribution bildirimleri korunur.
- Kullanıcı kariyer verisi ve `match_results/` korunur; reset, silme, force-push ve kör üzerine yazma yoktur.
- Her sprint sonunda kanıt ve durum yazılır. Büyük sprint kapanışında yerel `main` ile GitHub `origin/main` eşitlenir.
- `[x]` uygulama ve belirtilen kanıt tamamlandı; `[ ]` açık. Çalışma zamanı ve fiziksel cihaz kanıtı kod/derleme testinin yerine geçmez.

---

# Milestone M00 — Repo, mimari ve iş takibi

**Çıkış ölçütü:** Tek repo, motor/görüntüleyici sınırı, kaynak kuralları ve görev süreci belirli.

## Sprint M00-S01 — Başlangıç denetimi ve kaynak sınırı

- [x] M00-S01-T01 Kanonik React/Vite/TypeScript uygulaması, oyun motoru, veri tabanı, kayıt ve platform dizinlerini tespit et. **Kabul:** repo yapısı ve çalıştırma komutları belgeli.
- [x] M00-S01-T02 Kilitli bağımlılıkları kur; başlangıç build ve test durumunu kaydet. **Kanıt:** `npm ci`, build ve test başlangıçta başarılı.
- [x] M00-S01-T03 ISO ve patch dosyalarını uygulamadan ve GitHub'dan ayrı tut; hiçbirini çalıştırma. **Kabul:** orijinal dosyalar değiştirilmedi/commit edilmedi.
- [x] M00-S01-T04 Kod, veri, grafik ve üçüncü taraf lisans/attribution kurallarını belgeleyip dağıtım notlarına bağla.
- [x] M00-S01-T05 TACTICA motorunun sonuç ve kariyer state'i; viewer'ın sunum sorumluluğu olduğunu kesinleştir.

## Sprint M00-S02 — Görev görünürlüğü ve yayın disiplini

- [x] M00-S02-T01 Görevleri milestone/sprint/tekil task ve ayrı kabul ölçütleri halinde düzenle.
- [x] M00-S02-T02 Kod tamamlandı, runtime doğrulandı ve owner-visible kabul edildi durumlarını ayır.
- [x] M00-S02-T03 `TASKS.md` ve özet task verisini dakikada bir okuyan dashboard kur. **Kabul:** `localhost:11000` çalışıyor; dashboard sohbet içi tarayıcı sekmesinde açık.
- [x] M00-S02-T04 Her büyük sprint sonunda yalnızca ilgili dosyaları commit/push et; owner dosyalarını stage etme.
- [x] M00-S02-T05 Dashboard'da TASKS hiyerarşisini milestone→sprint→görev olarak göster; her seviyede tamamlanma sayısını ve mevcut çalışma odağını belirt. **Kabul:** 60 saniyelik yenileme korunur; gerçek checkbox sayısı dashboard'da doğru görünür.

---

# Milestone M01 — Marka, açılış ve kariyer kurulumu

**Çıkış ölçütü:** Kullanıcı TACTICA markalı açılışta takip edeceği ligleri ve kulübü seçerek kariyer başlatır; kurulum ekranı oyun navigasyonunda tekrar görünmez.

## Sprint M01-S01 — TACTICA FC kimliği

- [x] M01-S01-T01 Başlık, favicon, browser tab, PWA ve uygulama metadata'sını TACTICA FC olarak düzenle.
- [x] M01-S01-T02 Sağlanan kalkan logosu, menajer görseli ve ICO paketini web ve yerel platform varlıklarına uygula.
- [x] M01-S01-T03 Black Metal paletini (siyah/grafit/gümüş/kırmızı) ve durum renklerini ortak tasarım tokenlarına taşı.
- [x] M01-S01-T04 GitHub bağlantısını kullanıcının TACTICA FC repo adresine çevir; version-check butonunu kaldır; Hakkında içeriğini yenile.
- [x] M01-S01-T05 Viewer attribution ve lisans metinlerini ürün markasından ayrı, gerekli yerde koru.
- [ ] M01-S01-T06 Open Football host About/home sayfalarının güncel görselini temiz runtime'da incele. **Açık:** eski user server yeniden başlatılmadan yeni source görsel kabul sayılmaz.

## Sprint M01-S02 — Yeni kariyer sihirbazı

- [x] M01-S02-T01 Yeni oyunda izlenecek ülkeleri seçme ekranını oluştur.
- [x] M01-S02-T02 Ülke başına ligleri göster; lig seçimi ve seçili lig sayısını kaydet.
- [x] M01-S02-T03 Menajer adını ve yönetilecek kulübü seç; kariyer state'ini başlat.
- [x] M01-S02-T04 Kariyer başladıktan sonra ülke/lig/takım seçim ekranını ana nav'dan kaldır.
- [x] M01-S02-T05 Temiz güncel oturumda ülke→lig→kulüp→kariyer akışını ve nav'dan kalkışını görsel olarak kabul et. **Kanıt:** 2026-11-02 kullanıcı, seçimi tamamlayınca kurulum ekranının nav'dan istediği gibi kaybolduğunu doğruladı; App setup ekranını yalnızca kariyer state'i yokken gösteriyor.
- [ ] M01-S02-T06 Seçili lig sayısı ve seçilen kulüp yeni kariyerin başlangıcında doğru yükleniyor; save/restart sonrası aynı state'i doğrula.

## Sprint M01-S03 — Ana ekran ve navigasyon

- [x] M01-S03-T01 Geçmiş ekranlarda ortak Geri düğmesi; doğrudan girişte güvenli Inbox dönüşü ekle.
- [x] M01-S03-T02 Ortak üst barda kulüp, tarih, bütçe, bildirim, sıradaki maç ve Devam et/maça git durumunu göster.
- [x] M01-S03-T03 Tarih ilerlemesini günlük adımda tut; ayrı tatil eylemi çoklu gün isteyebilir.
- [x] M01-S03-T04 Maç bekleyen kullanıcıyı doğrudan maç öncesi/maç ekranına götür.
- [ ] M01-S03-T05 Geri, üst bar, tarihi ilerletme ve maç gününe geçişi 320/390/1280px görünümünde kabul et.

## Sprint M01-S04 — Dil

- [x] M01-S04-T01 Türkçeyi varsayılan yap; İngilizce ve Danca'yı koru.
- [x] M01-S04-T02 Ortak, kariyer, maç, taktik, transfer, antrenman ve haber sözlüklerini tamamla.
- [x] M01-S04-T03 Tarih/saat/para/sayı formatını locale'e göre düzenle.
- [ ] M01-S04-T04 Yeni/yenilenen tüm kullanıcı metinlerinde hard-coded string taraması ve üç dilde fallback kabulü yap.

---

# Milestone M02 — Menajerlik kontrolleri

**Çıkış ölçütü:** Kadro, taktik, antrenman ve transfer kararları gerçek kariyer state'ini değiştirir; saklanır ve motor tarafından uygulanır.

## Sprint M02-S01 — Kadro ve oyuncu profili

- [x] M02-S01-T01 Kadroda isim, pozisyon, uyruk, yaş, yetenek, potansiyel, kondisyon, moral, maç/gol, puan ve değer göster.
- [x] M02-S01-T02 Oyuncu araması, pozisyon filtreleri, temizleme ve boş sonuç durumunu ekle.
- [x] M02-S01-T03 Oyuncu profili ve sözleşme/sakatlık/kariyer bilgisini kadroya bağla.
- [ ] M02-S01-T04 Gerçek kariyerde filtre/arama ve profil bağlantılarını yeniden açılış dahil doğrula.
- [ ] M02-S01-T05 Kadro/profil tablolarının dar ekranda kesilme, yatay taşma ve değer kaybı olmadığını kabul et.

## Sprint M02-S02 — Taktik ve maç kadrosu

- [x] M02-S02-T01 Diziliş, zihniyet ve oyun tarzını kaydedip maç simülasyonuna aktar.
- [x] M02-S02-T02 Mevcut dizilişin 11 slotuna oyuncu ata; boş slotları otomatik tamamla.
- [x] M02-S02-T03 Takım talimatı ve rakip talimatlarını engine state'ine uygula.
- [x] M02-S02-T04 Maç içi taktik, oyuncu değişikliği ve devre arası konuşmasını motor state'ine bağla.
- [x] M02-S02-T05 Değişiklikten sonra aktif slot, bench, forma/numara, timeline ve raporu aynı oyuncuya göre güncelle.
- [ ] M02-S02-T06 Canlı maçta taktik ve değişiklik etkisini gerçek pozisyonlar/oyuncu aktörüyle kabul et.
- [ ] M02-S02-T07 Rakip talimatının baskı, savunma hattı ve pozisyon değişimine etkisini görsel kabul et.

## Sprint M02-S03 — Antrenman ve kamplar

- [x] M02-S03-T01 Oyuncu ve takım antrenman ayarlarını kaydet/oku; onaylı değer ile başarısız yazmayı ayır.
- [x] M02-S03-T02 Dinlenme/yoğunluk ve kondisyon toparlanması etkisini günlük motora bağla.
- [x] M02-S03-T03 Antrenman katılımı ve performansını gelişim, haber ve oyuncu demecine bağla.
- [x] M02-S03-T04 Fikstürsüz güne 7 günlük kamp planı; yer, ücret ve etki önizlemesi ekle.
- [x] M02-S03-T05 Kamp iptali, ücret, kondisyon/moral etkisi, save state'i ve bitiş raporunu uygula.
- [ ] M02-S03-T06 Canlı kariyerde kampı planla/iptal et; 7 günlük ilerlemeyi, bilanço/condition/moral etkisini, restart ve inbox raporunu doğrula.
- [ ] M02-S03-T07 Gerçek antrenman sonucundan üretilen demeç ve oyuncu gelişim raporunu doğrula. **Not:** önceki 5/7 gün kariyeri sahiplenilmiş state; yeniden yaratmadan önce veri dizini kontrol edilmelidir.

## Sprint M02-S04 — Transfer pazarı

- [x] M02-S04-T01 Arama, gözlem, permanent/loan listesi, teklif formu ve transfer short-list akışını uygula.
- [x] M02-S04-T02 Kulüp ücreti, oyuncu maaşı/sözleşmesi, kulüp görüşmesi ve oyuncu şartı aşamalarını bağla.
- [x] M02-S04-T03 Satıcı kulüp teklifi ve alıcı tarafı karşı teklifi kabul/red kontrollerini ekle.
- [x] M02-S04-T04 Yönetici kararlarını append-only journal'da replay et; başarıyla kaydedilen snapshot'ta temizle.
- [x] M02-S04-T05 Oyuncu listele/liste kaldır eyleminin server restart sonrasında kalmasını doğrula. **Kanıt:** izole Bournemouth kariyeri; tekrar listeleme testi yapılmayacak.
- [ ] M02-S04-T06 Teklif gönder/kabul/red/karşı teklif etkileşimlerini izole kariyerde gerçek HTTP/UI akışıyla doğrula.
- [ ] M02-S04-T07 Teklif ve karşı tekliflerin restart replay'ini, snapshot sonrası journal temizliğini doğrula.
- [ ] M02-S04-T08 Kalıcı ve kiralık transferi pazarlık→şartlar→medical/finalizasyon→kadrolar/bütçe/tarihçe boyunca uçtan uca doğrula.
- [ ] M02-S04-T09 Bekleyen manager kararında takvim durur; karar sonrası doğru günden devam eder; UI açıklamasını doğrula.

## Sprint M02-S05 — Yönetim ve mali işler

- [x] M02-S05-T01 Bakiye ve transfer bütçesini kulüp/transfer state'iyle eşle.
- [x] M02-S05-T02 Yönetim beklentisi, güven, bütçe, sponsorluk ve kulüp yönetimi kontrollerini bağla.
- [ ] M02-S05-T03 Sözleşme ve yönetim kararlarını gerçek kariyerde kaydet/yükle ve haber akışında izle.
- [ ] M02-S05-T04 İlk gün onboarding görevleri ve takım planının tamamlanmasını gerçek kariyerde doğrula.

---

# Milestone M03 — Dünya simülasyonu, takvim ve haberler

**Çıkış ölçütü:** Takip edilen ligler ve kulübün oynadığı yerel/kıtasal kupalar doğru ilerler; haberler gerçek engine sonuçlarından çıkar.

## Sprint M03-S01 — Dünya ve yarışmalar

- [x] M03-S01-T01 Seçili liglerin maç simülasyonunu yarışma ID'leriyle filtrele.
- [x] M03-S01-T02 Ülkelerin transfer/antrenman/world güncellemelerini koru; sadece kullanıcının izlediği fikstürleri daraltma yap.
- [x] M03-S01-T03 Gün başına tek tık ilerleme ve kullanıcı maç gününde maça yönlenme davranışını uygula.
- [x] M03-S01-T04 Kullanıcı kulübünün ligi takip edilmese bile lig, yerel kupa, playoff ve kıtasal maçlarını takvime ekle.
- [ ] M03-S01-T05 Yeni kariyerde seçili lig, domestic cup, playoff ve kıtasal fikstürün doğru tarihte geldiğini doğrula.
- [ ] M03-S01-T06 Maç/transfer/news duraklarının gün ve fixture kaydını atlamadığını kabul et.

## Sprint M03-S02 — Inbox ve gazete

- [x] M03-S02-T01 Mevcut typed news altyapısından kulüp haberleri, haftalık gazete ve aylık lig gazetesi üret.
- [x] M03-S02-T02 Takip edilen lig haberleri/sonuçları newest-first manager timeline'ına ekle.
- [x] M03-S02-T03 Maç/kupa, antrenman, transfer, board, oyuncu ve manager hikâyelerini sonuç kayıtlarına bağla.
- [x] M03-S02-T04 Okundu/unread, gazete aboneliği, mark-all-read ve manager karar linklerini kaydet.
- [x] M03-S02-T05 Antrenman performansından oyuncu demeçlerini üret; tekil praise yanıtını ve cooldown'u kaydet.
- [ ] M03-S02-T06 Haber/gazete akışını gerçek kariyerde lig sonucu, transfer, maç raporu ve antrenman örnekleriyle doğrula.
- [ ] M03-S02-T07 Aynı event'in refresh/restart sonrası yinelenmediğini doğrula.

## Sprint M03-S03 — Kupa, yaşam ve futbol atmosferi

- [x] M03-S03-T01 Nadir deterministik düğün haberini, oyuncu morale etkisini ve kalıcı event tarihini ekle.
- [ ] M03-S03-T02 Kupa kurası, maç, final, şampiyonluk ve ödül haberlerinin gerçek turnuva sonucuna bağlı olduğunu doğrula.
- [ ] M03-S03-T03 Basın, oyuncu demeçleri, taraftar ve yönetim mesajlarını gerçek performans/karar bağlamında doğrula.
- [ ] M03-S03-T04 Ek kişisel yaşam olaylarını yalnızca oyun anlamı, yaş/uygunluk ve kalıcı sonuçları belirlenmişse tasarla/uygula.
- [ ] M03-S03-T05 Her haberin tarih/oyuncu/kulüp/lig/sonuç ilişkisini sezon simülasyonunda tutarlılık açısından incele.

---

# Milestone M04 — TACTICA maç motoru ve yönetici girdileri

**Çıkış ölçütü:** Maç sonucu, olay, istatistik ve oyuncu/top state'i tek deterministik TACTICA simülasyonundan gelir.

## Sprint M04-S01 — Engine sonucu ve olaylar

- [x] M04-S01-T01 MatchSim'i authoritative engine-moment akışı ve tek rapor sonucu olarak koru.
- [x] M04-S01-T02 Pas, dripling, şut, gol, save, block, rebound, faul, kart, ofsayt, korner ve restart olaylarını rapora bağla.
- [x] M04-S01-T03 Görsel sampling/RNG'yi sonuç RNG'sinden ayır.
- [x] M04-S01-T04 Oyuncu puanı, skor, istatistik, sakatlık, gol/asist ve raporu aynı engine state'ten üret.
- [ ] M04-S01-T05 Sabit seed regresyonlarında gol/şut/kurtarış oranları, rapor ve skor tutarlılığını kapsa.
- [ ] M04-S01-T06 Uzatma ve penaltı state/raporunu normal sonuç ve viewer timeline'ıyla eşleştir.

## Sprint M04-S02 — Canlı kararlar

- [x] M04-S02-T01 Canlı taktik/takım instruction state'ini sonraki engine adımlarına aktar.
- [x] M04-S02-T02 Substitution ve devre arası konuşmasını match state/raporuna kaydet.
- [ ] M04-S02-T03 Canlı taktik/substitution kararlarını gerçek maçı izlerken uygula ve pozisyon/oyuncu değişimini doğrula.
- [ ] M04-S02-T04 Gol, kart, sakatlık, maç bitti ve extra-time duraklarında UI kontrollerini doğrula.

---

# Milestone M05 — Gömülü maç görüntüleyicisi

**Çıkış ölçütü:** Kick-off'tan full-time'a gerçek TACTICA verisi oynatılır; top/oyuncular geriye zıplamaz; skor ve gol atlanmaz.

## Sprint M05-S01 — Viewer köprüsü ve açılış

- [x] M05-S01-T01 Open Football viewer'ı React maç ekranına göm; tam upstream uygulama navigasyonunu TACTICA'ya alma.
- [x] M05-S01-T02 Fixture, takım rengi, forma numarası, oyuncu, ilk 11 ve bench verisini viewer DTO'suna aktar.
- [x] M05-S01-T03 TACTICA position/ball/event/goal/time kayıtlarını viewer recording formatına bağla.
- [x] M05-S01-T04 Viewer hazır olana kadar kick-off saatini tut; Open Football bring-up aşamalarını ve saha kurulum ilerlemesini göster; hata/retry state'i sağla.
- [x] M05-S01-T05 1x/2x/4x/8x speed, 90 dakika, uzatma ve shootout zaman çizgisini eşle.
- [x] M05-S01-T06 Stale/overlap batch'i reddet; host time monotonic ve accepted frame'e göre ilerlesin.
- [x] M05-S01-T07 Gecikmiş poll'daki tüm frame'leri sequence cursor ile toparla; track history ve allocation'ı sınırla.
- [x] M05-S01-T08 Son viewer frame'i ve full-time raporu tam aynı timestamp'te sırala.
- [ ] M05-S01-T09 Viewer Bevy süreci başladıktan sonraki timeout/retry için güvenli yaşam döngüsü kur; eski viewer'ı durdur/yeniden kullan, aynı maç state'ini koru ve ikinci eşzamanlı app açma.

## Sprint M05-S02 — Eylem ve hareket

- [x] M05-S02-T01 Pas, şut, blok, clear, pressing ve support-run cue'larını gerçek engine olaylarına bağla.
- [x] M05-S02-T02 Pas alıcısı/şutörü engine kararından seç; eski taşıyıcıya geri dönme veya aynı pası iki kez gösterme.
- [x] M05-S02-T03 Save, post, rebound, goal-kick ve held-ball geçişlerini ayrı gerçek pozisyon kayıtlarıyla sırala.
- [x] M05-S02-T04 Oyuncu merkezlerini bounded deterministic hareketle güncelle; simülasyon RNG'sini etkileme.
- [x] M05-S02-T05 Canlı sonucu daha hızlı renderer'a gönder; viewer fps ve match wall-clock ilişkisini koru.
- [ ] M05-S02-T06 CM2010 referanslı sıralı oyuncu/top yolu, destek koşusu ve savunma tepkisini gerçek maçta görsel kabul et.
- [ ] M05-S02-T07 Gerçek forma numarası, takım rengi, ayakta oyuncu figürü ve doğru goalkeeper kitlerini kabul et.
- [ ] M05-S02-T08 Topu takip et kamerasında hareket ve aksiyon net; varsayılan tam saha ve iki kale görünür kalsın.

## Sprint M05-S03 — Tam maç kabulü ve süreklilik

- [ ] M05-S03-T01 Seçilen kulübün maçını kick-off'tan full-time'a izole kariyerde başlat ve bitir. **Kabul:** score, clock, viewer ve report aynı maça ait; gol önceden oynanmış/atlanmış değil.
- [ ] M05-S03-T02 Pas, interception, failed dribble, shot, save, rebound ve restart'ta geriye sıçrama/tekrar hareketi gözle.
- [ ] M05-S03-T03 Gol animasyonu, scoreboard artışı, tek anlatım metni ve replay'i engine report ile eşleştir.
- [ ] M05-S03-T04 Devre arası, ikinci yarı, extra-time, penalty ve full-time akışını doğrula.
- [ ] M05-S03-T05 1x/2x/4x/8x hızlarda viewer clock ve engine moment senkronunu kaydet.
- [ ] M05-S03-T06 Tab arka plana alınma/geri dönme, polling backpressure, CPU, heap ve WASM performansını incele.
- [ ] M05-S03-T07 Gerçek aksiyon ve kabul ekran görüntüsü/video kanıtını kaydet; enjekte edilmiş test karelerini gerçek maç kanıtı sayma.
- [ ] M05-S03-T08 Bir akış sorunu bulunursa önce engine, event adapter, network/frame cursor ve renderer katmanından hangisinin sebep olduğunu izole et. **Önceki deneme başarı değil:** İzole kariyer 1 Temmuz→8 Temmuz 150 saniye sürdü; Fulham'ın Ederson teklifi gün ilerlemesini durdurduğu için fixture'a varılmadı. **Kaynak bulguları:** `openFootballRecording.ts` tuple çıkarımı düzeltildi; typecheck başarılı. `MatchViewer.start()` Bevy app'ini başlatıyor ve upstream wasm `stop/destroy` export'u sunmuyor; timeout sonrası React retry'si ekranı yeniden kurabiliyor ama önceki app'in durduğunu kanıtlamıyor. Güvenli retry M05-S01-T09'da açık; tam maç runtime kabulü hâlâ açık.

---

# Milestone M06 — Kariyer kayıtları ve veri devamlılığı

**Çıkış ölçütü:** Web ve paketlerde kariyer, manager kararları, maç raporu ve sezonlar kaybolmadan kaydedilir/yüklenir.

## Sprint M06-S01 — Browser career save

- [x] M06-S01-T01 IndexedDB platform adapter ve sürümlü payload/metadata zarfı ekle.
- [x] M06-S01-T02 Eski save, current save, bozuk save ve unsupported future version doğrulaması ekle.
- [x] M06-S01-T03 Atomik replace, rollback, capped retry ve autosave hata yönetimini doğrula.
- [x] M06-S01-T04 Çok sezon save/load, arşiv ve maç raporunu UI üzerinden doğrula.
- [ ] M06-S01-T05 Local web/Desktop/Android kökenleri arasında eski save'i taşıma veya desteklenmiyor davranışını kullanıcıya açıkça sun.

## Sprint M06-S02 — World snapshot/manager journal

- [x] M06-S02-T01 Dünya verisini uyumlu engine kimliği, kurtarılabilir snapshot ve atomic promotion ile kaydet.
- [x] M06-S02-T02 Büyük save'i bounded gzip/temp file/memory map ile yükle.
- [x] M06-S02-T03 Manager kararları için append-only journal, restart replay ve successful snapshot cleanup ekle.
- [x] M06-S02-T04 Liste/liste kaldır eylemini iki server restart boyunca doğrula; bu test tamamlandı, tekrarlama.
- [ ] M06-S02-T05 Offer/counter journal replay ve günlük snapshot cleanup'ını gerçek izolasyonla kabul et.
- [ ] M06-S02-T06 Snapshot read/write süresini ve peak memory'i ölç; önceki/baseline ölçümü olmadan optimizasyon iddiası yapma.
- [ ] M06-S02-T07 Kayıt başarısızlığında önceki save'in sağlam kaldığını UI ve disk state'iyle kabul et.

---

# Milestone M07 — TACTICA arayüzü, responsive ve erişilebilirlik

**Çıkış ölçütü:** Seçimden maç raporuna kadar ekranlar aynı tema ve etkileşim kurallarında; tablolar taşmaz, metin ve geri navigasyonu çalışır.

## Sprint M07-S01 — Ekran teması ve markalama

- [x] M07-S01-T01 Ortak renk tokenları, temel kontroller, focus state ve kullanıcı teması seçimini tanımla.
- [x] M07-S01-T02 Inbox, schedule/live viewer, report kartları ve bazı Open Football host CSS alanlarını TACTICA temasına çevir.
- [ ] M07-S01-T03 Açılış/yeni oyun, dashboard/Inbox, squad/player ekranlarında 320/390/768/1280px taşmayı incele.
- [ ] M07-S01-T04 Taktik/antrenman/transfer, lig/kupa/fikstür/sonuç/gazete ekranlarını aynı ölçülerde incele.
- [ ] M07-S01-T05 Tüm tabloların başlık, para, isim ve düğme alanlarının kesilmeden sığmasını kabul et.
- [x] M07-S01-T06 TACTICA kullanıcı akışında eski Open Football branding/theme artığını tara; lisans/credit alanları istisna. **Kanıt:** ortak nav/selector, sezon kartları, giriş görseli ve maç çevresi eski lacivert/camgöbeği/gold-violet UI renklerinden temizlendi; bu takip düzeltmesinde maç skorbordu da sabit siyah/grafit/gümüş/kırmızı palete alındı ve dakika iki takım arasına taşındı. Viewer lisans/credit kapsamı korundu; gerçek ekran kabulü T07'de açık.
- [ ] M07-S01-T07 Gerçek ekran görüntüsüyle görsel kabul kaydet; yalnızca source/CSS parser başarısını yeterli sayma.
- [x] M07-S01-T08 Aktif maç sunumu hariç yönetim/kurulum sayfalarının Black Metal (siyah/grafit/gümüş/kırmızı) temasında olduğunu kullanıcı kabulüyle kaydet; maç ekranını ayrı düzeltme ve kabul kapsamına al. **Kanıt:** 2026-11-02 kullanıcı, diğer sayfaları konseptle uyumlu kabul edip maç ekranını ayrı tuttu. Responsive ve tablo taşma incelemeleri M07-S01-T03–T05'te açık kalır.
- [x] M07-S01-T09 Maç ekranı kabuğu, üst/yan navigasyon, skor kartı, kontroller ve yükleme alanını seçili skin/klüp renklerinden bağımsız Black Metal tokenlarına sabitle. **Uygulama:** `.shell:has(.match-screen)` için yerel tema tokenları eklendi; piksel düzeyinde son görsel kabul M07-S01-T07'de açık.

## Sprint M07-S02 — Etkileşim ve accessibility

- [x] M07-S02-T01 Sahadaki roster/rating overlay'lerini kaldır; kondisyon ve puanları ayrı sekmelerde tut.
- [x] M07-S02-T02 Maç alanı için erişilebilir ad, responsive scoreboard ve ortak geri kontrolü ekle.
- [ ] M07-S02-T03 Klavye, focus, screen-reader label ve reduced-motion davranışlarını temel menajer/maç akışlarında kabul et.
- [ ] M07-S02-T04 Dar viewport, browser zoom %125/%150 ve uzun takım/oyuncu isimlerinde yatay taşmayı kontrol et.
- [ ] M07-S02-T05 Tablolarda uzun lig/oyuncu/transfer satırlarının truncate/tooltip/scroll davranışını doğrula.

---

# Milestone M08 — Web ve masaüstü/mobil paketleri

**Çıkış ölçütü:** Her platform hedef ortamında kariyer yaratır, kaydeder ve gerçek viewer maçı oynatır; imza/cihaz gereksinimleri belgelenir.

## Sprint M08-S01 — Web/PWA

- [x] M08-S01-T01 React/Vite build, PWA metadata, viewer js/wasm ve TACTICA iconlarını paketle.
- [ ] M08-S01-T02 Temiz browser profilinde install/offline, kariyer, save/load ve maç viewer'ını doğrula.
- [ ] M08-S01-T03 Gerçek mobil tarayıcıda WebGPU varsa seç, yoksa WebGL2 fallback davranışını kabul et.

## Sprint M08-S02 — Windows/Electron

- [x] M08-S02-T01 Electron sandbox, context isolation, local TACTICA host, single-instance ve ICO ayarlarını yap.
- [x] M08-S02-T02 Viewer-only pakette embedded WASM ve attribution bulunsun; `open_football.exe` olmasın.
- [x] M08-S02-T03 Güncel NSIS paketi üret; ASAR/içerik hash ile güncel uygulama olduğunu kanıtla.
- [ ] M08-S02-T04 Güncel installer'ı izole kur ve çevrimdışı aç.
- [ ] M08-S02-T05 Paketli Windows'ta yeni kariyer, tam maç viewer, save/load/restart doğrula.
- [ ] M08-S02-T06 Eski server save'inin yeni TACTICA origin'ine geçişini doğrula veya desteklenmiyorsa kullanıcı yönlendirmesi ekle.
- [ ] M08-S02-T07 İmzasız paketi açıkça etiketle; yayın imzalama gereksinimini belgele.
- [ ] M08-S02-T08 Eski pre-transition installer'ı güncel sürüm gibi sunmadığını doğrula.

## Sprint M08-S03 — Android/Capacitor

- [x] M08-S03-T01 Capacitor Android host'u ortak React bundle'a bağla; Rust server startup'ını kaldır.
- [x] M08-S03-T02 Android ikon/splash varlıklarını supplied TACTICA icon pack'ten üret.
- [x] M08-S03-T03 Debug APK üret; React shell/viewer WASM var, eski Rust engine yok içerik kontrolünü yap.
- [ ] M08-S03-T04 Uygun cihazda kariyer, kadro/taktik, transfer/antrenman ve kayıt akışını çalıştır.
- [ ] M08-S03-T05 Android cihazında tam maç viewer, renderer fallback, gol ve full-time akışını doğrula.
- [ ] M08-S03-T06 Düşük RAM cihazda crash/FPS/bellek sınırını ölç ve desteklenen minimumları belirle.
- [ ] M08-S03-T07 Release AAB signing ve key gereksinimlerini belgele.

## Sprint M08-S04 — iOS/Capacitor

- [x] M08-S04-T01 Capacitor iOS projesi, supplied TACTICA ikon ve launch splash kaynaklarını kur.
- [x] M08-S04-T02 Windows'ta web build ve Capacitor resource sync doğrula; native iOS kabulü sayma.
- [x] M08-S04-T03 macOS/Xcode, signing ve fiziksel cihaz ön koşullarını belge.
- [ ] M08-S04-T04 macOS/Xcode'da native build üret.
- [ ] M08-S04-T05 Fiziksel iOS cihazda kariyer/save/live match akışını doğrula.
- [ ] M08-S04-T06 Apple signing ve paketleme ön koşullarını doğrula. **Blok:** uygun Apple ortamı yoksa bu sprint tamamlanamaz.

---

# Milestone M09 — Regresyon, performans ve release kabulü

**Çıkış ölçütü:** Maç görüntüsü ve oyun sonucu tutarlı; kritik regresyonlar geçer; her platformun gerçek kanıtı ve kalan blokları açık.

## Sprint M09-S01 — Motor, UI ve kayıt regresyonu

- [x] M09-S01-T01 Seed'li maç sonucunun deterministik ve renderer RNG'sinden bağımsız olduğunu kapsa.
- [x] M09-S01-T02 Player center persistence/bounded movement regressions ekle.
- [ ] M09-S01-T03 Pass/interception/shot/save/rebound/goal/restart/substitution timeline testlerini kalıcı hale getir.
- [ ] M09-S01-T04 Overtime/shootout, scoreboard, report ve replay skor uyumunu test et.
- [ ] M09-S01-T05 Save migration, restart, multi-season, manager journal ve transfer state regresyonlarını çalıştır.
- [ ] M09-S01-T06 Navigation, selector visibility, squad search, tactic/training/transfer UI akışlarını test et.
- [ ] M09-S01-T07 Build/test başarısızlıklarını sonuçlarıyla kaydet; başarısız full suite'i focused pass ile gizleme.

## Sprint M09-S02 — Render ve simülasyon performansı

- [ ] M09-S02-T01 90 dakika desktop viewer FPS, CPU, JS heap, WASM heap ve frame backlog ölç.
- [ ] M09-S02-T02 Dünya ilerlemesi ve maç animasyonu süresini ayrı ölç; darboğazı doğru katmana ata.
- [ ] M09-S02-T03 Hidden/visible tab ve uzun maçta sample memory büyümesinin limitli olduğunu doğrula.
- [ ] M09-S02-T04 Android ve varsa iOS fiziksel cihaz sonuçlarını desktop değerlerinden ayrı raporla.
- [ ] M09-S02-T05 Snapshot load/save ve peak memory için önce/sonra ölçümü üret.

## Sprint M09-S03 — Yayın kapısı ve repo kapanışı

- [ ] M09-S03-T01 Kritik akışlarda release-blocking hata bırakma.
- [ ] M09-S03-T02 Lisans ve varlık attribution'ını tüm paketlerde doğrula.
- [ ] M09-S03-T03 Versiyon, installer/APK hash'i, kurulum ve bilinen sınırlamaları kaydet.
- [ ] M09-S03-T04 Tamamlanmamış platformu tamamlandı/çapraz-platform diye raporlama; gerçek bloklayıcıyı listele.
- [ ] M09-S03-T05 Her büyük sprint sonunda yerel branch ve origin/main'i korumalı şekilde eşitle.

---

# Aktif çalışma sırası

1. **M05-S03:** seçilen kulübün maçını baştan sona gerçek viewer'da doğrula; önceki deneme fikstüre ulaşmadığı için açık.
2. **M02-S04 / M06-S02:** teklif ve karşı teklif restart/journal kabulü; tamamlanmış list/unlist testi tekrarlanmayacak.
3. **M02-S03 / M03-S02:** kamp ve haber/oyuncu demeci runtime kabulü.
4. **M07:** ekran ekran taşma/tema ve setup nav görsel kabulü.
5. **M08:** Windows runtime, Android cihaz, iOS native cihaz kabulü.
6. **M09:** regresyon, performans ve platform bazlı release kanıtı.

## Kanıt ve kapsam notları

- Tamamlanmış viewer bridge, save ve platform build kanıtlarının daha geniş ayrıntıları Git geçmişinde, `design-qa.md`, `docs/ios-release-prerequisites.md` ve `docs/cm2010-static-analysis.md` içindedir.
- Inject edilmiş fake/live test kareleri gerçek maç kabulü değildir.
- Dashboard `TASKS.md` dosyasını her dakikada yeniden okur; ayrıntılı liste ve checkbox durumları buradan beslenir.
- Owner'a ait `match_results/` verileri korunur ve bu takip planı için stage edilmez.

