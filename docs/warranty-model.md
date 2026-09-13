# Rancangan model garansi

Status: **disetujui, belum dikerjakan.** Ditulis 12 September 2026, diperiksa
dan diputuskan pemilik repo pada hari yang sama. Pemecahannya jadi prompt ada
di `docs/backlog.md` butir H sampai N.

Dasar faktanya ada di `docs/business-context.md`. Berkas ini menjawab satu
pertanyaan lanjutan: **bentuk data seperti apa yang bisa menjawab "apakah unit
ini masih bergaransi" dengan benar**, untuk dua sisi sekaligus, tanpa
membongkar portal yang sudah jalan.

---

## 1. Yang salah hari ini

Bukan tebakan — ini dibaca dari `src/Warranty.gs` dan `src/Config.gs`:

| Kenyataan bisnis | Yang dilakukan kode sekarang |
|---|---|
| Tiap model punya masa garansi sendiri | `XT_WARRANTY_MONTHS = 22`, satu angka untuk semuanya |
| Empat dasar hitung berbeda | hanya bulan perakitan dari serial |
| Dua tingkat garansi | satu kolom `WarrantyType`, hanya sisi principal |
| Multi-principal, kebijakan berbeda | tidak ada tempat menyimpan kebijakan siapa pun |
| Extended warranty per unit | tidak ada |
| Dijual lewat distributor atau langsung | tidak dicatat |

Akibat yang paling mahal: portal **tidak bisa membedakan** unit yang garansi
principal-nya sudah habis tapi garansi kita ke pembeli masih jalan — kotak biaya
yang kita serap. Hari ini kotak itu tampil sama saja dengan "sudah habis, jual
sparepart biasa".

Dan yang lebih berbahaya daripada tidak tahu: `determineWarranty_` menjawab
`22 bulan` **dengan percaya diri** untuk setiap serial berawalan XT, termasuk
model yang garansinya 12 atau 36 bulan. Salah yang diam lebih baik daripada
salah yang meyakinkan.

## 2. Prinsip rancangan

1. **Aturan jadi data, bukan kode.** Satu sheet aturan yang bisa disunting
   Administrator. Menambah model tidak boleh butuh deploy.
2. **Hitung sekali, simpan di unitnya** — persis disiplin kolom ringkasan di
   `Claims`: selalu **dihitung ulang dari sumbernya, tidak pernah
   ditambah/dikurangi**, ditulis dengan `setCells_` sehingga tidak menaikkan
   `RowVersion`. Alasannya sama: daftar klaim tidak boleh membayar biaya baca
   untuk menghitung garansi 400 kali.
3. **Simpan tanggal, jangan simpan status.** "Masih bergaransi" berubah sendiri
   besok pagi. Yang disimpan `WarrantyEnd`; verdict dihitung saat dibaca.
4. **Aditif.** Tidak ada kolom lama yang berubah arti, tidak ada fungsi lama
   yang hilang. `WarrantyType` **tetap** berarti sisi principal — ia yang
   mengunci `forwardOrder_`, `visibleClaims_`, `verify-tabs`, dan
   `verify-fulfilment`. Sisi customer datang sebagai kolom baru.
5. **Klaim memotret, tidak menunjuk.** Verdict garansi disalin ke baris klaim
   saat submit. Perbaikan data unit bulan depan tidak boleh menulis ulang
   sejarah klaim yang sudah diputus.
6. **Tidak tahu itu jawaban yang sah.** Kalau aturannya tidak ada atau tanggal
   dasarnya kosong, jawabannya `Manual Verification Required` **beserta alasan
   apa yang kurang** — bukan angka hasil menebak.

## 3. Sheet baru

### `Products` — daftar model

| Kolom | Isi |
|---|---|
| `Material` | kunci. Sudah ada di `Population` dan `warranty` |
| `Name` | nama model |
| `Principal` | pemilik aturannya |
| `Regulation` | `AKD` / `AKL` |
| `SerialPattern` | regex, kosong berarti serial tidak dipakai sebagai dasar |
| `Active`, `Notes` | |

20–100 baris. Diisi sekali dari `Population` yang sudah ada (unik per
`Material` + `ItemDescription`), lalu dirawat manual.

### `WarrantyRules` — aturannya

