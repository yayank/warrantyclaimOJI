# Backlog — siap dieksekusi

Tiap bagian di bawah adalah **satu prompt utuh**, satu sesi, satu commit. Salin
apa adanya. Koordinat kode di dalamnya sudah diverifikasi pada 12 September 2026
— itu yang membuat sesi baru tidak perlu menyelidiki ulang, dan itulah
penghematan token yang sebenarnya.

**Urutan yang disarankan:** A → B → C → D. E, F, G hanya kalau memang terasa
kurang. **A–G semuanya sudah selesai.**

**Gelombang kedua: H → N**, model garansi dua tingkat. Urutannya **mengikat** —
tiap butir memakai yang dibangun butir sebelumnya. Rancangannya di
`docs/warranty-model.md`, latar belakangnya di `docs/business-context.md`;
**baca keduanya sebelum mengerjakan butir mana pun di gelombang ini.**

**Cara menghemat token:**

- Satu prompt per sesi. Jangan gabungkan A+B dalam satu percakapan.
- Deskripsi PR **jangan** diminta diperbarui tiap sesi — itu ±8rb token tiap
  kali. Minta sekali setelah beberapa commit: *"perbarui deskripsi PR"*.
- Kalau ingin lebih hemat lagi, tambahkan *"jawab singkat"* — laporannya
  memendek, pekerjaannya tidak.
- Kalau sesi baru terasa tidak paham konteks, cukup tulis: *"baca
  docs/backlog.md bagian X lalu kerjakan"*.

Semua sesi memakai branch `claude/warranty-claim-searchable-dropdowns-2v0b4k`.

---

## A · Tiga perbaikan cepat — ✅ SELESAI (`6e5861b`, 12 Sep 2026)

> Catatan koreksi: prompt di bawah menyatakan `verify-paging.js` sudah punya
> pemeriksaan bahwa angka tab tidak ikut tersaring. **Itu keliru** — yang ada
> hanya membandingkan dua panggilan tanpa filter, jadi tidak bisa menangkapnya.
> Pemeriksaannya ditambahkan saat mengerjakan ini.


> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. Tiga perbaikan
> kecil yang tidak saling bergantung — boleh satu commit atau tiga, pilih yang
> paling wajar.
>
> **1. `listClaims_` membentuk tiap klaim dua kali.** Di `src/Claims.gs`,
> `listClaims_` sudah memanggil `shapeClaim_` untuk setiap klaim menjadi `rows`,
> lalu `tabCounts_(session, claims, byClaim)` membentuk ulang semuanya dari nol
> hanya untuk menghitung angka tab. Oper baris yang sudah jadi ke `tabCounts_`
> alih-alih membentuk ulang. Hati-hati: `rows` disaring setelah dibentuk,
> sedangkan hitungan tab harus tetap atas **seluruh** himpunan yang terlihat —
> jangan sampai angkanya ikut tersaring. `verify-paging.js` sudah punya
> pemeriksaan untuk itu; pastikan tetap lolos.
>
> **2. Cacat tata letak `.stack`.** Di `src/Styles.html`, `.stack` memasang
> `display:flex`. Kelas itu dipakai pada `<td>` (mis. kolom Claim, Serial
> number, Status di `claimTable`), dan sebuah `<td>` yang jadi flex container
> berhenti berlaku sebagai sel tabel: tingginya mengikuti isinya sendiri, bukan
> tinggi barisnya, sehingga `border-bottom`-nya berhenti di tengah baris.
> Terukur: sel `.stack` 39px sementara sel tetangganya 64px. Perbaiki supaya sel
> tabel tetap sel tabel, tapi **isinya tetap menumpuk dengan jarak yang sama dan
> pill tetap memeluk isinya** (jangan sampai pill melar selebar kolom). `.stack`
> juga dipakai di luar tabel (panel, Orders, Advance Issue, Email Log) — periksa
> semuanya di Chromium sebelum menyatakan selesai.
>
> **3. Pilihan "No grouping".** Kontrol *Group by* di toolbar Claims sekarang
> hanya punya `status` dan `customer`. Tambahkan pilihan ketiga yang mematikan
> pengelompokan sehingga daftarnya rata. Saat rata, judul blok dan judul
> referensi tidak digambar, dan kolom Claim kembali dua baris (RefNo di atas,
> ClaimID di bawah; klaim tanpa RefNo dipimpin ClaimID-nya sendiri, seperti
> sebelum bagian 23 di deskripsi PR).
>
> Konvensi repo: setiap perbaikan dikunci penguji, dan penguji baru **dibuktikan
> menangkap bug-nya** dengan mengembalikan kode lama sebentar. Jalankan seluruh
> suite, bangun ulang `dist/` dengan `node tools/bundle.js`, commit, push.

---

## B · Kartu untuk layar kecil — ✅ SELESAI (12 Sep 2026)

> Catatan: penyebab sebenarnya bukan hanya tiadanya media query — `table.data`
> punya `min-width:720px` di aturan dasarnya, dibuat untuk pendekatan geser-
> samping. Tanpa mencabutnya di dalam media query, kartunya terbentuk tapi
> halamannya tetap bisa digeser ke samping.


> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`.
>
> Tabel klaim tidak punya perlakuan apa pun untuk layar kecil. Satu-satunya
> penanganan adalah `.tablewrap{overflow-x:auto}` di `src/Styles.html`, padahal
> tabelnya 8 kolom untuk Requester dan 11 untuk Administrator — jadi di HP orang
> menggeser ke samping melewati sebelas kolom. Requester bekerja di rumah sakit
> dan kemungkinan besar memegang HP.
>
> Di bawah ±700px, ubah tabel klaim menjadi **kartu**: RefNo dan ClaimID di
> atas, status dan umur sebagai pill, customer dan serial number di bawahnya,
> sparepart tetap sebagai daftar di dalam kartu. Judul blok status dan judul
> referensi tetap ada sebagai pemisah.
>
> Pertimbangan:
>
> - Utamakan CSS. Kalau bisa dicapai dengan mengubah `display` pada `tr`/`td`
>   di bawah breakpoint, itu jauh lebih baik daripada menggambar markup kedua —
>   satu sumber kebenaran, dan `verify-grouping.js` tetap berlaku.
> - Kalau markup kedua tidak terhindarkan, sebutkan alasannya di commit dan
>   pastikan penguji menutupi keduanya.
> - Caret (lipat sparepart) dan klik baris untuk membuka panel harus tetap
>   bekerja dengan sentuhan.
>
> Uji di Chromium pada 390px dan 768px, terang dan gelap, lalu kirimkan
> gambarnya. Jalankan suite, bangun ulang `dist/`, commit, push.

---

## C · Arsip audit dan batas lampiran — ✅ SELESAI (12 Sep 2026)

> Catatan koreksi: prompt di bawah menunjuk `src/Files.gs` untuk
> `uploadAttachment_`. Fungsi itu ada di `src/Claims.gs`. Sheet auditnya juga
> bernama `AuditLog`, bukan `Audit`, jadi arsipnya `AuditLog-YYYY`.
>
> Yang dikerjakan: `archiveAudit_()` di `src/Audit.gs`, dipanggil
> `dailyMaintenance()` setelah backup harian. Urutannya menyalin dulu, menghapus
> kemudian — mati di tengah meninggalkan baris ganda selama sehari, bukan baris
> hilang, dan jalan berikutnya mengenali serta melewatinya. `listAudit_` dan
> panel klaim membaca sheet berjalan maupun arsip, jadi jawabannya sama baik
> sebelum maupun sesudah trigger jalan; layar Audit Log dapat pemilih tahun.
> Batas lampiran 10MB (`MAX_UPLOAD_BYTES`) diperiksa di server dan di browser,
> di browser **setelah** foto diperkecil — ukuran sebelum diperkecil bukan
> ukuran yang dikirim. Impor workbook principal punya batasnya sendiri (25MB)
> supaya tidak ikut tertolak. `tools/verify-audit.js`, 42 pemeriksaan, terbukti
> menangkap tujuh bug yang dikembalikan satu per satu.


> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`.
>
> **1. Sheet `Audit` tumbuh selamanya.** Satu baris per tindakan, dan
> `listAudit_` di `src/Audit.gs` membacanya **penuh** setiap kali layar Audit Log
> dibuka (memotong 200 baris hanya untuk keluarannya). Tidak ada trigger
> pembersihan — `src/Triggers.gs` membersihkan ekspor setelah tujuh hari, tapi
> tidak menyentuh audit. Ini sheet yang paling cepat membesar sekaligus yang
> dibaca utuh.
>
> Buat arsip per tahun: baris yang lebih tua dari tahun berjalan dipindahkan ke
> sheet `Audit-YYYY` oleh trigger harian, dan `listAudit_` hanya membaca sheet
> berjalan. Layar Audit Log perlu cara membaca tahun lama — pilihan tahun pada
> filter sudah cukup. **Jangan sampai ada baris hilang** saat perpindahan;
> pengujinya harus membuktikan itu, termasuk saat trigger berjalan dua kali.
>
> **2. Batas ukuran lampiran.** Periksa dulu apakah sudah ada di
> `src/Files.gs` / `uploadAttachment_`. Kalau belum, satu foto 12MB dari HP
> masuk Drive apa adanya. Tetapkan batas yang wajar (mis. 10MB), tolak dengan
> pesan yang menyebut nama berkas dan ukurannya, dan periksa di **klien maupun
> server** — pemeriksaan klien untuk kecepatan, pemeriksaan server karena itu
> yang mengikat. Kalau ternyata sudah ada batasnya, katakan saja dan lewati.
>
> Penguji baru dibuktikan menangkap bug-nya. Jalankan suite, bangun ulang
> `dist/`, commit, push.

