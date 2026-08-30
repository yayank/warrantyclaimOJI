# Warranty Claim Portal — Spesifikasi

Rev 2 · 30 Aug 2026 · dokumen ini adalah acuan yang berlaku

> Rev 1 diterbitkan sebagai halaman HTML terpisah. Sejak Rev 2 spesifikasi hidup di berkas ini agar hanya ada satu sumber kebenaran yang ikut ter-versi bersama kodenya.

Bagian I menjelaskan apa dan kenapa. Bagian II menjelaskan bagaimana. Yang masih terbuka dikumpulkan di bagian penutup, bukan diselipkan di tengah.

| | |
|---|---|
| Platform | Google Apps Script + Google Sheets |
| Bahasa aplikasi | English |
| Zona waktu | `Asia/Jakarta` |
| Kode | [`src/`](../src) — 13 berkas `.gs`, 3 berkas HTML |
| Bundel salin-tempel | [`dist/`](../dist) — `Code.gs` + `main.html` |

---

# Bagian I — Produk

## 1. Latar belakang

Klaim garansi sparepart dikelola manual dalam satu Google Sheet. Pemeriksaan atas berkas itu menemukan empat hal yang menjadi alasan aplikasi ini dibangun.

| Temuan | Rincian | Dampak |
|---|---|---|
| Status garansi kedaluwarsa | 221 dari 2.610 baris di sheet `warranty` punya kolom Status yang tidak lagi cocok dengan tanggal `exp`-nya | Klaim bisa salah jalur sejak awal |
| Tidak ada kunci unik | Kolom `no` terisi 10 dari 20 baris; satu No Ref dipakai beberapa baris | Tidak ada cara menunjuk satu klaim secara pasti |
| Master data lepas kaitan | Empat nama sparepart di sheet `Log` tidak lagi ada di master setelah penggantian nama | Riwayat klaim tidak terbaca oleh sistem |
| Tidak ada jejak keputusan | Kolom Approval terisi 2 dari 20 baris; tidak ada catatan siapa mengubah apa | Tidak ada bukti saat bersengketa dengan principal |

Yang terakhir paling menentukan bentuk aplikasi ini. Klaim garansi punya konsekuensi finansial terhadap principal, sehingga **setiap keputusan harus dapat ditelusuri** — siapa memutuskan, kapan, atas dasar apa. Prinsip itu menjelaskan sebagian besar keputusan di dokumen ini: data tidak pernah dihapus, perhitungan garansi selalu ditampilkan terbuka, dan email berfungsi sebagai arsip yang berdiri sendiri.

## 2. Pengguna & peran

| Peran | Siapa | Yang dikerjakan | Lingkup data |
|---|---|---|---|
| **Requester** | Teknisi lapangan; satu orang menangani banyak rumah sakit | Mengajukan klaim, merevisi klaim yang dikembalikan | Hanya klaim miliknya sendiri |
| **Production** | Team produksi | Sama seperti Requester, untuk unit yang belum terpasang | Hanya klaim miliknya; Customer terkunci `Internal — Production` |
| **Administrator** | Pengelola garansi | Verifikasi, Work Order, teruskan ke principal, garansi internal, penerusan pesanan, master data | Seluruh klaim, seluruh principal |
| **Principal** | Pihak prinsipal, di luar organisasi | Menyetujui atau menolak per sparepart | **Hanya klaim unit milik principal-nya sendiri**, dan hanya yang sudah diverifikasi |
| **Tester** | Penguji aplikasi | Menyamar sebagai peran lain | Melihat sesuai peran samaran; menulis hanya pada klaim uji |

Ada satu pihak lagi yang **tidak memakai aplikasi**: penerima pesanan di sisi principal. Mereka menerima email berisi daftar part yang disetujui, lalu membalas di luar sistem; Administrator yang memasukkan jawabannya.

## 3. Banyak principal

Aplikasi melayani lebih dari satu principal sekaligus. Ini bukan sekadar label — ini batas keamanan.

```
Unit  ──(sheet Population, kolom Principal)──▶  Klaim menyimpan Principal
                                                        │
                     ┌──────────────────────────────────┤
                     ▼                                  ▼
        Principal A hanya melihat            Principal B hanya melihat
        klaim unit miliknya                  klaim unit miliknya
```

- **Sheet `Population` punya kolom `Principal`.** Dari situlah setiap klaim tahu milik siapa unitnya.
- **Sheet `users` punya kolom `Principal`.** Akun berperan Principal wajib terisi; tanpa itu akun tidak bisa masuk, karena tidak ada klaim yang bisa dilihatnya dan tidak ada rekap yang bisa diterimanya.
- **Klaim yang tidak terpetakan tidak sampai ke siapa pun.** Kalau kolom Principal di Population kosong untuk suatu SN, klaimnya tidak bisa diteruskan sampai Administrator menetapkannya sendiri. Ini disengaja — menebak berarti berisiko mengirim data satu principal ke principal lain.
- **Rekap harian dipecah per principal.** Satu email berisi satu principal saja.

Layar Master Data → Units menampilkan peringatan bila ada unit tanpa principal, atau nama principal di Population yang tidak dikenal master.

**Catatan penting:** aturan masa garansi masih dihitung dari format serial number, bukan dari principal-nya. Unit principal baru dengan format SN yang belum dikenal otomatis masuk *Manual Verification Required* — aman, tapi berarti belum otomatis. Aturan per principal bisa ditambahkan kalau memang diperlukan.

## 4. Alur klaim

