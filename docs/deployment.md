# Pemasangan

Urutan ini penting: aplikasi tidak bisa dipakai sebelum langkah 5 selesai, karena identitas pengguna ditegakkan lewat Google Sign-In dan itu memerlukan OAuth Client ID.

## 1. Siapkan spreadsheet

Buat Google Spreadsheet baru, atau pakai berkas klaim Anda yang sudah ada. Salin ID-nya dari URL:

```
https://docs.google.com/spreadsheets/d/<ID-DI-SINI>/edit
```

## 2. Buat proyek Apps Script

1. Buka [script.google.com](https://script.google.com) → **New project**
2. Salin seluruh isi folder `src/` ke dalam proyek:
   - berkas `.gs` sebagai *Script*
   - `index.html`, `Styles.html`, `Script.html` sebagai *HTML*
   - `appsscript.json` lewat **Project Settings → Show "appsscript.json"**
3. **Project Settings → Script Properties** → tambahkan `SPREADSHEET_ID` berisi ID dari langkah 1

Kalau memakai [clasp](https://github.com/google/clasp), cukup `clasp push` dari folder `src/`.

## 3. Jalankan `setUp()`

Di editor Apps Script, pilih fungsi `setUp` lalu **Run**. Google akan meminta izin — setujui.

Fungsi ini membuat tiga belas sheet beserta baris judulnya, menyiapkan folder Drive `Klaim/`, memberi ID pada setiap customer dan sparepart, dan menambahkan entri `Internal — Production`. Aman dijalankan berulang kali.

## 4. Daftarkan diri Anda

Buka sheet `users`, tambahkan satu baris:

| Email | Name | Role | Active |
|---|---|---|---|
| email Anda | nama Anda | `Administrator` | `TRUE` |

Tanpa baris ini tidak ada seorang pun yang bisa masuk — termasuk pemilik skripnya.

## 5. Buat OAuth Client ID

1. Buka **Project Settings** di editor Apps Script, catat **Google Cloud Platform Project number**
2. Buka [console.cloud.google.com](https://console.cloud.google.com) pada proyek tersebut
3. **APIs & Services → OAuth consent screen** → isi nama aplikasi dan email dukungan
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://script.google.com`
5. Salin **Client ID** ke sheet `Settings`, baris `GoogleClientId`

Ini yang membuat login otomatis berfungsi untuk email domain apa pun, termasuk Principal di luar organisasi Anda, tanpa perlu membagikan spreadsheet kepada siapa pun.

## 6. Deploy

**Deploy → New deployment → Web app**

| Pengaturan | Nilai |
|---|---|
| Execute as | **Me** |
| Who has access | **Anyone** |

Kedua pilihan itu disengaja. *Execute as: Me* membuat data tetap milik Anda; *Anyone* diperlukan karena identitas ditegakkan oleh token Google Sign-In, bukan oleh Apps Script — setiap panggilan tetap diverifikasi di server dan email yang tidak terdaftar di sheet `users` selalu ditolak.

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

## 9. Isi data pendukung

- **`Recipients`** — penerima pesanan di sisi principal, yang tidak punya akses aplikasi. Tanpa ini tombol *Forward Order* tidak bisa dipakai.
- **`users`** — tambahkan Requester, Production, dan Principal.
- **Tester** — beri satu email peran `Tester` kalau ingin menguji alur tanpa menyentuh data asli. Hapus barisnya untuk mematikan peran itu; tidak perlu deploy ulang.

## Menguji tanpa merusak data

Masuk sebagai `Tester`, lalu pakai pemilih peran di spanduk kuning. Yang terjadi:

- klaim yang Anda buat memakai seri `TEST-` dan `CWT`, tersimpan di `Klaim/_UJI/`
- tombol aksi mati pada klaim sungguhan
- semua email dibelokkan ke alamat Anda dengan subjek berawalan `[TEST]` — menekan *Forward to Principal* tidak akan pernah sampai ke principal
- tombol **Purge Test Claims** menghapus seluruh jejak uji, termasuk foldernya

## Memeriksa logika sebelum deploy

Dua penguji berjalan di Node tanpa perlu Google:

```bash
node tools/verify-warranty.js units.json    # mesin garansi, diuji ke 2.610 unit asli
node tools/verify-templates.js              # perender template email
```

`units.json` berisi `[{ sn, expired }]` dari sheet `warranty`.

## Kalau ada yang tidak beres

| Gejala | Penyebab |
|---|---|
| Halaman berhenti di layar masuk | `GoogleClientId` belum diisi, atau origin `https://script.google.com` belum didaftarkan |
| "not registered for this portal" | email belum ada di sheet `users`, atau `Active` bukan `TRUE` |
| Tombol *Forward Order* menolak | sheet `Recipients` kosong atau semuanya tidak aktif |
| Email tidak terkirim | kuota `MailApp` habis — 100/hari untuk akun gmail biasa, 1.500/hari untuk Workspace. Cek kolom `Status` dan `Error` di sheet `EmailLog` |
| Rekap sore tidak jalan | `installTriggers()` belum dijalankan, atau klaim belum berstatus `In Review` |
| Unggahan gagal untuk berkas besar | batas 10 MB per berkas sebelum dikompres; foto dikecilkan otomatis di browser, PDF tidak |