---

## D · Kolom ringkasan, lalu QUERY — ✅ TAHAP 1 & 2 SELESAI, TAHAP 3 DITOLAK (12 Sep 2026)

> **Tahap 1** (`51f7d8f`). Delapan kolom pada `Claims`: `ItemCount`,
> `PendingCount`, `ApprovedCount`, `RejectedCount`, `ShippedCount`,
> `AwaitingReturnCount`, `AdvanceCount`, `AdvanceQueueCount`. Prompt ini menyuruh
> menggantung pemeliharaannya pada `recomputeClaimStatus_` saja — itu keliru:
> **enam jalur mengubah item tanpa pernah memanggilnya** (`syncItems_`,
> `mergeIntoClaim_`, `setAvailability_`, `forwardOrder_`, `fulfilFromStock_`,
> `setAdvanceIssue_`). Semuanya sekarang menghitung ulang. Selalu hitung ulang
> dari itemnya, tidak pernah menambah/mengurangi angka yang sudah ada. Ditulis
> lewat `setCells_` supaya `RowVersion` tidak ikut naik — angka yang dihitung
> server sendiri bukan suntingan siapa pun. `backfillClaimSummaries_()` untuk
> klaim lama, jalan dari `setUp()` dan dari `backfillSummaries()` di editor.
>
> **Tahap 2** (`9eafaa0`). Seluruh aturan tab, filter dan badge dijawab dari
> kolom. `listClaims_` menerima `items: 'all' | 'page' | 'none'`; defaultnya
> `'all'` karena layar Orders dan ekspor Excel butuh part tiap baris. Filter
> `partId` satu-satunya pertanyaan yang tidak bisa dijawab kolom, jadi ia tetap
> memaksa pembacaan. Sheet yang belum dimigrasi dideteksi (`summariesReady_`)
> dan jatuh kembali ke menghitung item — lambat, bukan salah diam-diam.
>
> **Ukurannya** (`node tools/measure-list.js`, 412 klaim / 550 item):
>
> | | getValues | sel dibaca |
> |---|---|---|
> | daftar dengan part | 2 | 30.846 |
> | daftar tanpa part | 1 | 16.520 |
>
> Jadi target "`ClaimItems` tidak dibaca sama sekali" **belum tercapai** untuk
> tabel klaim, dan bukan karena kodenya: tabel itu menggambar baris sparepart di
> bawah tiap klaim, jadi ia memang butuh itemnya. Penghematan 46% itu tersedia
> hanya kalau baris sparepart tidak lagi digambar di muka. Itu keputusan tampilan,
> bukan keputusan teknis — **dan sudah diputuskan: tampilan tetap seperti sekarang**
> (12 Sep 2026). Baris sparepart tetap terbuka otomatis; daftar tetap membaca
> `ClaimItems`. Jangan diubah tanpa diminta. Jalannya tetap terbuka kalau suatu
> hari berubah pikiran: `listClaims_` sudah menerima `items: 'none'`, dan
> pengujinya sudah membuktikan jawabannya identik tanpa part.
>
> **Tahap 3 — tidak dipakai.** `gviz/tq` bisa memfilter dan memotong di sisi
> Google, tapi satu `claims.list` butuh tiga jawaban: halamannya, total set
> tersaring, dan dua angka badge atas seluruh set yang terlihat. Itu tiga
> permintaan HTTPS ber-OAuth dari Apps Script, masing-masing dengan lantai
> latensinya sendiri, menggantikan **satu** `getValues()` 16.520 sel. Latensi
> Apps Script tidak bisa saya ukur dari luar, jadi keputusan ini berdiri di atas
> jumlah perjalanan — dan tiga perjalanan tidak akan mengalahkan satu pembacaan.
> Jangan dipakai.


> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. **Ini yang paling
> berisiko di backlog — menyentuh skema dan data hidup. Kerjakan dalam dua
> tahap, commit terpisah, dan jangan lanjut ke tahap 2 sebelum tahap 1 terbukti.**
>
> **Latar.** Aturan tab bergantung pada agregat item (`summary.pending`,
> `summary.awaitingReturn`), jadi `listClaims_` harus membaca `ClaimItems`
> penuh — dan karena butuh JOIN, `QUERY()` tidak bisa dipakai. Paging yang sudah
> ada hanya memotong payload, bukan baca sheet.
>
> **Tahap 1 — denormalisasi.** Tambahkan kolom ringkasan pada sheet `Claims`
> (mis. `PendingCount`, `ApprovedCount`, `RejectedCount`, `ShippedCount`,
> `AwaitingReturnCount`, `AdvanceCount`). Isi dan pelihara dari
> `recomputeClaimStatus_` di `src/Claims.gs` — ia sudah berjalan tiap kali item
> berubah dan hanya dipanggil dari dua tempat (`src/Claims.gs:1043` dan `:1356`),
> jadi itu kait yang sempit dan aman. Sertakan skrip migrasi sekali-jalan untuk
> klaim lama.
>
> Bahaya utamanya adalah data terdenormalisasi yang diam-diam melenceng dari
> kenyataan. Pengujinya **harus** membandingkan kolom ringkasan dengan hitungan
> sungguhan dari `ClaimItems` untuk setiap klaim pada fixture, sesudah tiap jenis
> perubahan item (approve, reject, ship, advance issue, part return, hapus item).
> Kalau ada satu jalur yang lupa memanggil `recomputeClaimStatus_`, penguji itu
> yang harus menemukannya — cari juga jalur semacam itu sekarang.
>
> **Tahap 2 — pakai kolomnya.** Setelah tahap 1 terbukti: ubah aturan tab dan
> `listClaims_` agar membaca kolom ringkasan, sehingga `ClaimItems` **tidak
> dibaca sama sekali** untuk daftar klaim. Panel klaim tetap membaca item-nya
> sendiri saat dibuka. Ukur dan laporkan: berapa baris yang dibaca per
> `claims.list` sebelum dan sesudah.
>
> **Tahap 3 (opsional, hanya jika tahap 2 mulus).** Dengan satu sheet tanpa
> JOIN, `gviz/tq` jadi bisa dipakai untuk filter/sort/LIMIT di sisi Google.
> Timbang dulu: satu perjalanan HTTP tambahan dari Apps Script mungkin tidak
> lebih cepat daripada satu `getValues()`. **Ukur sebelum memutuskan**, dan
> kalau tidak lebih cepat, katakan begitu dan jangan dipakai.
>
> Jalankan suite lengkap tiap tahap, bangun ulang `dist/`, commit, push.