```
                          Draft  ── Requester
                            │ submit                    📧 → Administrator
                            ▼
                        Submitted
                            │ Administrator memeriksa kelengkapan & garansi
              ┌─────────────┼─────────────────────────┐
     data kurang            │                  di luar garansi principal
              ▼             │                         ▼
   Returned to Requester    │              Internal Verification
     📧 → Requester         │              Admin memeriksa di aplikasi lain
              └──── revisi ─┤                    │              │
                            │ masih garansi      ▼              ▼
                            │ principal      disetujui      ditolak
                            ▼                    │              │
              Work Order wajib diisi             │              │
              Principal wajib terpetakan         │              │
                            │ teruskan           │              │
                            ▼                    │              │
                        In Review  ──── 17:00 📧 → Principal     │
                            │                    │              │
              Principal memutuskan per sparepart │              │
                            │  📧 → Requester & Administrator   │
                            ▼                    │              │
                     In Fulfilment ◄─────────────┘              │
                            │                                   │
       Admin meneruskan pesanan  📧 → Recipients                 │
       Admin mengisi Availability Date & Document Ref            │
       Admin menandai part dikirim                               │
                            ▼                                   ▼
                         Closed ◄───────────────────────────────┘
```

Empat hal yang membentuk alur ini dan mudah terlewat:

- **Work Order adalah gerbang** menuju principal, bukan syarat pengiriman. Principal menerima klaim yang sudah punya nomor kerja internal.
- **Keputusan diambil per sparepart**, bukan per klaim.
- **Penolakan tidak final.** Diskusi berlanjut di luar aplikasi, dan keputusan dapat diubah kapan saja dengan alasan tertulis.
- **Klaim ditutup saat part dikirim.** Pengembalian part rusak dicatat sesudahnya sebagai keterangan.

### Isian yang bisa dicari

Tiga isian pada formulir klaim adalah **dropdown yang bisa dicari**: kotak teks yang menyaring daftarnya sambil diketik. Daftar Customer berisi 1.386 nama dan daftar unit beberapa ribu serial number — pada ukuran itu `<select>` biasa hanya bisa digulung, tidak bisa dipakai.

| Field | Sumber daftar | Isian di luar daftar |
|---|---|---|
| Customer | master `Customer` yang aktif | Ditolak. Kotak menampilkan “tidak ada yang cocok” beserta nama dan alamat email Administrator, lalu isian dikembalikan ke pilihan terakhir yang sah |
| Serial number | kolom `Batch` pada sheet `Population` | **Diterima.** Klaim tetap bisa disimpan dan di-submit; layar memberi tahu bahwa unit itu tidak terdaftar, apa akibatnya, dan siapa Administrator yang bisa dihubungi |
| Sparepart (tiap baris) | master `sparepart` yang aktif | Ditolak, sama seperti Customer |

Selama belum ada yang diketik, seluruh daftar ditawarkan — termasuk saat isian sudah terisi. Isian yang tidak bisa dibuka ulang untuk diganti lebih buruk daripada tidak ada dropdown sama sekali.

Serial number yang tidak ada di `Population` **tidak menghalangi apa pun** — mesin di lapangan tidak menunggu sheet diperbarui, dan sebuah unit bisa saja belum sempat diimpor. Yang terjadi hanyalah klaim itu tidak terpetakan ke principal mana pun, jadi Administrator harus menetapkannya sendiri (`Assign principal`) atau mendaftarkan unitnya. Layar menyebutkan hal itu apa adanya, beserta nama dan email Administrator aktif dari sheet `users`.

Daftar unit diambil sekali per sesi lewat `claims.units`, bukan ikut dalam payload login: setiap layar butuh daftar customer, hanya formulir klaim yang butuh beberapa ribu serial number.

## 5. Sparepart talangan

Di lapangan, mesin sering tidak bisa menunggu keputusan principal. Sparepart dikirim dari stok lokal supaya alat kembali jalan, sementara klaim tetap berjalan.

Aplikasi mengakomodasi ini **tanpa mengubah alur klaim sama sekali.** Yang ditambahkan hanya penanda pada baris sparepart:

```
ClaimItems
  AdvanceIssued     TRUE
  AdvanceIssuedAt   2026-08-30T09:15:00
  AdvanceIssuedBy   admin@oneject.co.id
  AdvanceNote       Dikirim dari stok, 30 Agu pagi
```

Apa yang berubah karenanya:

| Hal | Tanpa talangan | Dengan talangan |
|---|---|---|
| Alur klaim | Draft → … → Closed | **sama persis** |
| Arti pengiriman dari principal | part menuju rumah sakit | part **mengisi kembali stok** |
| Yang dilihat principal | daftar part biasa | ditandai *already supplied from local stock* |
| Kalau ditolak principal | rumah sakit belum terima apa-apa | **biaya sudah tertanggung di sisi Anda** — terlihat jelas di ringkasan dan ekspor |

**Yang mencatat hanya Administrator**, kapan saja sebelum klaim ditutup, lewat tombol *Record advance issue* di panel detail; penandanya bisa dicabut lagi dari tempat yang sama. Stoknya milik Administrator dan hanya dia yang tahu apakah ada part yang keluar dari sana — Requester meminta part dan tidak pernah melihat penanda ini di formulir.

Karena itu `claims.save` tidak pernah menyentuh penanda ini: Requester boleh menyunting klaimnya selama masih Draft atau Returned, dan suntingan itu tidak boleh mengubah catatan apa yang sudah dikirim dari stok. Satu-satunya jalan masuk adalah `claims.advanceIssue`, yang hanya menerima Administrator.

