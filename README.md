# Warranty Claim Portal

Aplikasi klaim garansi sparepart untuk mesin hemodialisis **Sansin** dan **Oneject**, dibangun di atas Google Apps Script (backend dan frontend) dengan Google Sheets sebagai basis data.

Status: **konsep**. Belum ada kode aplikasi — repo ini baru berisi mockup UI.

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

**Struktur sheet.** `Claims` · `ClaimItems` · `Attachments` · `AuditLog` · `EmailLog` · `users` · `Customer` · `sparepart` · `Recipients` · `warranty` · `Population`.

**Berkas Drive** disimpan per bulk dan per klaim, dengan subfolder per kategori:

```
Klaim/CW300826/CLM-260826-0004/01-PART/
  CW300826_CLM-260826-0004_XT2410090_PART-01_ELECTRICAL-MAINBOARD.jpg
```

**Email** — enam jenis, seluruhnya diarsipkan di `EmailLog` sebagai bukti audit:

| | Pemicu | Penerima |
|---|---|---|
| 1 | Klaim diajukan | Administrator |
| 2 | Rekap harian pukul 17:00 WIB | Principal |
| 3 | Keputusan principal | Requester |
| 4 | Keputusan principal | Administrator |
| 5 | Pesanan disetujui diteruskan | daftar `Recipients` |
| 6 | Klaim dikembalikan | Requester |

**Ketentuan lain.** Antarmuka aplikasi berbahasa Inggris formal. Data tidak pernah dihapus permanen, hanya ditandai. Setiap perubahan tercatat di `AuditLog` dengan identitas asli pelakunya. Zona waktu `Asia/Jakarta`.

## Belum dibahas

- Edit Menu — hak ubah per field per peran
- Master Data — CRUD `users`, `Customer`, `sparepart`, `Recipients`