---

## E · Saved views — ✅ SELESAI (12 Sep 2026)

> Catatan koreksi: prompt di bawah bilang "`PropertiesService` per pengguna sudah
> cukup". **Itu keliru dan diam-diam.** Web app ini di-deploy dengan
> `executeAs: USER_DEPLOYING`, jadi `getUserProperties()` adalah milik orang yang
> men-deploy — untuk semua pengunjung. Satu administrator akan membuka portal dan
> menemukan preset orang lain, dan menyimpan berarti menimpanya. Tidak ada satu
> pun layar yang akan memberi tahu. Preset disimpan pada properti **skrip**
> dengan alamat si penandatangan sebagai kunci; alamat itu tetap yang asli
> walaupun seorang Tester sedang menyimulasikan peran lain, karena preset milik
> orangnya, bukan milik topi yang sedang dipakai.
>
> Yang dikerjakan: `src/Views.gs` (`views.list` / `views.save` / `views.delete`),
> pemilih di toolbar Claims, dan satu modal untuk menyimpan sekaligus menghapus.
> Yang disimpan: tab, potongan grouping, dan filter — **bukan kotak pencarian**,
> yang adalah pertanyaan sekali tanya, bukan cara kerja. Nama yang sama menimpa
> di tempat, batas 20 view, dan apa pun di luar field yang dikenal dibuang
> sebelum disimpan. Tidak ada state "view mana yang sedang dipilih": kecocokannya
> dihitung dari layar, jadi mengubah satu filter melepas view itu sendiri.
>
> Customer yang sudah tidak aktif: view-nya tetap terbuka, tab dan filter lain
> tetap terpasang, dan layar menyebut nama rumah sakitnya beserta alasan kenapa
> kosong, dengan satu tombol untuk membersihkan filter customer-nya.
> `tools/verify-views.js`, 51 pemeriksaan, terbukti menangkap sembilan bug.


> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`.
>
> Administrator menjalankan kombinasi filter yang sama tiap pagi. Simpan
> kombinasi filter yang sedang aktif (tab, status, warranty, customer,
> principal, rentang tanggal, potongan grouping) sebagai preset bernama, per
> pengguna, dan tawarkan di toolbar Claims.
>
> Simpan di mana pun yang paling ringan — `PropertiesService` per pengguna sudah
> cukup dan tidak menambah sheet. Preset yang menunjuk customer yang sudah tidak
> aktif harus tetap bisa dibuka, bukan membuat layar kosong tanpa penjelasan.
>
> Penguji dibuktikan menangkap bug-nya. Suite, `dist/`, commit, push.

---

## F · Aksi massal dari daftar klaim — ✅ SELESAI (12 Sep 2026)

> Bilah pilihan pada tabel klaim, mengikuti aturan bagian 18: **satu status,
> satu langkah**. Pilihan yang mencakup dua status tidak menawarkan apa pun dan
> **menyebutkan alasannya** — bilah yang sekadar kosong terbaca sebagai layar
> rusak. Satu penghalusan yang tidak disebut prompt: pada status `Submitted`,
> *Return to Requester* adalah langkah yang sama untuk kedua jenis garansi, jadi
> pilihan yang mencampur keduanya tetap boleh dikembalikan; yang ditahan hanya
> jalan ke depannya, dengan keterangannya.
>
> Kotak centang hanya muncul untuk peran yang punya langkah — Administrator dan
> Principal. Menampilkannya pada peran yang tidak pernah bisa memakainya hanya
> menambah kolom yang tidak berguna.
>
> Tiga endpoint batch di server (`claims.bulkReturn` / `bulkForward` /
> `bulkInternal`), bukan perulangan di browser: satu klaim per perjalanan akan
> membuat penerusan satu pagi jadi semenit menonton bilah kemajuan. **Klaim yang
> gagal tidak menghentikan sisanya** — kegagalannya ditangkap, disebut namanya,
> dan dilaporkan bersama klaimnya. Yang sudah berhasil tetap berhasil.
>
> `returnClaim_`, `forwardToPrincipal_` dan `startInternalVerification_` dipecah:
> intinya mengembalikan claim id, pembungkusnya memanggil `getClaim_`. Menjawab
> dengan `getClaim_` benar untuk satu klaim (panelnya digambar ulang darinya) dan
> boros untuk lima puluh — ia membaca item, lampiran, dan seluruh jejak audit per
> klaim. Terukur: 39 pembacaan untuk satu batch berisi lima klaim, versus 54 bila
> dijalankan satu per satu.
>
> Nomor work order milik satu klaim, jadi batch penerusan meminta satu nomor per
> klaim — bukan satu nomor untuk semuanya. `tools/verify-bulk.js`, 69 pemeriksaan,
> terbukti menangkap sepuluh bug.
>
> Satu hal yang **tidak** diubah dan patut diketahui: `returnClaim_` mengirim satu
> email per klaim, jadi mengembalikan lima klaim milik satu requester mengirim
> lima pesan. Sama seperti bila dikerjakan satu per satu hari ini; menggabungkannya
> butuh template baru dan itu di luar butir ini.


> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`.
>
> Aksi massal sudah ada di layar Orders dan Advance Issue, tapi tidak di layar
> Claims — padahal di situlah orang melihat banyak klaim sekaligus.
>
> Tambahkan pemilihan baris pada tabel klaim dengan bilah pilihan yang mengikuti
> aturan yang sudah berlaku di bagian 18 deskripsi PR: **satu status, satu
> langkah**. Pilihan yang mencakup klaim dengan status berbeda tidak menawarkan
> apa pun — sama seperti Orders yang tidak menawarkan apa pun bila pilihannya
> mencakup dua daftar. Hormati juga aturan peran.
>
> Penguji dibuktikan menangkap bug-nya. Suite, `dist/`, commit, push.

---

## G · Penanda "baru sejak terakhir dilihat" — ✅ SELESAI (12 Sep 2026)

> `src/Visits.gs`, disimpan pada properti skrip dengan alamat sebagai kunci —
> alasannya sama dengan butir E, dan dirujuk dari sana.
>
> **Dua stempel, bukan satu.** `seen` adalah kapan orangnya terakhir di sini;
> `boundary` adalah apa yang penandanya diukur terhadapnya, dan sengaja bukan
> hal yang sama. Muat ulang halaman adalah sign-in baru, jadi memindahkan batas
> pada tiap sign-in akan menghapus penandanya sebelum sempat dibaca — persis
> kegagalan yang prompt ini peringatkan, hanya lebih pelan. Kunjungan yang
> berjarak kurang dari 30 menit dihitung satu kunjungan dan batasnya diam;
> absen lebih lama memindahkannya ke tempat orangnya berhenti.
>
> Batasnya **hanya** bergerak saat halaman dibuka (`session.bootstrap`) dan saat
> orangnya bilang sudah melihat. Tidak pernah saat daftar digambar — `listClaims_`
> membaca, tidak pernah menulis.
>
> Kunjungan pertama menandai **nol**. Portal yang menyambut orang dengan empat
> ratus klaim bertanda baru tidak memberi tahu apa pun.
>
> Perubahan oleh diri sendiri tidak ditandai — `UpdatedBy` dibandingkan dengan
> alamat penandatangan. Kolom ringkasan ditulis lewat `setCells_` yang tidak
> menyentuh `UpdatedAt`/`UpdatedBy`, jadi menghitung ulang sparepart tidak pernah
> membuat klaim tampak baru; pengujinya membuktikan itu.
>
> Tampilannya: satu penanda kecil di dalam sel Claim (jadi tata letak kartu tidak
> perlu tempat baru untuknya), dan satu baris di bawah filter yang menyebut
> jumlahnya — termasuk yang tidak muat di halaman ini, yang justru tidak bisa
> diberitahukan oleh penanda per baris. Satu tombol "Mark as seen" di sebelahnya.
> `tools/verify-visits.js`, 39 pemeriksaan, terbukti menangkap sembilan bug.


> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`.
>
> Menjawab "apa yang bergerak semalam?" tanpa layar baru. Simpan stempel waktu
> kunjungan terakhir per pengguna, dan tandai klaim yang `UpdatedAt`-nya lebih
> baru dari itu.
>
> Dua hal yang menentukan apakah ini berguna atau mengganggu: kapan stempelnya
> diperbarui (jangan saat halaman digambar, atau penandanya hilang sebelum
> sempat dibaca), dan perubahan oleh diri sendiri **tidak** boleh ditandai
> sebagai baru.
>
> Penguji dibuktikan menangkap bug-nya. Suite, `dist/`, commit, push.

---

## H · Master produk dan aturan garansi — mesinnya saja — ✅ SELESAI (12 Sep 2026)

> Catatan koreksi, tiga hal yang salah di prompt di bawah:
>
> 1. **`pickRule_(material, scope, channel, basisDate)` tidak bisa dipanggil
>    begitu.** Jendela efektif dicocokkan ke tanggal dasar, sedangkan tanggal
>    dasar mana yang berlaku baru diketahui setelah aturannya terpilih — dua
>    aturan pada model yang sama boleh menghitung dari dua tanggal berbeda.
>    Parameter terakhirnya jadi **unit**-nya, bukan satu tanggal.
> 2. **"Tanpa mengubah satu pun perilaku yang terlihat" tidak bisa dipenuhi
>    sepenuhnya.** Aturan yang menghitung dari tanggal harian menghasilkan masa
>    berlaku bertanggal, sementara `monthLabel` di klien hanya menggambar bulan
>    — "valid until Sep 2027" untuk garansi yang habis 3 September adalah
>    sebulan cover yang tidak ada. `monthLabel` diberi satu cabang untuk tanggal
>    penuh; hasil untuk data lama tidak berubah sama sekali.
> 3. **"Tanpa satu pun penguji disentuh" berlaku untuk pemeriksaannya, bukan
>    untuk daftar muatnya.** Empat penguji perlu `'WarrantyRules.gs'`
>    ditambahkan ke daftar berkas yang dimuat, seperti `Visits.gs` dulu. Tidak
>    ada satu pun pemeriksaan yang diubah.
>
> Kunci cache `populationIndex` **sengaja tidak dinaikkan** walaupun bentuknya
> berubah: entri lama tidak punya `material`, jadi unitnya dijawab jaring
> pengaman sampai kedaluwarsa — persis jawaban sebelum deploy. Setengah jam
> perilaku yang tidak berubah, bukan tanggal yang salah.

> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. Baca
> `docs/warranty-model.md` bagian 1–3, 6 dan 11 lebih dulu.
>
> Hari ini `determineWarranty_` di `src/Warranty.gs` menjawab `22 bulan` untuk
> setiap serial berawalan XT, karena `XT_WARRANTY_MONTHS = 22` di
> `src/Config.gs` adalah satu-satunya aturan yang ada. Kenyataannya tiap model
> punya masa garansinya sendiri, dasar hitungnya berbeda-beda per principal, dan
> ada dua tingkat garansi. Butir ini memindahkan aturannya dari kode ke data.
> **Tanpa layar apa pun, tanpa menyentuh `Population`, tanpa mengubah satu pun
> perilaku yang terlihat** — itu butir I dan seterusnya.
>
> **Tiga sheet baru** di `SCHEMA` (`src/Config.gs`), otomatis dibuat
> `ensureSheets_` (`src/Repo.gs:45`):
>
> - `Products`: `Material` (kunci), `Name`, `Principal`, `Regulation`
>   (`AKD`/`AKL`), `SerialPattern`, `Active`, `Notes`. Satu model = satu
>   `Material`, sudah dipastikan ke pemilik repo.
> - `WarrantyRules`: `RuleID`, `Material`, `Scope` (`principal`|`customer`),
>   `Channel` (`direct`|`distributor`|`*`), `Basis`
>   (`assembly`|`selling-in`|`received`|`installation`), `Months`,
>   `EffectiveFrom`, `EffectiveTo`, `Active`, `Notes`.
> - `Distributors`: `DistributorID`, `Name`, `Email`, `Active`, `Notes`. Sheet
>   `users` dapat kolom `Distributor`.
>
> **Berkas baru `src/WarrantyRules.gs`** — daftarkan di `ORDER` pada
> `tools/bundle.js`, bundler menolak `.gs` yang belum terdaftar:
>
> - `productsIndex_()` dan `rulesIndex_()`, di-cache dan di-memo persis seperti
>   `warrantyIndex_` di `src/Warranty.gs:157` (`INDEX_MEMO` + `cachePutLarge_`).
> - `pickRule_(material, scope, channel, basisDate)`. Pemilihannya:
>   `Channel` spesifik mengalahkan `*`; kalau masih seri, `EffectiveFrom` paling
>   akhir menang. `EffectiveFrom`/`To` dicocokkan ke **tanggal dasar unitnya**,
>   bukan ke hari ini — kebijakan yang berubah tahun ini tidak boleh memundurkan
>   garansi unit yang dijual tiga tahun lalu. Tidak ada yang cocok → `null`.
> - `resolveWarranty_(unit, scope, today)` → `{type, start, expiry, basis,
>   months, source, missing}`. `missing` berisi **apa** yang kurang saat
>   jawabannya manual ("belum ada tanggal BAST"), bukan sekadar "perlu dicek" —
>   itu yang membuat layar bisa menyuruh orang berbuat sesuatu.
> - `basisDate_(unit, basis)` mengambil tanggal yang diminta aturan.
>   **Kosong berarti `Manual`, tidak pernah mundur diam-diam ke tanggal lain.**
>   Itu keputusan pemilik repo, bukan pilihan implementasi.
>
> Presedensi, dari yang menang: penimpaan manual per klaim
> (`WarrantyOverridden`, sudah ada) → `ExtendedMonths*` pada unit (butir I) →
> baris `WarrantyRules` → rumus serial lama → `Manual` + daftar yang kurang.
>
> **Kompatibilitas, ini yang paling mudah dirusak:** `determineWarranty_` tetap
> ada, tetap dipanggil dari tempat yang sama, dan **wajib mengembalikan bentuk
> yang sama persis** (`{type, expiry, basis, assemblyMonth, daysRemaining,
> source}`). Isinya jadi: kalau ada aturan yang cocok pakai itu, kalau tidak
> jatuh kembali ke rumus 22 bulan yang sekarang. Sheet `WarrantyRules` yang
> kosong harus membuat seluruh suite tetap hijau **tanpa satu penguji pun
> disentuh** — kalau ada yang perlu diubah, rancangannya yang salah, bukan
> pengujinya.
>
> Penguji baru `tools/verify-rules.js`: pemilihan aturan (spesifik vs `*`,
> jendela efektif, seri), keempat `Basis`, `missing` yang benar, dan jaring
> pengaman rumus lama saat sheet kosong. Buktikan menangkap bugnya. Suite,
> `node tools/bundle.js`, commit, push.

---

## I · Kolom garansi pada unit, dan pengisian awalnya — ✅ SELESAI (12 Sep 2026)

> Catatan koreksi, empat hal:
>
> 1. **`setCells_` tidak dipakai, dan tidak seharusnya.** Ia murah kalau
>    barisnya sudah di tangan; tidak ada yang memegang baris `Population`, jadi
>    mencarinya berarti membaca sheet — dan setelah dibaca, yang murah adalah
>    menulis satu kolom penuh. Menghitung ulang satu unit dan menghitung ulang
>    semuanya jadi sama biayanya, dan jalur kodenya satu, bukan dua yang bisa
>    berbeda pendapat.
> 2. **"Tidak menaikkan `RowVersion`" tidak berlaku di sini** — `Population`
>    tidak punya kolom itu. Yang diuji sebagai gantinya: satu penghitungan ulang
>    menyentuh tujuh kolomnya sendiri dan stempelnya, dan **tidak satu sel pun
>    di luar itu**, termasuk tidak merapikan `dd/mm/yyyy` yang diketik orang
>    menjadi ISO.
> 3. **`populationIndex_` harus membaca baris lewat `unitRowToUnit_` juga.**
>    Prompt tidak menyebutnya, dan tanpa itu form klaim dan kolom tersimpan bisa
>    berbeda pendapat tentang tanggal yang sama: satu membaca `20/05/2024`, satu
>    lagi tidak bisa membacanya sama sekali. Satu bentuk unit, satu tempat.
> 4. **`parseLocalDate_` juga menerima ISO**, karena itulah yang sudah ada di
>    sheet dan satu-satunya bentuk lain yang tidak bisa salah baca. `mm/dd/yyyy`
>    ditolak dengan harga berapa pun. Pemeriksaan `Date`-nya memakai
>    `Object.prototype.toString.call`, bukan `instanceof` — `Date` dari konteks
>    lain tetap `Date`.
>
> Berkasnya `src/Units.gs`, bukan menumpang di `WarrantyRules.gs`: yang satu
> soal aturan, yang satu soal register unit.
>
> Terukur: `populationIndex_` jadi **840.286 byte untuk 2.610 unit — 10 dari 40
> potongan cache** yang boleh dipakai, jadi tetap muat lewat `cachePutLarge_`.
> Satu penghitungan ulang membaca 65.275 sel dan menulis 8 kolom, berapa pun
> jumlah unit yang diminta. `measure-list.js` **tidak bergerak sama sekali**:
> tetap 2 getValues / 30.846 sel, karena kolom garansi klaim ada di baris klaim.

> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. Butuh H.
> Baca `docs/warranty-model.md` bagian 2, 4 dan 8.
>
> H membuat mesinnya. Butir ini memberinya data untuk dibaca, dan menyimpan
> hasilnya di baris unit supaya daftar klaim tidak menghitung garansi 400 kali.
>
> **Kolom tambahan pada `SCHEMA[SHEET.POPULATION]`.** Diisi manusia atau impor:
> `Channel`, `DistributorID`, `CustomerID`, `ReceivedAtDistributor`,
> `InstalledAt`, `ExtendedMonthsPrincipal`, `ExtendedMonthsCustomer`,
> `ContractRef`, `WarrantyNote`. Dihitung dan ditulis balik: `AssemblyMonth`,
> `WarrantyStartPrincipal`, `WarrantyEndPrincipal`, `WarrantyBasisPrincipal`,
> `WarrantyStartCustomer`, `WarrantyEndCustomer`, `WarrantyBasisCustomer`,
> `WarrantyComputedAt`.
>
> **Disiplinnya sama persis dengan kolom ringkasan di `Claims`** — baca
> `summaryOf_` dan `refreshClaimSummaries_` di `src/Claims.gs` dulu, lalu tiru:
> `recomputeUnitWarranty_(serials)` **selalu menghitung ulang dari sumbernya,
> tidak pernah menambah atau mengurangi**, dan menulis dengan `setCells_`
> sehingga `RowVersion` tidak naik.
>
> **Simpan tanggal, jangan simpan status.** "Masih bergaransi" berubah sendiri
> besok pagi; yang disimpan `WarrantyEnd`, verdictnya dihitung saat dibaca.
> Kalau ada kolom bernama `WarrantyStatus` di hasil kerja ini, rancangannya
> dilanggar.
>
> **`parseLocalDate_`, dan ini bukan detail kecil.** Berkas impor pemilik repo
> berformat `dd/mm/yyyy`. `03/09/2025` adalah 3 September bagi mereka dan
> 9 Maret bagi `new Date()`. Tulis satu fungsi yang membaca hari dulu dan
> **menolak** apa pun yang bukan `dd/mm/yyyy`; jangan pernah menyerahkan teks
> tanggal ke `new Date()`. Ingat juga jebakan lama: `google.script.run` menolak
> `Date` di mana pun dalam nilai kembalian — simpan dan kembalikan teks ISO.
>
> `backfillUnitWarranty()` di `src/Setup.gs`, sepola dengan
> `backfillClaimSummaries_` (`src/Setup.gs:44`): satu kolom penuh sekali jalan,
> bukan satu sel per baris, dan baris tanpa data dibiarkan apa adanya. Panggil
> dari `setUp()`.
>
> Ukur `populationIndex_` sesudahnya. 2.610 unit dikali kolom baru
> diperkirakan menembus batas 100KB satu entri `CacheService` jauh-jauh — pastikan
> lewat `cachePutLarge_` dan laporkan angkanya. Jalankan juga
> `node tools/measure-list.js` sebelum dan sesudah: `listClaims_` **tidak boleh**
> jadi lebih mahal, karena kolom garansi klaim ada di baris klaim, bukan di sini.
>
> Penguji baru `tools/verify-unit-warranty.js`: keempat dasar hitung,
> extended warranty yang memundurkan dua sisi dengan angka berbeda,
> `dd/mm/yyyy` yang terbaca benar dan format lain yang ditolak, penulisan yang
> tidak menaikkan `RowVersion`, dan backfill yang tidak menyentuh baris kosong.
> Buktikan menangkap bugnya. Suite, `dist/`, commit, push.

---

## J · Dua tingkat garansi pada klaim — ✅ SELESAI (12 Sep 2026)

> Catatan koreksi, empat hal:
>
> 1. **Teknisi lapangan tidak diberi dua baris, tapi satu — baris kita.**
>    Prompt bilang form klaim menampilkan dua baris untuk semua orang. Itu
>    keliru: apa yang masih ditanggung principal adalah posisi dagang kita
>    dengan mereka, dan orang yang berdiri di depan alat rusak tidak bisa
>    berbuat apa-apa dengannya. Yang perlu dia tahu adalah apakah **kita**
>    menanggung perbaikannya. Dua baris tetap ada, tapi untuk orang dalam
>    perusahaan. Kalau sisi kita belum diketahui, layarnya bilang begitu —
>    bukan menjawab pertanyaan yang lain dan berharap keduanya sama. Sering
>    tidak sama; itu justru alasan adanya tingkat kedua.
> 2. **Penyaringannya di dua tempat, bukan satu.** `listClaims_` dan
>    `getClaim_`, **dan** sekali lagi di `api()`. Bukan berlebihan: **ekspor
>    Excel ditulis di server lalu diserahkan sebagai tautan Drive, dan tidak
>    pernah lewat dispatcher sama sekali** — penyaringan di dispatcher saja
>    akan meloloskan seluruh isi berkasnya.
> 3. **`costBorne` wajib lewat `isTrue_`.** Prompt tidak menyinggung saved
>    views, padahal saringan baru ikut tersimpan di sana — dan kotak yang tidak
>    dicentang, disimpan sebagai teks, kembali sebagai string `"false"`, yang
>    bernilai benar. `VIEW_BOOLS` ditambahkan di `Views.gs` supaya tersimpan
>    sebagai boolean sungguhan.
> 4. Judul kolom ekspor `Warranty` jadi `Principal warranty`, karena sekarang
>    ada dua. Saringan distributor ditambahkan di luar prompt — klaim sudah
>    menyebut distributornya, dan admin jelas akan mencarinya begitu.
>
> Terukur: baris `Claims` bertambah 7 kolom, `measure-list.js` naik dari
> 16.520 jadi **19.411 sel (+17%)** untuk 412 klaim, tetap **satu `getValues`**.
> Sisi customer tidak pernah dibaca dari `Population` saat menggambar daftar.

> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. Butuh H dan I.
> Baca `docs/warranty-model.md` bagian 5 dan 7, dan
> `docs/business-context.md` bagian "Dua tingkat garansi".
>
> Ini butir yang menjawab pertanyaan direksi: **berapa biaya garansi yang kita
> serap** — unit yang garansi principal-nya sudah habis tapi garansi kita ke
> pembeli masih jalan. Hari ini kotak itu tampil sama saja dengan "sudah habis".
>
> **Kolom tambahan di `SCHEMA[SHEET.CLAIMS]`**, semuanya aditif:
> `DistributorID`, `DistributorName`, `CustomerWarrantyType`,
> `CustomerWarrantyExpiry`, `CustomerWarrantyBasis`, `CostBorne`,
> `WarrantySnapshotAt`.
>
> **`WarrantyType` tidak berubah artinya.** Ia berarti sisi principal, dan ia
> yang mengunci `forwardOrder_`, `visibleClaims_` (`src/Auth.gs:192`),
> `verify-tabs` dan `verify-fulfilment`. Jangan ditumpangi. Yang berubah hanya
> labelnya di layar jadi "Principal warranty".
>
> Potretnya ditulis di `saveClaim_`, di blok yang sekarang menulis
> `fields.WarrantyType` (`src/Claims.gs:549`), dan mengikuti aturan yang sudah
> ada di sana: penimpaan manual bertahan sampai serial-nya sendiri berubah.
> **Klaim memotret, tidak menunjuk** — perbaikan data unit bulan depan tidak
> boleh menulis ulang sejarah klaim yang sudah diputus. `CostBorne` ikut
> disimpan, bukan dihitung saat membaca, dengan alasan yang sama seperti kolom
> ringkasan.
>
> **Principal tidak boleh melihat sisi customer sama sekali** — keputusan
> pemilik repo, 12 Sep 2026. Bukan disembunyikan dengan CSS: ketiga kolom
> customer dan `CostBorne` **tidak boleh ada di payload** yang sampai ke akun
> principal. Perhatikan bahwa `shapeClaim_` (`src/Claims.gs:319`) tidak menerima
> `session`, jadi penyaringannya harus dipasang sadar-peran; pilih tempatnya
> baik-baik dan pastikan `claims.list`, detail klaim, **dan ekspor** semuanya
> ikut tersaring. Ekspor yang bocor sama saja dengan layar yang bocor.
>
> Di klien (`src/Script.html`): form klaim menampilkan **dua** baris garansi
> dengan penjelasan masing-masing, bukan satu; peringatan sebelum submit kalau
> dua-duanya habis, bukan sesudah; daftar klaim dapat kolom garansi customer dan
> saringan `CostBorne`. Klaim jalur distributor menyebut **distributor dan rumah
> sakit sekaligus**.
>
> Penguji baru `tools/verify-two-tier.js`, dan pemeriksaan kebocoran payload
> principal adalah yang **wajib** ada: keempat kotak kombinasi garansi,
> `CostBorne` yang benar, potret yang tidak berubah saat data unit diperbaiki,
> dan akun principal yang tidak menerima satu pun field customer di list, detail
> maupun ekspor. Buktikan menangkap bugnya. Suite, `dist/`, commit, push.

---

## K · Layar aturan garansi — ✅ SELESAI (12 Sep 2026)

> Catatan koreksi, tiga hal:
>
> 1. **Butir L merusak `MasterData.gs` dan itu ketahuan saat mengerjakan K.**
>    Penghapusan `listUnits_` di butir L ikut menghapus `listMaster_`,
>    `masterUsage_`, `saveMaster_`, `validateUsers_` dan `nextMasterId_` —
>    seluruh layar master data mati, dan **suite tetap hijau** karena tidak ada
>    penguji yang memanggil rute-rute itu. Sudah dikembalikan. `verify-sheets.js`
>    sekarang membaca `route_` dan memastikan **setiap fungsi yang dirutekan
>    benar-benar ada**; revert-nya dibuktikan menangkap persis kesalahan itu.
> 2. **Aturan `*` tidak bertabrakan dengan aturan yang menyebut channel.**
>    Prompt bilang tolak yang tumpang tindih untuk "Material + Scope + Channel
>    yang sama"; itu benar, dan penting untuk dinyatakan: `pickRule_` memang
>    sengaja mendahulukan yang spesifik, jadi "aturan umum + satu pengecualian"
>    adalah bentuk yang wajar dan **harus** diterima. Menolaknya akan membuat
>    layar ini tidak bisa dipakai untuk kasus yang paling sering.
> 3. **Menyimpan aturan langsung menghitung ulang seluruh unit.** Tidak diminta
>    prompt, tapi tanpa itu admin mengubah 12 bulan jadi 24, tidak melihat satu
>    unit pun bergerak, dan tidak punya cara apa pun mencari tahu kenapa —
>    tanggalnya ada di baris unit dan dihitung di bawah aturan yang lama.
>
> Dua hal kecil di luar prompt: aturan non-aktif boleh ditulis lebih dulu
> sebagai draf sementara aturan lama masih hidup (menyalakannya baru ditolak),
> dan `Products` dapat penjaga duplikat karena kuncinya diketik orang —
> satu-satunya master data yang begitu.

> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. Butuh H.
>
> `WarrantyRules` menentukan jawaban portal ke semua orang. Menyunting langsung
> di Google Sheets ditolak pemilik repo: satu salah ketik bisa mengubah jawaban
> garansi ratusan unit tanpa jejak siapa pun.
>
> Layar Administrator untuk `Products`, `WarrantyRules` dan `Distributors`:
> daftar, tambah, sunting, non-aktifkan. Bukan hapus — `Active = FALSE`, karena
> aturan yang pernah dipakai adalah bagian dari sejarah klaim yang sudah diputus.
>
> Validasi sebelum simpan, dan inilah isi sebenarnya butir ini: `Material` harus
> ada di `Products`; `Basis` dan `Scope` harus salah satu nilai yang dikenal;
> `Months` bilangan bulat positif; jendela `EffectiveFrom`/`To` yang tumpang
> tindih untuk `Material` + `Scope` + `Channel` yang sama **ditolak dengan
> menyebut baris mana yang bertabrakan** — bukan diterima lalu dibiarkan
> `pickRule_` yang memilih diam-diam.
>
> Setiap perubahan masuk `AuditLog` dengan nilai lama dan barunya, lewat jalur
> audit yang sudah ada di `src/Audit.gs`. Kosongkan cache indeks setelah
> menyimpan, atau aturan barunya baru berlaku setengah jam kemudian dan tidak
> akan ada yang paham kenapa.
>
> Penguji baru `tools/verify-rules-admin.js`: penolakan jendela yang tumpang
> tindih, validasi tiap field, jejak audit yang tercatat, cache yang dikosongkan.
> Buktikan menangkap bugnya. Suite, `dist/`, commit, push.

---

## L · Layar unit dan impor massal — ✅ SELESAI (12 Sep 2026)

> Catatan koreksi, lima hal:
>
> 1. **Butir ini tidak butuh K.** Prompt bilang "Butuh H, I, K"; K adalah layar
>    aturan garansi dan tidak menyentuh apa pun di sini. Dikerjakan setelah J,
>    tanpa K, tanpa masalah.
> 2. **Ada bug serius yang ditemukan saat mengerjakannya, dan itu bagian
>    terpenting dari butir ini.** `importUnits_` mengosongkan **seluruh lebar
>    baris** sebelum menulis balik kolom dari berkas principal. Berkas itu hanya
>    membawa delapan kolom miliknya sendiri — jadi sejak butir I, satu impor
>    rutin akan **menghapus seluruh `Channel`, `InstalledAt`, `ExtendedMonths`
>    dan kolom garansi terhitung pada 2.610 unit**, tanpa pesan apa pun, dan baru
>    terlihat berbulan-bulan kemudian sebagai garansi yang tiba-tiba tidak bisa
>    dihitung. Sekarang hanya kolom yang benar-benar dibawa berkasnya yang
>    disentuh, dan impor memanggil `recomputeUnitWarranty_` setelahnya.
> 3. **Impornya CSV/TSV, bukan xlsx.** Alasannya: pemetaan kolom butuh header
>    berkasnya di browser, dan pratinjau harus melihat **baris yang sama persis**
>    dengan yang nanti ditulis. Lewat Drive, keduanya harus dibaca dua kali dan
>    bisa berbeda. Impor workbook principal yang lama tetap ada, tidak berubah.
>    Pemisahnya dikenali sendiri — koma, titik koma (yang ditulis Excel
>    Indonesia), atau tab dari tempelan spreadsheet.
> 4. **"Layar unit belum lengkap" jadi saringan pada layar unit**, bukan layar
>    terpisah: sumbernya sama, kolomnya sama, dan digabung ia bisa dipersempit
>    per distributor dan per model sekaligus — yang mengubahnya dari daftar jadi
>    perintah kerja.
> 5. **Tanggal disimpan sebagai ISO**, dinormalkan saat disimpan lewat form atau
>    impor. `recomputeUnitWarranty_` tetap tidak pernah menulis ulang sel yang
>    bukan miliknya, jadi sel yang tidak disunting siapa pun tetap apa adanya.
>
> Gelombang impor 500 baris per panggilan, tiap gelombang satu lintasan penuh
> dan utuh sendiri; layar bilang sudah sampai berapa. Menulis satu kolom sekali,
> bukan satu baris sekali — dibuktikan dengan menghitung `setValues`.

> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. Butuh H, I, K.
>
> Sampai butir ini, kolom-kolom baru di `Population` hanya bisa diisi dengan
> membuka Google Sheets. Butir ini memberi Administrator tempat yang benar untuk
> merawatnya — dan tanpa ini, butir M tidak punya tempat mendaftarkan unit.
>
> Layar unit: cari berdasarkan serial, model, distributor atau rumah sakit;
> sunting satu unit; daftarkan unit baru. Setiap penyimpanan memanggil
> `recomputeUnitWarranty_` untuk unit itu saja dan menulis jejak audit.
>
> Impor massal: unggah berkas, petakan kolomnya, **tampilkan pratinjau beserta
> baris yang akan ditolak sebelum satu sel pun ditulis**. Tanggal `dd/mm/yyyy`
> lewat `parseLocalDate_` dari butir I; baris dengan tanggal ambigu ditolak
> dengan menyebut nomor barisnya, tidak ditebak. Ingat batas
> `MAX_UPLOAD_BYTES`/`MAX_IMPORT_BYTES` yang sudah ada di `src/Config.gs` dan
> `src/Script.html`.
>
> **Batas eksekusi 6 menit.** 2.610 unit harus ditulis dengan operasi kolom
> penuh di server dalam satu eksekusi, bukan satu perjalanan per baris dari
> browser. Kalau impornya bisa melebihi itu, potong jadi beberapa gelombang yang
> bisa dilanjutkan, dan katakan di layar sudah sampai mana.
>
> Layar "unit belum lengkap": unit yang `WarrantyEnd`-nya tidak bisa dihitung,
> beserta **apa** yang kurang (`missing` dari `resolveWarranty_`), bisa disaring
> per distributor dan per model. Itu yang membuat pengisian data punya ujung.
>
> Penguji baru `tools/verify-unit-admin.js`: pratinjau yang menolak sebelum
> menulis, `dd/mm/yyyy` yang benar dan yang ambigu ditolak, recompute yang
> terpicu setelah sunting, dan daftar "belum lengkap" yang menyebutkan alasan
> yang tepat. Buktikan menangkap bugnya. Suite, `dist/`, commit, push.

---

## M · Unit tak terdaftar: tolak, simpan draft, minta pendaftaran — ✅ SELESAI (13 Sep 2026)

> Catatan koreksi, tiga hal:
>
> 1. **Penolakannya bukan `throw`.** Prompt bilang "submit ditolak"; kalau itu
>    dikerjakan sebagai error, orang yang tidak melakukan kesalahan apa pun
>    mendapat kotak merah. `submitClaim_` mengembalikan draftnya beserta
>    `unitRequest`, dan layarnya menjelaskan apa yang terjadi dan siapa yang
>    sedang mengerjakannya.
> 2. **Diperiksa SETELAH aturan kelengkapan, bukan sebelumnya.** Draft yang
>    menunggu harus yang bisa langsung jalan begitu unitnya ada, dan draft
>    setengah jadi tidak bisa. Form klaim sudah memperingatkan begitu serial
>    diketik, jadi tidak ada yang mengisi seluruh formulir tanpa diberi tahu.
> 3. **`resolveUnitRequests_` bertanya ke register, bukan percaya pemanggilnya.**
>    Unit bisa masuk lewat empat jalur — form unit, impor CSV, workbook
>    principal, atau sudah ada sejak awal — dan permintaan yang tertinggal
>    terbuka di belakang salah satunya adalah draft yang tidak pernah terdengar
>    lagi. Jadi ketiga jalur yang bisa menambah unit memanggilnya.
>
> Satu hal di luar prompt: `verify-templates.js` dulu memeriksa "ada tujuh
> template". Angka itu basi tiap kali ada template baru; sekarang ia memeriksa
> **setiap kode punya bawaannya dan tidak ada bawaan tanpa kode**.

> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. Butuh L.
> Baca `docs/business-context.md` bagian "Unit yang tidak terdaftar".
>
> **Ini membalik keputusan bagian 2 deskripsi PR #1**, dan pembalikannya
> disengaja: dulu serial di luar `Population` diterima dan ditandai untuk
> pemeriksaan manual. Sekarang **submit ditolak**, karena ada sistem pencatatan
> instalasi di luar portal yang harus diperbarui lebih dulu, dan karena ini
> bentuk edukasi ke distributor agar melaporkan unit yang mereka pasang.
> Perbarui deskripsi PR-nya saat mengerjakan ini.
>
> Tetapi **pekerjaan lapangan tidak boleh hilang.** Orang yang sedang berdiri di
> depan alat rusak sudah mengetik keluhan dan memotret partnya. Yang benar:
> klaimnya tersimpan sebagai `Draft` lengkap dengan lampirannya, dan satu baris
> masuk ke sheet baru `UnitRequests` — `RequestID`, `SerialNumber`,
> `ProductGuess`, `CustomerID`, `DistributorID`, `Note`, `DriveFolderId`,
> `ClaimID` (draft yang menunggu), `Status` (`Open`/`Registered`/`Rejected`),
> `RequestedBy`, `RequestedAt`, `HandledBy`, `HandledAt`.
>
> Administrator diberi tahu **lewat email dan antrean di layar**, keduanya —
> keputusan pemilik repo. Pakai jalur email yang sudah ada di `src/Mailer.gs`
> dengan template baru, dan hormati `SETTING_KEY.EMAIL_ENABLED`.
>
> Lingkarannya harus tertutup: begitu Administrator mendaftarkan unitnya lewat
> layar butir L, permintaan itu jadi `Registered` dan **pengaju bisa langsung
> meneruskan draftnya tanpa mengetik ulang apa pun**. Draft yang unitnya sudah
> terdaftar tidak boleh tertinggal tanpa pemberitahuan.
>
> Penguji baru `tools/verify-unit-requests.js`: submit ditolak tapi draft
> tersimpan lengkap dengan lampiran, permintaan yang terbentuk, email yang
> tercatat, dan draft yang bisa diteruskan setelah unitnya didaftarkan.
> Buktikan menangkap bugnya. Suite, `dist/`, commit, push.

---

## N · Laporan biaya garansi yang kita serap — ✅ SELESAI (13 Sep 2026)

> Catatan koreksi, dua hal:
>
> 1. **Satu definisi, bukan dua.** Percobaan pertama menyaring `costBorne` di
>    `listClaims_` **dan** memeriksanya lagi di `countsAsCost_`. Keduanya benar,
>    jadi menghapus salah satunya tidak mengubah apa pun — dan revert-nya lolos.
>    Yang menyaring sekarang hanya `countsAsCost_`; dua definisi untuk hal yang
>    sama akan bergeser, dan yang bergeser adalah yang tidak diuji siapa pun.
> 2. **Penulis workbook diangkat keluar dari `exportClaims_`** jadi
>    `writeWorkbook_`, karena sekarang ada dua laporan. Sekalian ia meratakan
>    baris yang panjangnya berbeda — laporan ini punya baris ringkasan yang
>    lebih pendek dari baris klaimnya, dan `setValues` menolak larik yang tidak
>    rata.
>
> Lima cara memotong (bulan, produk, principal, distributor, rumah sakit)
> dihitung dalam satu lintasan dan dikirim sekaligus: himpunannya sudah dibaca
> untuk membuat salah satunya, dan meminta ulang per potongan berarti empat
> pembacaan sheet `Claims` lagi untuk pertanyaan yang sudah dijawab.
>
> Tiga hal yang **tidak** dihitung, masing-masing dengan pemeriksaannya: part
> yang ditolak (tidak ada biaya), klaim yang masih draft (belum jadi apa-apa),
> dan klaim yang principal-nya masih menanggung.

> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. Butuh J.
>
> Butir J menyimpan `CostBorne` per klaim. Butir ini membuatnya bisa dibaca:
> berapa banyak, atas model apa, dari distributor mana, dalam rentang tanggal
> yang dipilih. Diekspor lewat jalur `src/Export.gs` yang sudah ada.
>
> **Hati-hati pada paging.** Paging bersifat opt-in (`limit`) justru karena
> halaman default akan diam-diam memotong ekspor jadi 50 baris yang tampak
> lengkap. Laporan ini membaca seluruh himpunan.
>
> Nilai rupiah per sparepart **belum ada di portal** dan belum diputuskan. Jadi
> laporan ini menghitung **jumlah klaim dan jumlah part**, bukan rupiah. Kalau
> nilai rupiah diinginkan, itu butir tersendiri yang dimulai dari menambah harga
> ke master `sparepart` — jangan diselundupkan ke sini.
>
> Penguji baru `tools/verify-cost-report.js`: pengelompokan yang benar, rentang
> tanggal yang inklusif di kedua ujungnya, dan ekspor yang tidak terpotong.
> Buktikan menangkap bugnya. Suite, `dist/`, commit, push.

---

## O · Akun distributor: satu perusahaan satu akun — ✅ SELESAI (13 Sep 2026)

> Catatan koreksi, dua hal:
>
> 1. **Aturan yang ditulis prompt masih membocorkan, dan jalan keluarnya kolom
>    baru.** Prompt bilang aman kalau "`DistributorID` cocok DAN klaimnya
>    diajukan oleh akun distributor" — benar, tapi bagian kedua itu berarti
>    menengok sheet `users` untuk **tiap baris klaim**, pada fungsi yang dipanggil
>    setiap kali daftar digambar. Yang dikerjakan: `Claims` dapat kolom
>    `RequesterDistributorID`, dicap **sekali saat klaim dibuat** dari akun yang
>    membuatnya. Penyaringannya jadi perbandingan satu kolom, tanpa join, dan
>    jebakannya hilang dengan sendirinya — klaim yang dibuat field service kita
>    kolomnya kosong, jadi tidak ada distributor yang melihatnya betapa pun
>    unitnya milik siapa.
> 2. **Butuh backfill, dan prompt tidak menyebutnya.** Klaim yang dibuat sebelum
>    kolom itu ada isinya kosong — tanpa `backfillRequesterDistributor_()`,
>    pagi setelah deploy distributor membuka portal dan seluruh riwayatnya
>    hilang. Backfill-nya **hanya mengisi yang kosong**, jadi menjalankannya lagi
>    setelah sebuah akun dipindahtangankan tidak menyeret klaim lama ikut pindah.
>
> Satu keputusan bisnis **belum diambil dan sengaja tidak dikerjakan**: apakah
> akun distributor boleh mengajukan klaim atas unit yang terdaftar milik
> distributor lain. Sekarang boleh. Kalau harus ditolak, itu butir tersendiri.

> Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. Butuh J dan L.
> Baca `docs/business-context.md` bagian "Akses".
>
> Hari ini akses requester dibatasi **per alamat email**: `visibleClaims_`
> membandingkan `RequesterEmail` dengan alamat penandatangan. Kolom
> `users.Distributor` sudah ada di skema sejak butir J dan **tidak pernah
> dibaca oleh apa pun**. Itu bukan keadaan yang disengaja.
>
> Aturannya, dari pemilik repo 13 Sep 2026, dan dua sisinya berbeda:
>
> - **Requester atas nama distributor: satu akun per perusahaan distributor.**
>   Akunnya milik perusahaan, bukan milik orang; siapa pun di baliknya boleh
>   berganti dan riwayat klaimnya tetap di tempat.
> - **Requester dari perusahaan kita: satu akun per field service.** Orangnya
>   yang bertanggung jawab, jadi akunnya per orang seperti sekarang.
>
> Yang harus dikerjakan:
>
> 1. `users.Distributor` dibaca dan divalidasi: akun dengan `Distributor` terisi
>    adalah akun distributor, dan `DistributorID`-nya harus ada di master
>    `Distributors`. Layar Users memberinya dropdown, bukan kotak teks.
> 2. **Satu akun aktif per `DistributorID`.** Menyimpan akun kedua untuk
>    distributor yang sudah punya satu ditolak dengan menyebut akun mana yang
>    sudah ada — bukan diterima lalu membuat dua orang saling tidak melihat
>    klaim satu sama lain.
> 3. `visibleClaims_` untuk requester: kalau akunnya akun distributor, ia
>    melihat klaim yang **`Claims.DistributorID`-nya sama dengan miliknya**;
>    kalau bukan, tetap per alamat email seperti sekarang.
>
> **Hati-hati pada yang ini, karena bisa memperluas akses tanpa terlihat:**
> `Claims.DistributorID` datang dari **unitnya**, bukan dari akun yang mengajukan
> — jadi klaim atas unit yang terdaftar milik distributor lain akan tiba-tiba
> terlihat oleh distributor itu. Sudah diputuskan bahwa distributor tidak boleh
> melihat klaim requestor lain walau di rumah sakit yang sama; keputusan yang
> sama berlaku di sini. Aman: **`DistributorID` cocok DAN klaimnya diajukan oleh
> akun distributor** (bukan oleh field service kita atas unit yang sama).
> Pertimbangkan juga menolak submit ketika akun distributor mengklaim unit yang
> terdaftar milik distributor lain — tapi tanyakan dulu, itu keputusan bisnis.
>
> Penguji baru `tools/verify-distributor-access.js`: akun kedua untuk satu
> distributor ditolak, akun distributor melihat klaim perusahaannya dan **tidak**
> melihat klaim distributor lain di rumah sakit yang sama, field service kita
> tetap per orang, dan klaim atas unit distributor lain tidak bocor. Buktikan
> menangkap bugnya. Suite, `dist/`, commit, push.

---

## Yang sudah ditimbang dan tidak disarankan

Dashboard/grafik, notifikasi realtime, dan aplikasi mobile terpisah. Ketiganya
menambah permukaan aplikasi tanpa menjawab pertanyaan yang belum terjawab.