Setiap perubahan penanda ini tercatat di `AuditLog` sebagai aksi `AdvanceIssue`, sehingga selalu jelas kapan part berpindah dan atas keputusan siapa.

## 6. Aturan garansi

Masa garansi principal dihitung dari **serial number**, bukan tanggal penjualan. Serial number memuat bulan perakitan, dan itulah titik mulai yang sebenarnya.

| Format | Contoh | Cara baca | Produk | Aturan |
|---|---|---|---|---|
| `XT` | `XT2305083` | `XT` + tahun 2 digit + bulan 2 digit + urut | Sansin | perakitan **+ 22 bulan** |
| `C` | `C25GPA011` | `C` + tahun 2 digit + huruf bulan (A=Jan … L=Des) + kode produk + urut | Oneject, rakitan lokal | **selalu manual** |

Rumus 22 bulan diuji terhadap seluruh unit `XT` di data Anda dan **cocok pada 1.112 dari 1.112 (100%)**. Satu serial number berformat aneh, `XF2407094`, tidak diklaim oleh rumus ini sama sekali — prefiksnya tidak dikenal, jadi dilempar ke pemeriksaan manual alih-alih ditebak.

### Urutan penentuan

```
1. SN berformat XT  → hitung perakitan + 22 bulan
                    → bandingkan dengan sheet warranty; bila ada dan berbeda, tabel menang
2. SN berformat C   → Manual Verification Required, tidak pernah dihitung otomatis
3. Format lain      → Manual Verification Required, tidak ditebak
```

> **Penting.** Kolom `Status` di sheet `warranty` **tidak pernah dibaca**, dan kolom `exp` hanya dipakai untuk SN berformat `XT`. Untuk 1.497 unit berformat `C`, kolom `exp` berisi tanggal penjualan + tepat 35 hari pada seluruh barisnya — angka pukul rata yang tidak mencerminkan aturan garansi mana pun, sehingga memakainya akan salah di semua unit tersebut.

Unit berformat `C` dirakit di dalam negeri; yang bergaransi tiga bulan adalah komponen dari principal, dihitung sejak komponen dikirim. Tanggal itu tidak tersedia di data mana pun, sehingga penentuannya diserahkan kepada Administrator.

Garansi internal satu tahun sejak instalasi **tidak dihitung aplikasi** — Administrator memeriksanya di aplikasi lain, lalu memasukkan hasilnya.

## 7. Lingkup

**Termasuk:** pengajuan klaim dengan pemeriksaan garansi otomatis dan unggahan berkas; verifikasi, penerusan, dan keputusan per sparepart; pemisahan data antar principal; sparepart talangan; penerusan pesanan ke pihak luar berikut jadwal ketersediaan; tujuh notifikasi email dengan template yang dapat disunting; master data; jejak audit; arsip email; ekspor Excel.

**Tidak termasuk:** perhitungan garansi internal; pencatatan tanggal instalasi dan basis terpasang; manajemen stok sparepart; dasbor analitik; akses aplikasi untuk penerima pesanan di sisi principal.

---

# Bagian II — Spesifikasi teknis

## 8. Arsitektur

Satu proyek Apps Script berisi backend dan frontend, satu Google Sheet sebagai basis data, satu folder Drive untuk berkas.

| Berkas | Isi |
|---|---|
| `Code.gs` | `doGet`, routing halaman, satu-satunya pintu masuk API |
| `Auth.gs` | Verifikasi ID token, resolusi peran, penyaringan baris |
| `Claims.gs` | CRUD klaim dan item, transisi status, penjaga tabrakan |
| `Warranty.gs` | Penguraian serial number, penentuan garansi, pemetaan principal |
| `Files.gs` | Unggahan, penamaan, pemindahan folder, penyajian gambar |
| `Mailer.gs` | Template bawaan, perenderan, pengiriman, arsip `EmailLog` |
| `MasterData.gs` | CRUD master, impor unit, kesehatan pemetaan principal |
| `Export.gs` | Ekspor Excel mengikuti filter dan lingkup peran |
| `Audit.gs` | Penulisan `AuditLog` |
| `Triggers.gs` | Rekap 17:00, pembersihan ekspor, cadangan harian |
| `Repo.gs` | Pembacaan sheet berbatch, cache, `LockService` |
| `Config.gs` | Skema sheet dan seluruh konstanta |
| `Setup.gs` | Pemasangan awal dan migrasi data lama |
| `index.html` · `Styles.html` · `Script.html` | Kerangka halaman, sistem desain, seluruh antarmuka |

Deployment: **Execute as: Me (pemilik)**, **Who has access: Anyone**. Kombinasi ini disengaja — identitas ditegakkan oleh Google Sign-In, bukan oleh Apps Script, sehingga spreadsheet tidak perlu dibagikan kepada siapa pun. Konsekuensinya setiap fungsi server wajib memverifikasi token sebelum mengerjakan apa pun.

### Bundel satu berkas

`node tools/bundle.js` menggabungkan seluruh `src/` menjadi `dist/Code.gs` dan `dist/main.html`. Dipakai kalau clasp tidak bisa dipasang di komputer Anda. Sumber yang disunting tetap `src/`; `dist/` selalu hasil generate ulang.

## 9. Mekanisme login

Identitas datang dari salah satu dari dua tempat, dan tidak pernah dari browser.

