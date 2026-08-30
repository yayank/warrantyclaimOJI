# Warranty Claim Portal

Aplikasi klaim garansi sparepart untuk mesin hemodialisis **Sansin** dan **Oneject**, dibangun di atas Google Apps Script (backend dan frontend) dengan Google Sheets sebagai basis data.

Status: **aplikasi sudah tertulis**, belum di-deploy. Pemasangannya ada di [`docs/deployment.md`](docs/deployment.md).

## Isi repo

| Berkas | Isi |
|---|---|
| [`src/`](src) | Aplikasinya — 13 berkas `.gs` dan 3 berkas HTML |
| [`dist/`](dist) | Bundel salin-tempel: satu `Code.gs` dan satu `main.html` |
| [`docs/specification.md`](docs/specification.md) | **Spesifikasi lengkap — acuan yang berlaku** |
| [`docs/architecture.md`](docs/architecture.md) | Bagaimana kode ini bekerja, ditelusuri dari satu permintaan nyata |
| [`docs/deployment.md`](docs/deployment.md) | Langkah pemasangan, pengujian, dan penanganan masalah |
| [`docs/ui-mockups.html`](docs/ui-mockups.html) | Mockup 12 layar (visual; unduh lalu buka di browser) |
| [`tools/`](tools) | Bundler dan empat penguji yang berjalan di Node tanpa perlu Google |

Spesifikasi sekarang hidup sebagai markdown di dalam repo supaya hanya ada satu sumber kebenaran yang ikut ter-versi bersama kodenya. Versi HTML-nya sudah dihapus; halaman artifact yang pernah diterbitkan tetap ada sebagai potret Rev 1.

## Struktur kode

| Berkas | Tanggung jawab |
|---|---|
| `Code.gs` | `doGet`, satu-satunya pintu masuk API, dispatcher |
| `Auth.gs` | Verifikasi ID token, resolusi peran, penyaringan baris per peran |
| `Warranty.gs` | Penguraian serial number dan penentuan masa garansi |
| `Claims.gs` | Klaim, item, dan seluruh transisi status |
| `Files.gs` | Folder Drive, penamaan berkas, penyajian gambar |
| `Mailer.gs` | Tujuh template bawaan, perender, pengiriman, arsip |
| `MasterData.gs` | CRUD master, impor data unit |
| `Export.gs` | Ekspor Excel mengikuti filter dan lingkup peran |
| `Audit.gs` · `Triggers.gs` · `Repo.gs` · `Config.gs` · `Setup.gs` | Jejak audit, pemicu terjadwal, akses sheet, konstanta, pemasangan awal |
| `Warranty.gs` | juga memetakan setiap serial number ke principal pemiliknya |
| `index.html` · `Styles.html` · `Script.html` | Kerangka halaman, sistem desain, seluruh antarmuka |

## Menjalankan tanpa memasang apa pun

Kalau clasp tidak bisa dipasang di komputer Anda, salin dua berkas ini ke editor Apps Script:

| Berkas | Disalin sebagai |
|---|---|
| `dist/Code.gs` | satu berkas Script bernama **Code.gs** |
| `dist/main.html` | satu berkas HTML bernama **main** |
| `dist/appsscript.json` | manifest (Project Settings → Show appsscript.json) |

Yang disunting tetap `src/`. Setelah berubah, jalankan `node tools/bundle.js` untuk membangun ulang `dist/`.

## Pengujian

```bash
node tools/verify-warranty.js units.json    # 22 pemeriksaan
node tools/verify-access.js                 # 27 pemeriksaan
node tools/verify-templates.js              # 18 pemeriksaan
node tools/verify-sheets.js                 # 25 pemeriksaan
```

Penguji garansi menjalankan `Warranty.gs` apa adanya terhadap seluruh 2.610 unit di berkas Anda. Hasilnya: rumus 22 bulan cocok dengan sheet pada **1.112 dari 1.112 unit `XT` (100%)**, seluruh 1.497 unit `C` dilempar ke pemeriksaan manual, dan satu serial number salah ketik (`XF2407094`) ikut dilempar ke manual alih-alih ditebak.

Penguji sheet menjalankan `Repo.gs` terhadap spreadsheet tiruan dan membuktikan bahwa baris pertama yang berisi data tidak pernah dibaca sebagai baris judul — persoalan nyata pada sheet `Customer` dan `sparepart` yang datang dari workbook lama tanpa judul kolom, yang membuat dropdown terisi baris kosong.

Penguji akses membuktikan pemisahan antar principal: dua principal tidak pernah saling melihat klaim, klaim yang belum terpetakan tidak sampai ke siapa pun, dan klaim uji tersembunyi dari semua peran kecuali Tester.

## Mockup UI

| | Layar |
|---|---|
| 01 | Sign In |
| 02 | Submit Claim |
| 03 | Saving Progress |
| 04 | Claim Status — Requester (per klaim) |
| 05 | Claim Status — Administrator (per sparepart) |
| 06 | Verification Panel — Administrator |
| 07 | Batch Review — Principal |
| 08 | Forward Order & Availability — Administrator |
| 09 | Role Simulation — Tester |
| 10 | Edit Mode by Role — Administrator vs Principal |
| 11 | Master Data — Administrator |
| 12 | Email Templates — Administrator |

## Keputusan rancangan

**Autentikasi.** Dua jalur, dan identitas tidak pernah datang dari browser pada keduanya. Secara bawaan portal memakai identitas Apps Script sendiri — tanpa pengaturan apa pun, tetapi hanya mengenali akun di dalam domain organisasi. Begitu `Settings!GoogleClientId` diisi, portal berpindah ke Google Sign-In dengan verifikasi ID token di sisi server, yang mengenali akun mana pun termasuk Principal di luar organisasi. Peran selalu dibaca server dari sheet `users`. Web app di-deploy sebagai *Execute as: Me*, sehingga spreadsheet tidak perlu dibagikan kepada siapa pun.

