# TACTICA FC: Menajer kariyerine başlama

## Oyunu aç

Proje klasöründeki PowerShell'de çalıştır:

```powershell
npm run dev
```

Vite'ın PowerShell'de yazdırdığı yerel adresi aç; adresin sonunda `/tactica-fc/` yolu bulunur. 5184 portu doluysa Vite otomatik olarak sonraki boş portu seçer. Open Football sunucusunu ayrıca başlatman gerekmez.

## Kariyer oluştur ve takımını seç

1. Açılış ekranında **Yeni oyun** seç.
2. İstersen varsayılan modern veritabanını kullan. **CM 01/02** veritabanı seçeneği, kendi oyun kurulumundan kullanıcı tarafından sağlanan veriyi içe aktarmak içindir; ISO veya patch çalıştırılmaz.
3. Menajer adını yaz, takip edilecek ülkeleri ve bu ülkelerde oynanacak ligleri işaretle. Seçili lig sayısı bu bölümde görünür; **Tümünü seç** ve **Temizle** düğmeleriyle kapsamı düzenleyebilirsin. Yalnızca işaretli liglerin fikstürü ve puan tablosu oluşturulur.
4. Seçili liglerden yönetmek istediğin A takımını seçip kariyeri başlat.
5. Kaydedilmiş kariyere dönmek için açılış ekranındaki **Oyunu yükle** bölümünü kullan. Oyun içinden de **Oyunu kaydet** ile kaydedebilir veya açılış ekranındaki **Kayıt dosyasını içe aktar** seçeneğini kullanabilirsin.

## Kadro, taktik ve antrenman

- **Kadro** ekranında oyuncuları, kondisyonu ve gelişimi incele; ilk 11 tercihlerini düzenle.
- **Taktikler** ekranında dizilişi, oyuncu/pozisyon atamalarını, oyun tarzını ve takım talimatlarını belirle. Maç sırasında taktik düzenleyicisiyle değişiklik yapabilirsin.
- **Antrenman** ekranında takım haftalık odağını, antrenörlerin çalışma alanlarını ve oyuncuların bireysel gelişim planlarını seç. Bu tercihler kariyerin antrenman ilerlemesine uygulanır.

## Transfer

**Transferler** ekranında oyuncu ara, transfer/kiralama tekliflerini yönet ve kulübündeki oyuncuları transfer listesine koy veya listeden çıkar. Teklifler bütçe, sözleşme ve transfer dönemi kurallarına göre kariyer günleri ilerledikçe çözülür; gelen yanıtlar gelen kutusunda görünür.

## Maçı baştan sona izle

1. Üstteki **Sonraki maç** veya **Devam et** düğmesiyle kendi takımının sıradaki maç gününe gel.
2. Maç gününde fikstürden kendi maçını açıp **Maçı başlat** seç. Maç, TACTICA'nın TypeScript motorunda başlama vuruşundan itibaren oynanır; gol öncesi simülasyon atlanmaz.
3. Sahadaki pozisyon akışı gömülü Open Football görüntüleyicisinde gösterilir. TACTICA motorunun ürettiği oyuncu/top konumları ve aksiyonlar görüntüleyiciye gönderilir. Skor ve maç sonucunu TACTICA belirler.
4. Hız ve duraklatma kontrollerini kullan. **Taktikler** ve **Oyuncu değişiklikleri** alanlarından maç sırasında karar ver; kabul edilen değişiklikler gerçek maç simülasyonuna uygulanır.
5. Maç bitince raporu incele. Sonucu fikstürden tekrar açabilirsin.

Maç sonucunu görüntüleyici üretmez; aynı maç motoru maç raporunu, skor tablosunu ve tekrar verisini oluşturur. Görüntü akışındaki aksiyonlar deterministik simülasyon olaylarına bağlıdır.