| Jalur | Syarat | Mengenali |
|---|---|---|
| **Bawaan Apps Script** | tidak ada | hanya akun di dalam domain Workspace pemilik |
| **Google Sign-In** | `Settings!GoogleClientId` terisi | akun Google mana pun |

Portal memakai jalur kedua begitu Client ID terisi, dan jalur pertama bila kosong. Dengan begitu pemasangan bisa langsung berjalan untuk seluruh tim di organisasi, lalu menambahkan akun luar belakangan tanpa mengubah kode.

Identitas bawaan tetap dapat dipercaya — ia berasal dari Google, bukan dari browser. Batasnya satu: untuk akun di luar domain, Google mengembalikan nilai kosong, dan portal menolaknya dengan penjelasan alih-alih menebak.

### Kenapa Google Sign-In tetap dibutuhkan

Apps Script hanya menyediakan dua mode deploy, dan keduanya sendirian tidak memenuhi kebutuhan aplikasi ini.

| Mode | `Session.getActiveUser()` | Akses spreadsheet |
|---|---|---|
| Execute as: Me | Kosong untuk pengguna di luar domain pemilik | Aman — tidak perlu dibagikan |
| Execute as: User accessing | Berfungsi untuk semua | Bocor — pengguna wajib punya akses langsung |

Principal memakai email di luar domain organisasi, sehingga mode pertama tidak mengenali mereka; mode kedua membuat pembatasan data per peran mustahil ditegakkan. Jalan keluarnya adalah menegakkan identitas sendiri:

```
1. doGet menyajikan kerangka halaman berisi tombol Google Sign-In
   dengan OAuth Client ID dari sheet Settings

2. Pengguna masuk → Google Identity Services mengembalikan ID token (JWT)

3. Setiap panggilan google.script.run menyertakan token tersebut

4. Server memverifikasi lewat UrlFetchApp ke
   https://oauth2.googleapis.com/tokeninfo?id_token=…
   memeriksa  aud == Client ID kita
              exp  belum lewat
              email_verified == true

5. Email dicari di sheet users
   tidak terdaftar / tidak aktif → ditolak dengan pesan yang jelas
   berperan Principal tanpa kolom Principal → ditolak

6. Hasil verifikasi disimpan di CacheService selama sisa masa token
```

Aturan yang tidak boleh dilanggar: **peran tidak pernah diambil dari sisi klien.** Setiap fungsi server menentukan sendiri peran pemanggil dari token, lalu menyaring data sesuai peran itu. Penyaringan di HTML hanya kosmetik.

**Tautan pintas.** Tautan dari email membawa parameter seperti `?page=claim&id=CLM-260826-0004`. Tujuan disimpan lebih dulu, pengguna masuk, baru diarahkan ke tujuannya.

## 10. Struktur sheet

Dua belas sheet operasional ditambah dua sheet rujukan.

### Claims — satu baris per klaim

| Kolom | Tipe | Keterangan |
|---|---|---|
| **ClaimID** | teks | `CLM-YYMMDD-NNNN`, dibuat saat draft pertama disimpan |
| RefNo | teks | `CW{ddmmyy}`, diisi saat submit — bukan saat draft dibuat |
| IsTest | boolean | Klaim uji, disembunyikan dari semua peran kecuali Tester |
| CustomerID | teks | Rujukan ke master Customer |
| CustomerName | teks | Salinan nama saat pengajuan, tidak ikut berubah |
| SerialNumber | teks | Sesuai yang diketik pengguna |
| ProductName | teks | Salinan dari sheet `Population` |
| AssemblyMonth | YYYY-MM | Hasil penguraian serial number |
| **Principal** | teks | Pemilik unit, dari `Population`. Kosong = belum terpetakan, tidak bisa diteruskan |
| WarrantyType | enum | `Principal Warranty` · `Out of Principal Warranty` · `Manual Verification Required` · `Internal Warranty` |
| WarrantyExpiry | YYYY-MM | Kosong bila perlu pemeriksaan manual |
| WarrantyBasis | teks | Kalimat perhitungan, mis. *assembled Oct 2024 + 22 months* |
| WarrantyOverridden | boolean | Diubah manual oleh Administrator |
| WarrantyOverrideReason | teks | Wajib bila kolom di atas benar |
| ProblemDescription | teks | Wajib, tanpa batas panjang minimum |
| WorkOrderNo | teks | Wajib sebelum diteruskan ke principal |
| Status | enum | Lihat bagian 11 |
| RequesterEmail · RequesterName | teks | Dari hasil login, bukan isian |
| CreatedAt · SubmittedAt · ForwardedAt · ClosedAt | datetime | Penanda waktu tiap tahap |
| PrincipalNotifiedAt | datetime | Penjaga agar rekap tidak ganda dan tidak terlewat |
| ReturnReason | teks | Alasan pengembalian terakhir |
| DriveFolderId | teks | Folder klaim |
| Deleted · DeletedBy · DeletedAt | boolean · teks · datetime | Penanda hapus; baris tidak pernah dibuang |
| UpdatedAt · UpdatedBy · RowVersion | datetime · teks · angka | `RowVersion` menjadi dasar penjaga tabrakan |

### ClaimItems — satu baris per sparepart