**Peran.** Requester · Production · Administrator · Principal · Tester.

**Banyak principal.** Sheet `Population` dan `users` punya kolom `Principal`. Klaim mewarisi principal dari unitnya, dan setiap akun Principal hanya melihat klaim principal-nya sendiri — ditegakkan di server, bukan di layar. Klaim yang belum terpetakan tidak bisa diteruskan sampai Administrator menetapkannya.

**Sparepart talangan.** Part dapat ditandai sudah diserahkan dari stok lokal supaya mesin kembali jalan, tanpa menghentikan proses klaim. Alurnya tidak berubah; yang berubah adalah arti pengirimannya — part dari principal mengisi kembali stok, bukan menuju rumah sakit — dan terlihat jelas kalau klaimnya kemudian ditolak.

**Masa garansi principal** dihitung dari serial number, bukan tanggal penjualan:

| Format SN | Contoh | Bulan perakitan | Garansi |
|---|---|---|---|
| `XT` + `YYMM` + urut | `XT2305083` | Mei 2023 | + 22 bulan |
| `C` + `YY` + huruf bulan + kode + urut | `C25GPA011` | Juli 2025 | selalu diperiksa manual oleh Admin |

Rumus 22 bulan diuji terhadap seluruh 1.112 unit `XT` dan cocok pada semuanya (100%). Unit `C` dirakit di dalam negeri sehingga masa garansi komponennya tidak dapat dihitung dari data yang tersedia.

**Alur klaim.**

```
Draft → Submitted → (verifikasi Admin)
                     ├─ masih garansi principal → Work Order wajib → In Review
                     │     → Approved / Rejected per sparepart
                     │     → Order Forwarded → Awaiting Part Availability
                     │     → Shipped → Closed
                     └─ di luar garansi principal → pemeriksaan garansi internal oleh Admin
```

**Penomoran.** `ClaimID` unik per klaim (`CLM-260826-0004`); `No Ref` adalah nomor bulk harian yang dibagi bersama seluruh klaim di tanggal yang sama (`CW300826`), agar principal melihatnya sebagai satu pengajuan kolektif. Klaim uji memakai seri terpisah (`TEST-` dan `CWT`).

**Struktur sheet.** `Claims` · `ClaimItems` · `Attachments` · `AuditLog` · `EmailLog` · `EmailTemplates` · `users` · `Principals` · `Customer` · `sparepart` · `Recipients` · `warranty` · `Population`.

Master data dirujuk lewat ID, bukan teks. `Claims` menyimpan `CustomerID` beserta salinan nama saat pengajuan, `ClaimItems` menyimpan `PartID` beserta salinan namanya. Layar menampilkan nama terkini; ekspor audit menampilkan keduanya bila berbeda.

**Hak ubah** ditentukan oleh peran dan status. Requester hanya dapat mengubah klaim yang berstatus `Draft` atau `Returned`. Administrator dapat memperbaiki klaim `Submitted` — setiap perubahan tercatat dan Requester diberi tahu; penggantian serial number memerlukan alasan tertulis karena mengubah dasar perhitungan garansi. Principal hanya dapat mengubah keputusan per sparepart.

**Berkas Drive** disimpan per bulk dan per klaim, dengan subfolder per kategori:

```
Klaim/CW300826/CLM-260826-0004/01-PART/
  CW300826_CLM-260826-0004_XT2410090_PART-01_ELECTRICAL-MAINBOARD.jpg
```

**Email** — tujuh jenis, seluruhnya diarsipkan di `EmailLog` sebagai bukti audit:

| | Pemicu | Penerima |
|---|---|---|
| 1 | Klaim diajukan | Administrator |
| 2 | Rekap harian pukul 17:00 WIB | Principal |
| 3 | Keputusan principal | Requester |
| 4 | Keputusan principal | Administrator |
| 5 | Pesanan disetujui diteruskan | daftar `Recipients` |
| 6 | Klaim dikembalikan | Requester |
| 7 | Klaim diubah Administrator | Requester |

**Template email** dapat disunting Administrator. Ketujuh template bawaan ikut di dalam kode dan aktif sejak awal; sheet `EmailTemplates` hanya menimpanya, dan sistem jatuh kembali ke bawaan bila sheet kosong atau tidak valid. Kop dan kaki email dikunci karena memuat nomor referensi, waktu, versi template, dan nomor arsip; badan email bebas ditulis ulang memakai placeholder. Placeholder yang menopang nilai pembuktian — antara lain `{{ClaimID}}` dan `{{WarrantyBasis}}` — tidak dapat dihapus. Versi template yang dipakai tiap pengiriman dicatat di `EmailLog`.

**Ketentuan lain.** Antarmuka aplikasi berbahasa Inggris formal. Data tidak pernah dihapus permanen, hanya ditandai. Setiap perubahan tercatat di `AuditLog` dengan identitas asli pelakunya. Zona waktu `Asia/Jakarta`.

Rincian selengkapnya ada di [`docs/specification.md`](docs/specification.md): struktur seluruh sheet berikut nama kolomnya, tabel transisi status, matriks hak akses per field, isi ketujuh template email, mekanisme verifikasi login, batasan Apps Script, dan rencana migrasi data.

## Berikutnya

Deploy sesuai [`docs/deployment.md`](docs/deployment.md), lalu uji seluruh alur memakai peran `Tester` sebelum data sungguhan masuk.
