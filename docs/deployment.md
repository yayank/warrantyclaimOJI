# Pemasangan

Urutan ini penting: aplikasi tidak bisa dipakai sebelum langkah 6 selesai, karena identitas pengguna ditegakkan lewat Google Sign-In dan itu memerlukan OAuth Client ID.

## 1. Siapkan spreadsheet

Buat Google Spreadsheet baru, atau pakai berkas klaim Anda yang sudah ada. Salin ID-nya dari URL:

```
https://docs.google.com/spreadsheets/d/<ID-DI-SINI>/edit
```

## 2. Buat proyek Apps Script

Buka [script.google.com](https://script.google.com) → **New project**, lalu pilih salah satu cara.

**Cara ringkas — dua berkas, tanpa memasang apa pun.** Ini yang dipakai kalau komputer Anda tidak mengizinkan instalasi.

| Salin dari | Jadikan |
|---|---|
| `dist/Code.gs` | berkas *Script* bernama **Code.gs** |
| `dist/main.html` | berkas *HTML* bernama **main** |
| `dist/appsscript.json` | manifest, lewat **Project Settings → Show "appsscript.json"** |

Dua hal yang mudah keliru:

- **Pakai berkas `Code.gs` yang sudah ada**, ganti isinya. Membuat berkas baru bernama sama menghasilkan `Code1.gs`, dan dua berkas dengan fungsi kembar akan gagal dimuat.
- **Nama berkas HTML harus persis `main`**, diketik tanpa `.html`. `doGet` memanggil `createTemplateFromFile('main')`.

Berkas dapat diambil langsung dari GitHub tanpa `git`: buka berkasnya, klik **Raw**, lalu salin seluruh isinya.

**Cara modular — 16 berkas.** Salin seluruh isi `src/`: berkas `.gs` sebagai *Script*, `index.html`/`Styles.html`/`Script.html` sebagai *HTML*, dan `appsscript.json` sebagai manifest. Kalau [clasp](https://github.com/google/clasp) bisa dipasang, cukup `clasp push` dari folder `src/`.

Apa pun caranya, lanjutkan dengan **Project Settings → Script Properties** → tambahkan `SPREADSHEET_ID` berisi ID dari langkah 1.

> Yang disunting selalu `src/`. Setelah berubah, jalankan `node tools/bundle.js` untuk membangun ulang `dist/` — jangan menyunting `dist/` langsung, isinya akan tertimpa.

## 3. Aktifkan layanan Drive

Di panel kiri editor, cari **Services** → klik **+** → pilih **Drive API**, versi **v2** → **Add**. Identifier-nya harus tetap `Drive`.

Manifest sudah menyebut layanan ini, tetapi menambahkannya lewat menu memastikan API-nya benar-benar aktif di proyek Cloud yang menaungi skrip.

Dipakai oleh fitur impor data unit dari Excel. Kalau langkah ini dilewati, seluruh aplikasi tetap berjalan — hanya tombol **Import from Excel** di Master Data → Units yang akan gagal.

## 4. Jalankan `setUp()`

Di editor Apps Script, pilih fungsi `setUp` dari dropdown di atas, lalu **Run**.

Google meminta izin, dan layarnya terlihat mengkhawatirkan: *"Google hasn't verified this app"*. Klik **Advanced → Go to … (unsafe) → Allow**. Peringatan itu normal untuk skrip yang Anda tulis sendiri; yang diizinkan adalah skrip Anda mengakses spreadsheet dan Drive Anda sendiri.

Fungsi ini membuat empat belas sheet beserta baris judulnya, menyiapkan folder Drive `Klaim/`, memberi ID pada setiap customer, sparepart, dan principal, menambahkan entri customer `Internal — Production`, serta membuat satu principal bernama `Sansin` untuk menampung data yang sudah ada. Aman dijalankan berulang kali.

## 5. Daftarkan diri Anda

Buka sheet `users`, tambahkan satu baris:

| Email | Name | Role | Principal | Active |
|---|---|---|---|---|
| email Anda | nama Anda | `Administrator` | *(kosong)* | `TRUE` |

Tanpa baris ini tidak ada seorang pun yang bisa masuk — termasuk pemilik skripnya.

Kolom `Principal` hanya wajib untuk akun berperan `Principal`; untuk peran lain biarkan kosong.

## 6. Buat OAuth Client ID

1. Buka **Project Settings** di editor Apps Script, catat **Google Cloud Platform Project number**
2. Buka [console.cloud.google.com](https://console.cloud.google.com) pada proyek tersebut
3. **APIs & Services → OAuth consent screen** → isi nama aplikasi dan email dukungan
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://script.google.com`
5. Salin **Client ID** ke sheet `Settings`, baris `GoogleClientId`

Ini yang membuat login otomatis berfungsi untuk email domain apa pun, termasuk Principal di luar organisasi Anda, tanpa perlu membagikan spreadsheet kepada siapa pun.

## 7. Deploy

**Deploy → New deployment → Web app**

| Pengaturan | Nilai |
|---|---|
| Execute as | **Me** |
| Who has access | **Anyone** |

Kedua pilihan itu disengaja. *Execute as: Me* membuat data tetap milik Anda; *Anyone* diperlukan karena identitas ditegakkan oleh token Google Sign-In, bukan oleh Apps Script — setiap panggilan tetap diverifikasi di server dan email yang tidak terdaftar di sheet `users` selalu ditolak.

Salin URL hasil deploy ke sheet `Settings`, baris `AppUrl`. URL ini dipakai untuk tautan pintas di dalam email.

## 8. Pasang pemicu terjadwal

Jalankan `installTriggers()` sekali dari editor. Hasilnya:

| Pemicu | Waktu | Tugas |
|---|---|---|
| `sendDailyDigest` | 17:00 WIB | rekap klaim harian ke Principal |
| `dailyMaintenance` | 01:00 WIB | hapus berkas ekspor >7 hari, salin cadangan spreadsheet |

Jam rekap bisa diubah lewat `Settings!DigestHour`, lalu jalankan `installTriggers()` lagi.

## 9. Migrasi data lama (opsional)

Kalau spreadsheet Anda masih memuat sheet `Log` yang lama, jalankan `migrateLegacyLog()` sekali. Fungsi ini memecah 20 baris lama menjadi `Claims` dan `ClaimItems`, memberi ClaimID dan ItemID baru, mempertahankan No Ref lama, dan menandai baris uji (`qwerty` dan sejenisnya) sebagai `IsTest`.

Nama sparepart yang tidak ada padanannya di master tetap disimpan apa adanya tanpa `PartID` — riwayat mencatat apa yang benar-benar diklaim, bukan apa yang ada di master hari ini. Fungsi ini menolak berjalan kalau `Claims` sudah berisi data.

## 10. Siapkan pemetaan principal

Aplikasi melayani lebih dari satu principal, dan pemetaannya menentukan siapa boleh melihat apa.

1. **Sheet `Principals`** — daftar nama principal yang diterima sistem. `setUp()` sudah membuat `Sansin`; tambahkan yang lain lewat layar **Master Data → Principals**.
2. **Sheet `Population`, kolom `Principal`** — isi nama principal untuk setiap unit. Nilainya harus persis sama dengan nama di sheet `Principals`.
3. **Sheet `users`, kolom `Principal`** — untuk tiap akun berperan `Principal`, isi principal yang menjadi haknya.

Layar **Master Data → Units** menampilkan peringatan bila ada unit tanpa principal, atau nama principal yang tidak dikenal master. Selama sebuah unit belum terpetakan, klaim atasnya **tidak bisa diteruskan** dan tidak terlihat oleh principal mana pun — ini disengaja, karena menebak berarti berisiko mengirim data satu principal ke principal lain.

## 11. Isi data pendukung

- **`Recipients`** — penerima pesanan di sisi principal, yang tidak punya akses aplikasi. Tanpa ini tombol *Forward Order* tidak bisa dipakai. Kolom `Principal` opsional, untuk memudahkan memilih penerima yang tepat.
- **`users`** — tambahkan Requester, Production, dan Principal.
- **Tester** — beri satu email peran `Tester` kalau ingin menguji alur tanpa menyentuh data asli. Hapus barisnya untuk mematikan peran itu; tidak perlu deploy ulang.

## Menguji tanpa merusak data

Masuk sebagai `Tester`, lalu pakai pemilih peran di spanduk kuning. Yang terjadi:

- klaim yang Anda buat memakai seri `TEST-` dan `CWT`, tersimpan di `Klaim/_UJI/`
- tombol aksi mati pada klaim sungguhan
- semua email dibelokkan ke alamat Anda dengan subjek berawalan `[TEST]` — menekan *Forward to Principal* tidak akan pernah sampai ke principal
- tombol **Purge Test Claims** menghapus seluruh jejak uji, termasuk foldernya

## Memeriksa logika sebelum deploy

Tiga penguji dan satu bundler berjalan di Node tanpa perlu Google:

```bash
node tools/verify-warranty.js units.json    # mesin garansi, diuji ke 2.610 unit asli
node tools/verify-access.js                 # pemisahan data antar principal
node tools/verify-templates.js              # perender template email
node tools/bundle.js                        # membangun ulang dist/
```

`units.json` berisi `[{ sn, expired }]` dari sheet `warranty`.

## Kalau ada yang tidak beres

| Gejala | Penyebab |
|---|---|
| Halaman berhenti di layar masuk | `GoogleClientId` belum diisi, atau origin `https://script.google.com` belum didaftarkan |
| `Drive is not defined` saat impor unit | Layanan Drive API belum ditambahkan lewat **Services** (langkah 3) |
| `Sheet not found` pada tiap aksi | `setUp()` belum dijalankan, atau `SPREADSHEET_ID` menunjuk berkas yang keliru |
| "not registered for this portal" | email belum ada di sheet `users`, atau `Active` bukan `TRUE` |
| Tombol *Forward Order* menolak | sheet `Recipients` kosong atau semuanya tidak aktif |
| Email tidak terkirim | kuota `MailApp` habis — 100/hari untuk akun gmail biasa, 1.500/hari untuk Workspace. Cek kolom `Status` dan `Error` di sheet `EmailLog` |
| Rekap sore tidak jalan | `installTriggers()` belum dijalankan, atau klaim belum berstatus `In Review` |
| Rekap terkirim tapi principal tidak menerima | Tidak ada akun `users` berperan `Principal` dengan kolom `Principal` yang cocok. Hasil `sendDigestNow_` melaporkannya sebagai *skipped* |
| Klaim tidak bisa diteruskan | Unitnya belum punya principal. Isi kolom `Principal` di `Population`, atau pakai tombol *Assign principal* di panel klaim |
| Akun Principal ditolak saat masuk | Kolom `Principal` di sheet `users` kosong, atau namanya tidak ada di sheet `Principals` |
| Unggahan gagal untuk berkas besar | batas 10 MB per berkas sebelum dikompres; foto dikecilkan otomatis di browser, PDF tidak |