| Kolom | Tipe | Keterangan |
|---|---|---|
| **ItemID** | teks | `ITM-YYMMDD-NNNN-NN` |
| ClaimID | teks | Rujukan ke induknya |
| PartID · PartName | teks | Rujukan master beserta salinan nama saat pengajuan |
| Qty | angka | Minimal 1 |
| ItemStatus | enum | `Pending` · `Approved` · `Rejected` · `Order Forwarded` · `Awaiting Part Availability` · `Shipped` |
| **AdvanceIssued** | boolean | Part sudah diserahkan dari stok lokal |
| **AdvanceIssuedAt · AdvanceIssuedBy** | datetime · teks | Kapan dan oleh siapa |
| **AdvanceNote** | teks | Keterangan penyerahan |
| DecisionBy · DecisionAt · DecisionReason | teks · datetime · teks | Alasan wajib untuk penolakan dan setiap perubahan keputusan |
| AvailabilityDate | tanggal | Diisi Administrator |
| DocumentRefNo | teks | Diisi Administrator; kesamaan nilai membentuk kelompok pengiriman |
| ForwardedAt · ForwardedTo | datetime · teks | Penerusan pesanan ke pihak luar |
| ShippedAt · ShippedBy | datetime · teks | Penandaan pengiriman |
| PartReturnNote · PartReturnAt | teks · datetime | Catatan, bukan syarat penutupan |

> **Kelompok pengiriman** tidak punya tabel tersendiri. Part yang berbagi `DocumentRefNo` yang sama otomatis tampil sebagai satu kelompok.

### Attachments

`AttachmentID` · `ClaimID` · `ItemID` (hanya untuk jenis `PART`) · `Kind` (`PART`/`FAULT`/`REPORT`) · `DriveFileId` · `FileName` · `OriginalFileName` · `MimeType` · `SizeBytes` · `Version` · `Superseded` · `UploadedBy` · `UploadedAt`

Unggahan ulang tidak menimpa; versi lama ditandai `Superseded` dan tetap tersimpan.

### AuditLog

`LogID` · `Timestamp` · `Actor` · `ActorRole` · `SimulatedRole` · `ClaimID` · `ItemID` · `Action` · `Field` · `OldValue` · `NewValue` · `Reason` · `IsTest`

Aksi: `Create` · `SaveDraft` · `Submit` · `Amend` · `Return` · `WarrantyOverride` · `ForwardToPrincipal` · `Withdraw` · `PrincipalDecision` · `ChangeDecision` · **`AdvanceIssue`** · `SetAvailability` · `ForwardOrder` · `MarkShipped` · `RecordPartReturn` · `Delete` · `MasterDataChange` · `TemplateChange`

`Actor` selalu identitas **asli**, apa pun peran yang sedang disamar. Alasan wajib untuk `WarrantyOverride`, `ChangeDecision`, penolakan, dan penggantian serial number.

### EmailLog

`EmailID` · `SentAt` · `TemplateCode` · `TemplateVersion` · `To` · `Cc` · `Subject` · `BodySnapshot` · `ClaimIDs` · `RefNo` · `Status` · `Error` · `IsTest`

`To` mencatat penerima **sebenarnya**, bukan yang seharusnya — di mode uji semua email dibelokkan ke penguji.

### EmailTemplates

`TemplateCode` · `Name` · `Subject` · `Body` · `Version` · `Active` · `UpdatedBy` · `UpdatedAt`

Ketujuh template bawaan tertanam di kode dan aktif sejak awal. Sheet ini hanya menimpanya; bila kosong, hilang, atau gagal pemeriksaan placeholder wajib, sistem memakai bawaan.

### Master data

| Sheet | Kolom | Catatan |
|---|---|---|
| `users` | `Email` · `Name` · `Role` · **`Principal`** · `Active` · `CreatedAt` | Sistem menolak bila tidak tersisa Administrator aktif; akun Principal wajib punya Principal |
| `Principals` | `PrincipalID` · `Name` · `Active` · `Notes` | Daftar nama principal yang diterima sistem |
| `Customer` | `CustomerID` · `Name` · `Active` | 1.386 entri, ditambah `Internal — Production` |
| `sparepart` | `PartID` · `Name` · `Active` | 82 entri |
| `Recipients` | `RecipientID` · `Name` · `Email` · `Company` · **`Principal`** · `Active` · `Notes` | Penerima pesanan di luar aplikasi |
| `Settings` | `Key` · `Value` | `GoogleClientId`, `DriveRootFolderId`, `DigestHour`, `AppUrl` |

### Rujukan — hanya baca

| Sheet | Kolom | Peran |
|---|---|---|
| `warranty` | `SellingInDate` · `Material` · `Batch` · `Status` · `exp` · `Expired` | Tabel pengecualian untuk SN `XT`; kolom `Status` diabaikan |
| `Population` | `Delivery` · `SellingInDate` · `Material` · `ItemDescription` · `Batch` · `DeliveryQuantity` · `ShipToParty` · **`Principal`** | Sumber nama produk, **pemetaan principal**, dan daftar unit yang boleh diklaim (kolom `Batch`) |

Keduanya diperbarui lewat impor Excel dengan pratinjau perubahan.

## 11. State machine

### Status klaim

| Dari | Ke | Pelaku | Syarat |
|---|---|---|---|
| Draft | Submitted | Requester | Seluruh kolom wajib dan ketiga jenis lampiran lengkap |
| Submitted | Returned to Requester | Administrator | Alasan wajib · 📧 Requester |
| Returned | Submitted | Requester | Setelah revisi; RefNo mengikuti tanggal pengajuan ulang |
| Submitted | In Review | Administrator | **Work Order terisi**, **Principal terpetakan**, garansi principal masih berlaku |
| In Review | Submitted | Administrator | Tarik kembali; hanya bila belum ada keputusan |
| Submitted | Internal Verification | Administrator | Di luar garansi principal, atau SN berformat `C` |
| In Review | In Fulfilment | Principal | Seluruh item diputuskan · 📧 Requester & Administrator |
| Internal Verification | In Fulfilment | Administrator | Seluruh item diputuskan, sedikitnya satu disetujui |
| In Fulfilment | Closed | Administrator | Seluruh item yang disetujui sudah ditandai `Shipped` |
| mana pun | Closed | sistem | Seluruh item ditolak — tidak ada yang perlu dikirim |

