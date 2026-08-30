# Pemasangan

Sepuluh langkah pertama sudah membuat portal berjalan penuh untuk seluruh tim di organisasi Anda. Langkah 11 hanya diperlukan bila Principal di luar organisasi ikut memakainya.

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

## 3. Pastikan layanan Drive terbaca

Tidak ada yang perlu ditambahkan. `appsscript.json` sudah mendeklarasikan layanan Drive; setelah manifest tersimpan, `Drive` muncul dengan sendirinya di panel **Services** di kiri.

> **Jangan menambahkannya lagi lewat Services → +.** Panel Services hanyalah tampilan dari isi `appsscript.json`, bukan tempat penyimpanan terpisah. Menambah dari menu berarti menulis entri kedua ke manifest yang sama, dan editor menolaknya dengan:
>
> ```
> "appsscript.json" has errors: Found a service identifier used more than once: Drive
> ```
>
> Kalau ini terlanjur terjadi, buka `appsscript.json` dan hapus salah satu blok `Drive` sehingga tersisa satu.

Layanan ini dipakai oleh fitur impor data unit dari Excel.

## 4. Jalankan `setUp()`

Di panel **Files**, klik **`Code.gs`** lebih dulu. Tombol **▷ Run** dan pemilih fungsi hanya muncul saat berkas `.gs` yang sedang aktif — selama `main.html` atau `appsscript.json` yang terbuka, toolbar hanya menampilkan ikon simpan dan *Execution log*, dan tidak ada yang bisa dijalankan.

Setelah `Code.gs` terbuka, pilih **`setUp`** dari dropdown fungsi di toolbar, lalu klik **▷ Run**.

Daftar fungsinya panjang. Dua tetangganya sengaja jangan dijalankan sekarang: `installTriggers` menyusul setelah deploy (langkah 8), dan `migrateLegacyLog` hanya bila Anda punya sheet `Log` lama (langkah 9).

Google meminta izin, dan layarnya terlihat mengkhawatirkan: *"Google hasn't verified this app"*. Klik **Advanced → Go to … (unsafe) → Allow**. Peringatan itu normal untuk skrip yang Anda tulis sendiri; yang diizinkan adalah skrip Anda mengakses spreadsheet dan Drive Anda sendiri.

Fungsi ini membuat empat belas sheet beserta baris judulnya, menyiapkan folder Drive `Klaim/`, memberi ID pada setiap customer, sparepart, dan principal, menambahkan entri customer `Internal — Production`, serta membuat satu principal bernama `Sansin` untuk menampung data yang sudah ada. Aman dijalankan berulang kali.

## 5. Daftarkan diri Anda

Buka sheet `users`, tambahkan satu baris:

| Email | Name | Role | Principal | Active |
|---|---|---|---|---|
| email Anda | nama Anda | `Administrator` | *(kosong)* | `TRUE` |

Tanpa baris ini tidak ada seorang pun yang bisa masuk — termasuk pemilik skripnya.

Kolom `Principal` hanya wajib untuk akun berperan `Principal`; untuk peran lain biarkan kosong.

## 6. Deploy

**Deploy → New deployment → Web app**

| Pengaturan | Nilai |
|---|---|
| Execute as | **Me** |
| Who has access | **Anyone with Google account** |

Kedua pilihan itu disengaja. *Execute as: Me* membuat data tetap milik Anda — tidak ada seorang pun yang perlu diberi akses ke spreadsheet. *Anyone with Google account* memastikan Apps Script mengetahui siapa yang membuka; tanpa akun Google, tidak ada identitas untuk diperiksa.

Peran tidak pernah diambil dari browser: server membacanya sendiri dari sheet `users`, dan alamat yang tidak terdaftar di sana selalu ditolak.

Salin URL hasil deploy ke sheet `Settings`, baris `AppUrl`. URL ini dipakai untuk tautan pintas di dalam email.

## 7. Pasang pemicu terjadwal

Jalankan `installTriggers()` sekali dari editor. Hasilnya:

| Pemicu | Waktu | Tugas |
|---|---|---|
| `sendDailyDigest` | 17:00 WIB | rekap klaim harian ke Principal |
| `dailyMaintenance` | 01:00 WIB | hapus berkas ekspor >7 hari, salin cadangan spreadsheet |

Jam rekap bisa diubah lewat `Settings!DigestHour`, lalu jalankan `installTriggers()` lagi.

## 8. Migrasi data lama (opsional)