| Kolom | Isi |
|---|---|
| `RuleID` | |
| `Material` | model yang diatur |
| `Scope` | `principal` atau `customer` — **satu baris satu sisi** |
| `Channel` | `direct`, `distributor`, atau `*` untuk keduanya |
| `Basis` | `assembly` / `selling-in` / `received` / `installation` |
| `Months` | masa garansinya |
| `EffectiveFrom`, `EffectiveTo` | dicocokkan ke **tanggal dasar unitnya**, bukan ke hari ini |
| `Active`, `Notes` | |

`EffectiveFrom` dicocokkan ke tanggal dasar unit dengan sengaja: kebijakan yang
berubah tahun ini tidak boleh memundurkan garansi unit yang dijual tiga tahun
lalu.

Pemilihan baris, kalau lebih dari satu cocok: `Channel` yang spesifik
mengalahkan `*`; kalau masih seri, `EffectiveFrom` paling akhir menang. Tidak
ada yang cocok berarti `Manual Verification Required`.

Perkiraan ukuran: 100 model x 2 sisi x rata-rata 1,5 varian channel = sekitar
300 baris. Muat di memori, di-cache seperti `warrantyIndex_`.

### `Distributors` — akun distributor

`DistributorID`, `Name`, `Email`, `Active`, `Notes`. Sheet `users` dapat kolom
`Distributor` supaya akun bisa dipetakan ke perusahaannya. 10–50 baris.

### `UnitRequests` — permintaan pendaftaran unit

Ini yang menjaga agar keputusan "unit tak terdaftar ditolak" tidak membuang
pekerjaan lapangan.

`RequestID`, `SerialNumber`, `ProductGuess`, `CustomerID`, `DistributorID`,
`Note`, `DriveFolderId`, `ClaimID` (draft yang menunggu), `Status`
(`Open` / `Registered` / `Rejected`), `RequestedBy`, `RequestedAt`,
`HandledBy`, `HandledAt`.

Alurnya: submit ditolak, klaim tersimpan sebagai `Draft`, satu baris masuk ke
sini, Administrator melihatnya sebagai antrean. Begitu unitnya didaftarkan,
draftnya bisa diteruskan tanpa mengetik ulang apa pun.

## 4. Kolom tambahan di `Population`

`Population` sudah punya `Delivery`, `SellingInDate`, `Material`,
`ItemDescription`, `Batch` (serial), `DeliveryQuantity`, `ShipToParty`,
`Principal`.

**Diisi manusia atau impor:**

| Kolom | Isi |
|---|---|
| `Channel` | `direct` / `distributor` |
| `DistributorID` | wajib kalau `Channel = distributor` |
| `CustomerID` | rumah sakit tempat alat berdiri |
| `ReceivedAtDistributor` | tanggal, teks ISO |
| `InstalledAt` | tanggal BAST / BA uji fungsi |
| `ExtendedMonthsPrincipal`, `ExtendedMonthsCustomer` | angka, boleh 0 |
| `ContractRef`, `WarrantyNote` | nomor kontrak/tender dan catatan bebas |

**Dihitung dan ditulis balik oleh `recomputeUnitWarranty_`** — jangan disunting
tangan, akan ditimpa:

`AssemblyMonth`, `WarrantyStartPrincipal`, `WarrantyEndPrincipal`,
`WarrantyBasisPrincipal`, `WarrantyStartCustomer`, `WarrantyEndCustomer`,
`WarrantyBasisCustomer`, `WarrantyComputedAt`.

`WarrantyBasis*` adalah kalimat penjelas seperti yang sekarang sudah dihasilkan
`determineWarranty_` — "dipasang 3 Mar 2025 + 24 bulan + 6 bulan extended =
berlaku sampai 3 Sep 2027". Yang ditanya orang bukan tanggalnya, tapi kenapa.

Kolom terhitung ditulis dengan `setCells_`, jadi tidak menaikkan `RowVersion`
dan tidak membuat unit tampak "baru" di penanda kunjungan.

### Extended warranty memundurkan dua sisi

`ExtendedMonthsPrincipal` dan `ExtendedMonthsCustomer` dipisah karena keduanya
bisa berbeda: paket pembelian menambah 12 bulan ke pembeli, sementara yang
berhasil dinegosiasikan ke principal cuma 6.

### Kontrak: per unit dulu, sheet kontrak belakangan