### Status item

| Dari | Ke | Pelaku | Syarat |
|---|---|---|---|
| Pending | Approved / Rejected | Principal atau Administrator | Penolakan wajib beralasan |
| Approved / Rejected | keputusan sebaliknya | Principal | Kapan saja, alasan wajib, tercatat |
| Approved | Order Forwarded | Administrator | Email terkirim ke penerima terpilih |
| Order Forwarded | Awaiting Part Availability | Administrator | `AvailabilityDate` dan `DocumentRefNo` terisi |
| Awaiting Part Availability | Shipped | Administrator | Penandaan pengiriman |

Penanda `AdvanceIssued` **berdiri di luar rangkaian ini** — bisa dipasang atau dicabut kapan saja sebelum klaim ditutup, tanpa mengubah status item.

Kolom Status pada tabel menampilkan **posisi alur**; hasil keputusan tampil terpisah sebagai ringkasan seperti `2 approved · 1 rejected · 1 issued in advance`.

### Tab pada layar klaim

Tiga tab membagi habis pekerjaan, dan sisanya ada di **All**:

| Tab | Isinya |
|---|---|
| Needs Action | klaim yang menunggu peran yang sedang melihat |
| In Progress | belum selesai, dan tidak menunggu peran yang sedang melihat |
| Completed | `Closed` |

Aturannya harus membagi habis: setiap klaim yang terlihat oleh sebuah peran wajib masuk **tepat satu** dari ketiganya. Sebelumnya `Draft` dikecualikan dari In Progress untuk semua peran sekaligus sudah bukan Needs Action bagi Administrator — akibatnya draft tidak muncul di tab mana pun kecuali All, dan tidak ada yang menjelaskan kenapa. `tools/verify-tabs.js` menguji seluruh kombinasi peran × status × status item terhadap aturan ini.

## 12. Matriks hak akses

✓ dapat diubah · ○ hanya baca · — tidak ditampilkan · **R** perlu alasan tertulis

| Field | Requester | Production | Administrator | Principal |
|---|:--:|:--:|:--:|:--:|
| Customer | ✓ | ○ | ✓ | ○ |
| Serial Number | ✓ | ✓ | ✓ **R** | ○ |
| Problem description | ✓ | ✓ | ✓ | ○ |
| Baris sparepart & qty | ✓ | ✓ | ✓ | ○ |
| Foto part per baris | ✓ | ✓ | ✓ | ○ |
| Foto kerusakan · Service Report | ✓ | ✓ | ✓ | ○ |
| **Advance issue** | — | — | ✓ (s/d Closed) | ○ |
| **Principal klaim** | ○ | ○ | ✓ | ○ |
| Status garansi | ○ | ○ | ✓ **R** | ○ |
| Work Order | — | — | ✓ **R** | ○ |
| Keputusan per sparepart | ○ | ○ | ○ ¹ | ✓ **R** |
| Availability Date · Document Ref | ○ | ○ | ✓ | ○ |
| Shipped · Part Return | — | — | ✓ | ○ |
| Master data | — | — | ✓ | — |

¹ Administrator memutuskan hanya di jalur garansi internal.

Untuk Requester dan Production, kolom bertanda ✓ hanya dapat diubah selama status `Draft` atau `Returned to Requester`.

**Tiga aturan menyeluruh:**

1. Setiap perubahan setelah `Submitted` masuk `AuditLog` berikut nilai lama dan barunya.
2. Perbaikan oleh Administrator memicu email `CLAIM_AMEND` kepada Requester.
3. Penyimpanan memeriksa `RowVersion` lebih dulu; penyimpan kedua dihadang selisihnya, bukan ditimpa.

**Peran Tester** memakai matriks peran yang disamar, dengan dua pembatas: tombol aksi hanya hidup pada klaim bertanda `IsTest`, dan seluruh email dibelokkan ke penguji dengan subjek berawalan `[TEST]`.

## 13. Penomoran

| Nomor | Bentuk | Aturan |
|---|---|---|
| ClaimID | `CLM-260830-0012` | Unik per klaim. Dibuat saat draft pertama disimpan |
| RefNo | `CW300826` | Satu nomor per tanggal, global lintas rumah sakit. Diberikan saat **submit** |
| ItemID | `ITM-260830-0012-01` | Urut mengikuti baris pada formulir |
| AttachmentID | `ATT-260830-0031` | |
| EmailID | `EML-260830-0091` | Tercetak di kaki tiap email |
| Klaim uji | `TEST-260830-0002` / `CWT300826` | Seri terpisah agar tidak pernah masuk bulk sungguhan |

> **Draft dan penomoran bulk.** Draft yang dibuat 30 Agustus tetapi baru diajukan 2 September masuk bulk `CW020926`, bukan `CW300826`.

### Yang terlihat di panel klaim