Kalau spreadsheet Anda masih memuat sheet `Log` yang lama, jalankan `migrateLegacyLog()` sekali. Fungsi ini memecah 20 baris lama menjadi `Claims` dan `ClaimItems`, memberi ClaimID dan ItemID baru, mempertahankan No Ref lama, dan menandai baris uji (`qwerty` dan sejenisnya) sebagai `IsTest`.

Nama sparepart yang tidak ada padanannya di master tetap disimpan apa adanya tanpa `PartID` — riwayat mencatat apa yang benar-benar diklaim, bukan apa yang ada di master hari ini. Fungsi ini menolak berjalan kalau `Claims` sudah berisi data.

## 9. Siapkan pemetaan principal

Aplikasi melayani lebih dari satu principal, dan pemetaannya menentukan siapa boleh melihat apa.

1. **Sheet `Principals`** — daftar nama principal yang diterima sistem. `setUp()` sudah membuat `Sansin`; tambahkan yang lain lewat layar **Master Data → Principals**.
2. **Sheet `Population`, kolom `Principal`** — isi nama principal untuk setiap unit. Nilainya harus persis sama dengan nama di sheet `Principals`.
3. **Sheet `users`, kolom `Principal`** — untuk tiap akun berperan `Principal`, isi principal yang menjadi haknya.

Layar **Master Data → Units** menampilkan peringatan bila ada unit tanpa principal, atau nama principal yang tidak dikenal master. Selama sebuah unit belum terpetakan, klaim atasnya **tidak bisa diteruskan** dan tidak terlihat oleh principal mana pun — ini disengaja, karena menebak berarti berisiko mengirim data satu principal ke principal lain.

## 10. Isi data pendukung

- **`Recipients`** — penerima pesanan di sisi principal, yang tidak punya akses aplikasi. Tanpa ini tombol *Forward Order* tidak bisa dipakai. Kolom `Principal` opsional, untuk memudahkan memilih penerima yang tepat.
- **`users`** — tambahkan Requester, Production, dan Principal.
- **Tester** — beri satu email peran `Tester` kalau ingin menguji alur tanpa menyentuh data asli. Hapus barisnya untuk mematikan peran itu; tidak perlu deploy ulang.

## 11. Login untuk akun di luar organisasi — opsional

**Lewati langkah ini kalau semua pengguna memakai akun organisasi Anda.** Portal sudah berjalan tanpa pengaturan apa pun: Apps Script sendiri yang memberi tahu siapa yang sedang membuka, dan perannya diambil dari sheet `users`.

Yang tidak bisa dilakukan cara bawaan itu: mengenali akun **di luar domain Workspace Anda**. Google menyembunyikan alamatnya, dan portal menolak dengan pesan yang menjelaskan hal ini. Jadi kerjakan langkah ini hanya ketika Principal — yang memakai `gmail.com` atau domain perusahaannya sendiri — sudah benar-benar perlu masuk.

Setelah `Settings!GoogleClientId` terisi, portal berpindah sendiri ke cara login ini. Tidak ada kode yang berubah, dan tidak perlu deploy ulang — cukup jalankan `clearCache()`.

Seluruh langkah ini **gratis**. Membuat OAuth Client ID tidak memerlukan akun penagihan, dan aplikasi ini tidak memakai satu pun layanan Google Cloud yang berbayar — Cloud Console hanya dipakai sebagai tempat menerbitkan Client ID.

> **Jangan menyentuh tombol *Change project*** di Project Settings editor Apps Script. Skrip sudah punya proyek Cloud sendiri, dan menggantinya dapat mencabut izin yang sudah Anda berikan. Client ID tidak harus berasal dari proyek yang sama dengan skripnya: server hanya mencocokkan nilainya dengan sheet `Settings`, tidak peduli dari proyek mana ia diterbitkan.