**Diputuskan: per unit + impor massal.** Tidak ada sheet kontrak sekarang. Simpan penimpaan sebagai
`ExtendedMonths*` + `ContractRef` per unit, dan sediakan impor massal.

Alasannya: satu tender 40 unit memang berarti 40 baris disunting, tapi impor
massal menyelesaikan itu dalam satu tempel. Sheet kontrak menambah satu lapis
pencarian pada setiap perhitungan, dan menambah satu keadaan yang bisa
bertentangan (unit bilang A, kontrak bilang B). Kalau perawatannya nanti
terasa berat, sheet kontrak bisa ditambahkan tanpa mengubah apa pun yang di
atas — nilainya tetap mendarat di kolom unit yang sama.

## 5. Kolom tambahan di `Claims`

Semuanya aditif, ditulis saat submit sebagai potret:

| Kolom | Isi |
|---|---|
| `DistributorID`, `DistributorName` | dari unitnya. Klaim jalur distributor menyebut distributor **dan** rumah sakit |
| `CustomerWarrantyType` | verdict sisi kita ke pembeli |
| `CustomerWarrantyExpiry`, `CustomerWarrantyBasis` | |
| `CostBorne` | `TRUE` kalau pembeli masih bergaransi tapi principal sudah habis |
| `WarrantySnapshotAt` | kapan potret ini diambil |

`CostBorne` disimpan, tidak dihitung ulang saat membaca, dengan alasan yang
sama seperti kolom ringkasan: itulah yang membuat laporan "biaya yang kita
serap" bisa dijawab tanpa membaca `Population` untuk tiap baris.

`WarrantyType`, `WarrantyExpiry`, `WarrantyBasis` tidak berubah artinya. Yang
berubah hanya labelnya di layar: "Principal warranty".

## 6. Mesinnya

Satu berkas baru, `src/WarrantyRules.gs`:

- `productsIndex_()`, `rulesIndex_()` — di-cache seperti `warrantyIndex_`,
  memo per eksekusi di `INDEX_MEMO`.
- `basisDate_(unit, basis)` — mengambil tanggal yang diminta aturan, atau
  kosong bila tidak ada.
- `pickRule_(material, scope, channel, basisDate)` — pemilihan di bagian 3.
- `resolveWarranty_(unit, scope, today)` -> `{type, start, expiry, basis,
  months, source, missing}`. `missing` berisi apa yang kurang saat jawabannya
  manual, supaya layar bisa bilang "belum ada tanggal BAST", bukan sekadar
  "perlu dicek".
- `recomputeUnitWarranty_(serials)` — menulis kolom terhitung.

`determineWarranty_(serial)` di `Warranty.gs` **tetap ada dan tetap dipanggil
dari tempat yang sama**. Isinya berubah jadi: baca kolom terhitung unitnya;
kalau kosong, jatuh kembali ke rumus serial yang sekarang. Dengan begitu
seluruh penguji yang ada hari ini tetap hijau tanpa disentuh, dan unit XT yang
belum diberi aturan tetap dijawab seperti sekarang.

Urutan presedensi, dari yang menang:

1. Penimpaan manual per klaim (`WarrantyOverridden` — sudah ada, tidak berubah)
2. `ExtendedMonths*` pada unitnya
3. Baris `WarrantyRules` yang terpilih
4. Rumus serial lama (hanya XT), sebagai jaring pengaman
5. `Manual Verification Required` + daftar apa yang kurang

## 7. Apa yang berubah di layar

- **Form klaim** menampilkan dua baris garansi, bukan satu, dengan
  penjelasannya masing-masing. Yang tidak bergaransi di dua sisi diberi
  peringatan sebelum submit, bukan sesudah.
- **Unit tak terdaftar** ditolak dengan tombol "simpan draft dan minta
  pendaftaran", bukan jalan buntu.
- **Daftar klaim** dapat filter `CostBorne` dan kolom garansi customer.
- **Layar Administrator** dapat antrean `UnitRequests`.
- **Principal** melihat kolom principal saja. Tanggal garansi kita ke pembeli
  dan penanda `CostBorne` **tidak boleh sampai ke payload-nya sama sekali** —
  bukan sekadar disembunyikan CSS. Diputuskan 12 Sep 2026.