Bagian **Evidence** selalu tampil, berisi setiap berkas yang seharusnya ada — foto kerusakan, service report, dan satu foto per baris sparepart — beserta berkas yang sudah terunggah atau penanda *not attached*. Menampilkan hanya yang sudah terunggah menyembunyikan separuh yang lebih berguna: klaim tanpa lampiran tidak memunculkan bagian apa pun, dan itu terbaca sebagai "layar ini tidak menampilkan berkas", bukan "belum ada berkas". Lampiran yang tidak cocok dengan slot mana pun — misalnya foto milik baris sparepart yang sudah dihapus — tetap ikut terdaftar.

Unggahan yang gagal tidak menghentikan berkas berikutnya dan tidak pernah senyap: klaimnya tetap tersimpan, jadi berkas yang hilang tanpa pemberitahuan akan meninggalkan klaim yang tampak lengkap tetapi tidak bisa di-submit. Nama berkas yang gagal disebutkan, dan langkahnya ditandai merah di jendela penyimpanan.

## 14. Berkas Drive

```
📁 Klaim/
   📁 CW300826/                             ← bulk harian
      📁 CLM-260826-0004/                   ← satu klaim
         📁 01-PART/
            CW300826_CLM-260826-0004_XT2410090_PART-01_ELECTRICAL-MAINBOARD.jpg
         📁 02-FAULT/
            CW300826_CLM-260826-0004_XT2410090_FAULT.jpg
         📁 03-REPORT/
            CW300826_CLM-260826-0004_XT2410090_REPORT.pdf
   📁 _UJI/     CWT300826/…
   📁 _DRAFT/   CLM-260826-0007/…
```

Pola nama: `{RefNo}_{ClaimID}_{SN}_{JENIS}[-{nn}][_{NAMA-PART}].{ext}`

| Aturan | Rincian |
|---|---|
| Pembersihan nama part | Huruf besar semua; spasi, koma, garis miring, dan tanda kurung menjadi `-` |
| Panjang | Nama terpanjang menghasilkan 101 karakter — aman terhadap batas 255 Drive |
| Unggah ulang | Tidak menimpa; berkas baru diberi akhiran `_v2`, `_v3` |
| Draft | Disimpan di `_DRAFT`; saat submit, folder dipindah dan berkasnya diganti nama |
| Urutan folder | Awalan angka menjaga urutan mengikuti alur, bukan abjad |

> **Izin berkas.** Berkas Drive **tidak pernah dibagikan kepada siapa pun**. Aplikasi berjalan sebagai pemilik dan menyajikan sendiri gambarnya ke layar, sehingga Principal di luar organisasi tetap dapat melihat bukti tanpa satu pun berkas terbuka ke publik.

## 15. Email

Tujuh template, seluruhnya diarsipkan di `EmailLog`.

| Kode | Pemicu | Penerima |
|---|---|---|
| `CLAIM_SUBMIT` | Requester menekan Submit | Administrator |
| `DAILY_DIGEST` | 17:00 WIB atau tombol *Send Digest Now* | **Principal terkait saja** |
| `DECISION_REQ` | Principal memutuskan | Requester |
| `DECISION_ADM` | Principal memutuskan | Administrator |
| `ORDER_FORWARD` | Administrator meneruskan pesanan | Daftar `Recipients` |
| `CLAIM_RETURN` | Administrator mengembalikan klaim | Requester |
| `CLAIM_AMEND` | Administrator memperbaiki klaim | Requester |

### Kerangka yang dikunci

```
┌─ DIKUNCI ────────────────────────────────────────┐
│ Judul · Ref. {{RefNo}} · Generated {waktu} WIB   │
│ [ tombol tautan pintas ]                         │
├─ BADAN — dapat disunting Administrator ──────────┤
│                                                  │
├─ DIKUNCI ────────────────────────────────────────┤
│ Automatically generated record · do not reply    │
│ Template {kode} v{versi} · Log ref {{EmailID}}   │
└──────────────────────────────────────────────────┘
```

Placeholder wajib tidak dapat dihapus; penyimpanan template tanpa placeholder tersebut ditolak beserta alasannya.

| Kode | Placeholder wajib |
|---|---|
| `CLAIM_SUBMIT` | `{{ClaimID}}` `{{WarrantyBasis}}` |
| `DAILY_DIGEST` | `{{ClaimID}}` `{{RefNo}}` `{{WarrantyBasis}}` |
| `DECISION_REQ` · `DECISION_ADM` | `{{ClaimID}}` |
| `ORDER_FORWARD` | `{{ClaimID}}` `{{RefNo}}` |
| `CLAIM_RETURN` | `{{ClaimID}}` `{{ReturnReason}}` |
| `CLAIM_AMEND` | `{{ClaimID}}` `{{#Changes}}` |

Placeholder `{{Principal}}` tersedia di semua template; `{{AdvanceIssue}}` di dalam bagian `{{#Items}}` berisi *already supplied from local stock* bila part sudah ditalangi, dan kosong bila tidak.

Perulangan: `{{#Items}}…{{/Items}}` untuk daftar sparepart, `{{#Claims}}…{{/Claims}}` untuk rekap harian, `{{#Changes}}…{{/Changes}}` untuk daftar perubahan.

**Rekap harian dipecah per principal per nomor referensi.** Klaim yang principal-nya belum terpetakan tidak ikut terkirim dan dilaporkan sebagai *skipped*.

## 16. Audit

Tiga lapis jejak, masing-masing menjawab pertanyaan berbeda.

| Lapis | Menjawab | Isi |
|---|---|---|
| `AuditLog` | Siapa mengubah apa, kapan, kenapa | Satu baris per field yang berubah, identitas asli pelaku |
| `EmailLog` | Apa yang benar-benar dikirim dan diterima siapa | Salinan isi email, penerima sebenarnya, versi template |
| `Attachments` | Bukti apa yang dilihat saat keputusan dibuat | Seluruh versi berkas; unggahan ulang tidak menimpa |

