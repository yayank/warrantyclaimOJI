# Backlog — siap dieksekusi

Tiap bagian di bawah adalah **satu prompt utuh**, satu sesi, satu commit. Salin
apa adanya. Koordinat kode di dalamnya sudah diverifikasi pada 12 September 2026
— itu yang membuat sesi baru tidak perlu menyelidiki ulang, dan itulah
penghematan token yang sebenarnya.

**Urutan yang disarankan:** A → B → C → D. E, F, G hanya kalau memang terasa
kurang.

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

## F · Aksi massal dari daftar klaim *(opsional)*

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

## G · Penanda "baru sejak terakhir dilihat" *(opsional)*

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

## Yang sudah ditimbang dan tidak disarankan

Dashboard/grafik, notifikasi realtime, dan aplikasi mobile terpisah. Ketiganya
menambah permukaan aplikasi tanpa menjawab pertanyaan yang belum terjawab.