- **Layar unit** untuk Administrator: cari, sunting per unit, daftarkan unit
  baru, impor massal. Tervalidasi dan tercatat di `AuditLog`.
- **Layar "unit belum lengkap"**: unit beserta apa yang kurang, bisa disaring
  per distributor dan per model. Ini yang membuat pengisian data punya ujung.
- **Layar aturan garansi** untuk menyunting `WarrantyRules` dari portal, dengan
  validasi dan jejak audit. Menyunting langsung di Sheets ditolak: satu salah
  ketik bisa mengubah jawaban garansi ratusan unit tanpa jejak siapa pun.

## 8. Migrasi

`Setup.gs` dapat `backfillUnitWarranty()`, sepola dengan
`backfillClaimSummaries_`: menulis satu kolom penuh sekali jalan, bukan satu
sel per baris, dan baris tanpa data cukup dibiarkan.

Urutan yang aman:

1. Buat sheet dan kolom baru, semuanya kosong. Portal tetap jalan; semua unit
   jatuh ke jaring pengaman rumus lama.
2. Isi `Products` dari `Population`.
3. Isi `WarrantyRules` untuk model yang aturannya sudah pasti. Model yang
   belum diisi tetap memakai jaring pengaman.
4. Impor `Channel`, `DistributorID`, `InstalledAt` dan kawan-kawan.
5. `backfillUnitWarranty()`.

Tidak ada langkah yang wajib selesai sebelum langkah berikutnya berguna.

## 9. Biaya baca

`listClaims_` **tidak bertambah mahal**: kolom garansi customer ada di baris
klaim, bukan di `Population`. Yang bertambah hanya lebar baris `Claims`
(5 kolom, sekitar +3% sel).

`populationIndex_` bertambah besar karena ikut membawa kolom garansi.
Perkiraan kasar: 2.610 unit x ~250 byte = sekitar 650KB, jauh di atas batas
100KB satu entri `CacheService` — jadi wajib lewat `cachePutLarge_`, yang
memang sudah dipakai. Perlu diukur ulang dengan `tools/measure-list.js` setelah
kolomnya ada.

## 10. Yang sengaja tidak ada di sini

- Garansi distributor ke rumah sakit. Dua tingkat, bukan tiga.
- Nilai rupiah sparepart dan laporan biaya. Butuh `CostBorne` lebih dulu, jadi
  ini tahap berikutnya, bukan tahap ini.
- Telusur serial part rusak ke serial part pengganti.
- SLA, downtime, laporan teknisi, pelaporan vigilance.

## 11. Keputusan pemilik repo, 12 September 2026

Semua ditanyakan dan dijawab sebelum satu baris kode ditulis.

| Pertanyaan | Keputusan |
|---|---|
| Kunci aturan garansi | **Satu model = satu `Material`.** `WarrantyRules` dikunci ke `Material`, tanpa lapis pemetaan |
| Unit tanpa tanggal BAST | **`Manual` + sebutkan apa yang kurang.** Tidak pernah mundur diam-diam ke tanggal lain |
| Principal melihat sisi customer | **Tidak, sama sekali.** Termasuk `CostBorne` |
| Format tanggal impor | **`dd/mm/yyyy`.** Hari dulu, baru bulan |
| Penimpaan kontrak | **Per unit + impor massal.** Tidak ada sheet kontrak |
| Permintaan pendaftaran unit | **Email ke Administrator + antrean di layar** |
| Menyunting `WarrantyRules` | **Lewat layar portal, tercatat di `AuditLog`** |
| Merawat data unit | **Layar unit di portal + impor berkas** |
| Unit yang datanya kurang | **Ada layarnya**, bisa disaring per distributor dan per model |
| Menerjemahkan antarmuka | **Tidak perlu.** Antarmuka tetap Bahasa Inggris |

### Kenapa `dd/mm/yyyy` perlu ditulis di sini

`03/09/2025` adalah 3 September bagi pembaca Indonesia dan 9 Maret bagi
`new Date()` di Apps Script. Setengah tahun selisihnya, dan salahnya diam.
Impor **wajib** lewat satu fungsi `parseLocalDate_` yang membaca hari dulu dan
**menolak** apa yang tidak berbentuk `dd/mm/yyyy` — bukan menebak, bukan
menyerahkannya ke `new Date()`.