Empat hal yang menopang ketiganya:

- **Tidak ada penghapusan permanen** selain pembersihan klaim uji oleh Tester.
- **Dasar perhitungan garansi ikut disimpan dan dicetak** sebagai kalimat penuh.
- **Salinan nama saat pengajuan** membuat klaim lama tetap terbaca seperti saat diputuskan.
- **Identitas asli selalu yang dicatat**, termasuk saat Tester menyamar.

## 17. Batasan Apps Script

| Hal | Batas | Penanganan |
|---|---|---|
| Latensi tiap panggilan | 2–5 detik | Stepper bertahap saat submit, skeleton pada tabel |
| Unggahan berkas | base64 membengkak ±33% | Foto dikecilkan di browser — maks 1600px, kualitas 85%, ±300 KB |
| Kuota email | 100/hari akun biasa · 1.500/hari Workspace | Rekap harian menekan jumlah email |
| Waktu jalan skrip | 6 menit per eksekusi | Impor unit diproses berbatch |
| Penulisan bersamaan | Tidak ada transaksi | `LockService` saat menulis; baris dicari lewat ID, bukan nomor baris |
| Pembacaan sheet | Lambat bila per sel | `getValues` sekaligus; master data di `CacheService` |
| Ekspor Excel | Tidak bisa memicu unduhan dari iframe | Berkas dibuat di Drive lalu tautannya dibuka di tab baru |
| Verifikasi token | ±200–400 ms per panggilan | Hasil disimpan di cache selama sisa masa token |

### Pemicu terjadwal

| Pemicu | Waktu | Tugas |
|---|---|---|
| `sendDailyDigest` | 17:00 WIB | Mengirim rekap per principal bila ada klaim yang belum diberitahukan |
| `dailyMaintenance` | 01:00 WIB | Menghapus ekspor >7 hari, menyalin cadangan spreadsheet |

## 18. Migrasi data

| Langkah | Tindakan |
|---|---|
| Master Customer | 1.386 nama diberi `CustomerID`; ditambah `Internal — Production` |
| Master sparepart | 78 nama diberi `PartID`; empat nama yang hanya muncul di `Log` ditambahkan |
| Master Principals | Satu entri `Sansin` dibuat otomatis; sisanya ditambah lewat Master Data |
| Riwayat klaim | 20 baris `Log` dipecah menjadi `Claims` dan `ClaimItems`; RefNo lama dipertahankan |
| Pemetaan principal | Diambil dari kolom `Principal` di `Population`; yang kosong dilaporkan jumlahnya |
| Nama yang tidak cocok | Disimpan sebagai salinan nama tanpa rujukan `PartID` |
| Data uji lama | Baris `qwerty` dan sejenisnya dipertahankan, ditandai `IsTest` |
| Unit | `warranty` dan `Population` disalin apa adanya |

## 19. Pengujian

Enam penguji berjalan di Node tanpa perlu Google, dan menjalankan kode aslinya:

```bash
node tools/verify-warranty.js units.json    # mesin garansi, 2.610 unit asli
node tools/verify-access.js                 # pemisahan antar principal
node tools/verify-templates.js              # perender template email
node tools/verify-sheets.js                 # baris data tidak dibaca sebagai judul kolom
node tools/verify-payload.js                # tidak ada Date yang lolos ke browser
node tools/verify-tabs.js                   # tidak ada klaim yang lolos dari semua tab
```

Hasil terakhir: **22 · 27 · 18 · 25 · 13 · 179 pemeriksaan, seluruhnya lolos.**

Penguji payload menjaga satu kegagalan yang sangat mudah terulang. `google.script.run` menolak `Date` di mana pun dalam nilai kembalian — panggilannya gagal dan halaman menerima `null`, tanpa pesan kesalahan apa pun. Aplikasi ini menulis stempel waktunya sebagai teks `2026-08-30T11:53:50`, dan Sheets berhak menyimpannya sebagai date-time sungguhan lalu mengembalikannya sebagai `Date`. Karena itu `readAll_` mengubah setiap sel `Date` menjadi teks ISO saat dibaca (`cellValue_`), dan `api()` memeriksa sekali lagi sebelum nilainya menyeberang ke browser (`jsonSafe_`). Konversi saat baca sekaligus memperbaiki urutan dan filter tanggal, yang membandingkan stempel waktu sebagai teks.

## 20. Masih terbuka

Nilai bawaan berikut saya putuskan sendiri. Mudah diubah, tidak menghalangi pemakaian, tapi sebaiknya ditegaskan.

| Hal | Nilai bawaan |
|---|---|
| Yang dilihat Principal | Klaim principal-nya dengan status `In Review` ke atas, termasuk yang selesai |
| Aturan garansi per principal | Belum ada — masih ditentukan format serial number saja |
| Format Work Order | Teks bebas, tanpa pola yang dipaksakan |
| Batas ukuran berkas | 10 MB per berkas sebelum dikompres |
| Ambang kolom Age | Oranye setelah 3 hari, merah setelah 7 hari |
| Masa simpan berkas ekspor | 7 hari |
| Tarik kembali dari principal | Diizinkan Administrator selama belum ada keputusan |
| Kirim rekap sekarang | Tersedia bagi Administrator |
| Sparepart talangan | Penanda saja, tanpa pembukuan stok |