**1. Buat proyek baru.** Di [console.cloud.google.com](https://console.cloud.google.com), klik pemilih proyek di bar atas → **New Project** → beri nama, misalnya `Warranty Portal` → **Create**.

**2. Siapkan halaman persetujuan.** Menu kiri **APIs & Services → OAuth consent screen**. Halaman yang terbuka bernama **Google Auth Platform** — Google mengganti tampilannya, dan isinya kini terbagi dalam tab *Branding*, *Audience*, *Clients*, dan *Data Access*. Klik **Get started**, lalu isi:

| Isian | Nilai |
|---|---|
| App name | `Warranty Claim Portal` |
| User support email | email Anda |
| Audience | **External** |
| Contact information | email Anda |

**3. Buat client.** Tab **Clients** → **Create client**:

| Isian | Nilai |
|---|---|
| Application type | **Web application** |
| Name | bebas |
| Authorized JavaScript origins | `https://script.google.com` — tanpa path, tanpa garis miring di akhir |

**4. Salin Client ID** dari jendela yang muncul — yang berakhiran `.apps.googleusercontent.com`, bukan *Client secret* — ke sheet `Settings`, baris `GoogleClientId`.

**5. Tentukan siapa yang boleh masuk.** Tab **Audience**: tambahkan email di *Test users*, atau tekan **Publish app**. Lihat catatan di bawah.

Bentuknya selalu seperti ini — angka, tanda hubung, huruf, lalu akhiran tetap:

```
407408718192-a1b2c3d4e5f6g7h8i9j0klmnop.apps.googleusercontent.com
```

Yang **bukan** Client ID dan sering tersalin keliru: **Client secret** (diawali `GOCSPX-`) dan **project number** (angka saja). Keduanya menghasilkan `Error 401: invalid_client` di halaman Google.

> **Nilai Settings di-cache lima menit.** Setelah memperbaiki sel ini, jalankan `clearCache()` dari editor supaya perubahannya langsung terpakai. Fungsi itu juga melaporkan nilai yang sedang terbaca dan apakah bentuknya sah.

Ini yang membuat login otomatis berfungsi untuk email domain apa pun, termasuk Principal di luar organisasi Anda, tanpa perlu membagikan spreadsheet kepada siapa pun.

> **Cek sebelum lanjut.** Buka spreadsheet Anda — harus bertambah 14 sheet baru. Kalau tidak muncul di sana, `SPREADSHEET_ID` menunjuk berkas lain dan sheet-nya terbentuk di tempat yang keliru.

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
| *"Google did not identify you to this portal"* | Akun di luar domain organisasi. Kerjakan langkah 11, atau pakai akun organisasi |
| Principal ditolak Google padahal Administrator bisa masuk | Audience bertipe **Internal**. Ubah ke **External** (langkah 11) |
| Diminta memasukkan GCP Project number | Tidak perlu, dan langkah 11 sendiri opsional. Jangan tekan *Change project* |
| Akun tertentu ditolak Google sebelum sampai ke portal | Publishing status masih **Testing** dan email itu belum ada di daftar *Test users* |
| `Error 401: invalid_client` di halaman Google | `Settings!GoogleClientId` bukan Client ID yang sah. Jalankan `clearCache()` — ia menampilkan nilai yang sedang terbaca |
| Sudah diperbaiki tapi error yang sama muncul lagi | Cache Settings bertahan lima menit. Jalankan `clearCache()` |
| Halaman berhenti di layar masuk | `GoogleClientId` belum diisi, atau origin `https://script.google.com` belum didaftarkan |
| `Found a service identifier used more than once: Drive` | Layanan Drive tercatat dua kali di `appsscript.json` — hapus salah satu bloknya (langkah 3) |
| `Drive is not defined` saat impor unit | `appsscript.json` belum tersimpan dengan blok `enabledAdvancedServices` |
| Tidak ada tombol **Run** di toolbar | Berkas HTML atau manifest yang sedang aktif. Klik `Code.gs` di panel Files |
| Halaman berjudul *"Setup is not finished"* | `setUp()` belum dijalankan. Halaman itu menyebutkan sheet apa yang kurang dan spreadsheet mana yang sedang dituju skrip |
| `Sheet not found: …` saat menjalankan fungsi dari editor | `setUp()` belum dijalankan pada spreadsheet tersebut |
| "not registered for this portal" | email belum ada di sheet `users`, atau `Active` bukan `TRUE` |
| Tombol *Forward Order* menolak | sheet `Recipients` kosong atau semuanya tidak aktif |
| Email tidak terkirim | kuota `MailApp` habis — 100/hari untuk akun gmail biasa, 1.500/hari untuk Workspace. Cek kolom `Status` dan `Error` di sheet `EmailLog` |
| Rekap sore tidak jalan | `installTriggers()` belum dijalankan, atau klaim belum berstatus `In Review` |
| Rekap terkirim tapi principal tidak menerima | Tidak ada akun `users` berperan `Principal` dengan kolom `Principal` yang cocok. Hasil `sendDigestNow_` melaporkannya sebagai *skipped* |
| Klaim tidak bisa diteruskan | Unitnya belum punya principal. Isi kolom `Principal` di `Population`, atau pakai tombol *Assign principal* di panel klaim |
| Akun Principal ditolak saat masuk | Kolom `Principal` di sheet `users` kosong, atau namanya tidak ada di sheet `Principals` |
| Unggahan gagal untuk berkas besar | batas 10 MB per berkas sebelum dikompres; foto dikecilkan otomatis di browser, PDF tidak |
