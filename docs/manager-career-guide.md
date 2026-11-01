# TACTICA FC: Menajer kariyerine başlama

## Kulüp seç ve kontrolü al

1. Oyunu `http://localhost:5184/tr` adresinde aç.
2. Ülke ve lig sayfalarından yönetmek istediğin kulübün **A takımı** sayfasına git.
3. **Menajer kariyeri** panelinde **Bu takımı yönet** seçeneğine bas. Seçim başarılı olunca aynı panelde yönettiğin takım görünür.
4. Ana sayfaya dönünce açılış ekranının üst kısmındaki kariyer panelinden kadro/antrenman, taktik/ilk 11, fikstür/maç tekrarı ve transfer sayfalarına doğrudan gidebilirsin.

## Güncel kodu çalıştır

Kaynak kod değiştikten sonra eski sunucu aynı PowerShell penceresinde çalışıyorsa
önce o pencerede `Ctrl+C` ile durdur, ardından proje klasöründe `npm run dev`
komutunu yeniden çalıştır. Başlatıcı 5184 portu doluysa süreci ve PID'yi bildirir;
hiçbir süreci kendiliğinden kapatmaz. Tarayıcıyı otomatik açmaz; adresi kendin aç.

## İlk 11 ve taktik

- Takım panelindeki **Taktikler ve diziliş** bağlantısından dizilişi ve oyun tarzını seç; baskı şiddeti ve savunma çizgisi ayarlarını da 0–10 arasında düzenle. Değerler otomatik kaydedilir ve maç motorunun oyuncu baskısı/konumlandırma kararlarına uygulanır.
- Aynı sayfada 11 pozisyonun her biri için oyuncu ata. Her seçim otomatik kaydedilir ve sonraki resmi maçta o pozisyonda başlar; boş bıraktığın yerleri motor tamamlar.
- Kadro sayfasındaki ilk 11'e sabitle düğmeleri, pozisyon atamasından bağımsız tercihlerini de kaydeder. Dizilişi değiştirince seçili pozisyonlar yeni düzene eşlenir.
- Takım sayfasındaki **Takım antrenmanı** alanından takım odağını seç. Oyuncu bazlı antrenman planları **Antrenman** sekmesindedir.

## Transfer

**Transferler** sekmesinden takım oyuncusunu transfer listesine koy veya listeden çıkar. Başka bir kulübün satışa/borçla kiralamaya açtığı oyuncuya transfer veya 3, 6, 12 aylık kiralama teklifi verebilirsin. Teklif ve gelen teklif yanıtları, oyunun normal günlük transfer çözümlemesinde ilerler.

## Maçı oynat ve tekrarını izle

1. **Fikstür ve maçları izle** bağlantısını aç.
2. Maç öncesi diziliş, oyun tarzı, baskı şiddeti ve savunma çizgisini ayarla; **Taktiği kaydet** veya ilerleme düğmesine bas. İlerlerken bekleyen taktik değişiklikleri otomatik kaydedilir.
3. **Bir gün ilerle** ile bir gün işle veya **Sonraki maça ilerle** ile sıradaki fikstür tarihine git.
4. İlerleme sırasında fikstür sayfasındaki **Canlı maç kumandası** bölümünde seçtiğin takımın maçını ve sahadaki oyuncuları izle. Takım talimatı gönder; oyuncu değişikliğinde sahadaki oyuncuyu ve maçın gerçek yedek listesinden girecek oyuncuyu seç. Değişiklik, top durmuş ve kurallar izin vermiş olduğunda maç motorunca uygulanır.
5. Sonuç ve kayıt hazır olunca skorun yanındaki **Maçı izle →** bağlantısıyla Open Football maç görüntüleyicisini aç.

Günlük dünya, transfer ve antrenman işlemleri tüm ülkelerde ilerler; maç motoru yalnızca seçtiğin simülasyon liglerinin fikstürlerini oynatır. Menajer fikstüründeki gün ilerletme, yönettiğin takımın ligini, yerel kupasını ve katıldığı kıta müsabakalarını kapsar. Canlı tempolu talimatlar koç kararına bağlanır. Elle oyuncu değişikliği gerçek maç sahası ve yedek kulübesi üzerinden, durmuş top, oyuncu değişikliği hakkı ve pencere kurallarıyla yürütülür; sonuçta aynı motorun değişiklik ve tekrar kayıt yolu kullanılır. Maç tamamlanınca skorun yanındaki bağlantı kaydedilmiş maçı Open Football görüntüleyicisinde açar. Kariyer seçimi sunucu yeniden başlatıldığında korunur; tam dünya takvimi ve sonuçları hâlâ sunucu belleğindedir ve geliştirme listesinde açıktır.
