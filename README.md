# Warranty Claim Portal

Aplikasi klaim garansi sparepart untuk mesin hemodialisis **Sansin** dan **Oneject**, dibangun di atas Google Apps Script (backend dan frontend) dengan Google Sheets sebagai basis data.

Status: **konsep**. Belum ada kode aplikasi — repo ini baru berisi mockup UI.

## Dokumen

| Berkas | Isi |
|---|---|
| [`docs/specification.html`](docs/specification.html) | Spesifikasi lengkap — PRD di depan, spesifikasi teknis di belakang |
| [`docs/ui-mockups.html`](docs/ui-mockups.html) | Mockup 12 layar |

## Mockup UI

[`docs/ui-mockups.html`](docs/ui-mockups.html) — sembilan layar, lengkap dengan data contoh dari file klaim asli.

GitHub tidak merender HTML langsung dari repo. Untuk melihatnya: unduh berkasnya lalu buka di browser, atau aktifkan GitHub Pages pada branch ini.

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

**Autentikasi.** Google Sign-In dengan verifikasi ID token di sisi server; web app di-deploy sebagai *Execute as: Me*. Cara ini dipilih karena Principal memakai email di luar domain organisasi, sehingga `Session.getActiveUser()` tidak dapat diandalkan, sementara pembatasan data per peran harus tetap ditegakkan di server.

**Peran.** Requester · Production · Administrator · Principal · Tester.

**Masa garansi principal** dihitung dari serial number, bukan tanggal penjualan:

| Format SN | Contoh | Bulan perakitan | Garansi |
|---|---|---|---|
| `XT` + `YYMM` + urut | `XT2305083` | Mei 2023 | + 22 bulan |
| `C` + `YY` + huruf bulan + kode + urut | `C25GPA011` | Juli 2025 | selalu diperiksa manual oleh Admin |

Rumus 22 bulan diuji terhadap 1.113 unit `XT` dan cocok pada 99,91% baris. Unit `C` dirakit di dalam negeri sehingga masa garansi komponennya tidak dapat dihitung dari data yang tersedia.

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

**Struktur sheet.** `Claims` · `ClaimItems` · `Attachments` · `AuditLog` · `EmailLog` · `EmailTemplates` · `users` · `Customer` · `sparepart` · `Recipients` · `warranty` · `Population`.

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

Rincian selengkapnya ada di [`docs/specification.html`](docs/specification.html): struktur seluruh sheet berikut nama kolomnya, tabel transisi status, matriks hak akses per field, isi ketujuh template email, mekanisme verifikasi login, batasan Apps Script, dan rencana migrasi data.

## Berikutnya

Membangun aplikasinya.
