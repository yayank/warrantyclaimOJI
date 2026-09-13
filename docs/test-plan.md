# Uji terima — portal setelah gelombang garansi dua tingkat

Dipakai **di data asli, dengan akun Tester**, sesuai keputusan pemilik repo
13 September 2026. Bentuknya menyusul `docs/backlog.md`: butir pendek yang bisa
ditempel, bukan naskah panjang.

**Cara memakai berkas ini.** Kerjakan satu butir, lalu tempel barisnya ke sesi
Claude kalau hasilnya tidak seperti yang tertulis — misalnya
*"uji 12 gagal: principal masih melihat kolom distributor"*. Saya yang menelusuri
dan memperbaikinya; berkas ini hanya perlu memberi tahu Anda **apa yang dilihat**
dan **apa yang seharusnya**.

---

## Sebelum mulai

**Mode Tester itu apa, dan sampai mana ia melindungi.**

Akun dengan `Role = Tester` di sheet `users` bisa memakai portal sambil
berpura-pura jadi peran lain, dan setiap klaim yang ia buat ditandai
`IsTest = TRUE`. Yang dilindungi:

- Klaim uji **tidak terlihat** oleh siapa pun selain Tester — `visibleClaims_`
  menyaringnya untuk semua peran lain.
- Email dari klaim uji **dialihkan ke alamat Tester sendiri** dan subjeknya
  diawali `[TEST]`. Administrator dan principal sungguhan tidak menerima apa pun.

**Yang TIDAK dilindungi, dan ini yang perlu Anda pegang:**

| Menyentuh | Ada mode uji? | Artinya |
|---|---|---|
| Klaim | **Ya** | aman, buat sebanyaknya |
| Master data (customer, sparepart, users, recipients, principals) | Tidak | perubahan langsung berlaku |
| **Products, Warranty Rules, Distributors** | Tidak | aturan yang Anda simpan langsung menjawab klaim sungguhan |
| **Register unit** (`Population`) | Tidak | sunting satu unit langsung mengubahnya |
| Impor CSV dan impor workbook principal | Tidak | **paling merusak — lihat uji 20** |

Jadi urutan di bawah sengaja: uji klaim dulu (aman), baru data (tidak aman),
dan yang merusak ditaruh terakhir dengan cara paling aman yang bisa saya susun.

**Siapkan dulu:**

1. Satu akun `Tester` di sheet `users` — alamat Anda sendiri.
2. Jalankan `setUp()` sekali dari editor Apps Script setelah deploy.
3. Catat berapa baris ada di `Population` hari ini. Angka itu dipakai di uji 20.

---

## Bagian 1 · Yang aman: klaim

> Semua di bagian ini pakai akun Tester. Klaimnya bertanda `IsTest` dan tidak
> terlihat siapa pun selain Anda.

**1 · Klaim biasa, ujung ke ujung.** Sebagai Tester berperan Requester: buat
klaim, isi semuanya, lampirkan foto kerusakan + laporan servis + foto part,
submit. → Dapat nomor referensi, muncul di daftar, email `[TEST]` masuk ke
alamat Anda sendiri.

**2 · Klaim yang belum lengkap ditolak sebelum disimpan.** Submit tanpa foto
part. → Formulir menyebut apa yang kurang di bagian atas, **sebelum** apa pun
tersimpan.

**3 · Unit tak terdaftar.** Ketik serial number yang tidak ada di `Population`.
→ Peringatan muncul **begitu serial diketik**, bukan setelah formulir diisi.
Lanjutkan mengisi dan tekan Submit → layarnya bilang "Saved — waiting for the
unit to be registered", klaimnya jadi draft **lengkap dengan fotonya**, dan
email `[TEST]` permintaan pendaftaran masuk.

**4 · Antreannya.** Master Data → Registration Requests. → Permintaan uji 3 ada
di sana dengan serial, rumah sakit, dan keluhan yang Anda tulis.

**5 · Lingkarannya tertutup.** Dari antrean itu tekan **Register** → formulir
unit terbuka dengan serial number **sudah terisi**. Simpan. → Permintaannya jadi
`Registered`, email masuk ke pengaju, dan draft uji 3 **bisa langsung disubmit
tanpa mengetik ulang apa pun**.

> Unit yang baru Anda daftarkan itu unit sungguhan di `Population`. Kalau
> serialnya karangan, hapus barisnya setelah selesai.

**6 · Menolak permintaan.** Buat lagi permintaan seperti uji 3, lalu **Turn
down** dengan alasan. → Tanpa alasan ditolak. Dengan alasan: permintaan tertutup,
email berisi alasannya masuk, dan **draftnya tetap ada**.

**7 · Dua klaim satu mesin satu hari.** Submit dua klaim untuk serial yang sama
di hari yang sama. → Yang kedua **digabung** ke yang pertama; partnya bertambah,
bukan jadi dua klaim.

**8 · Aksi massal.** Centang beberapa klaim di daftar → bilah aksi muncul.
Centang klaim dengan dua status berbeda → bilahnya **menjelaskan kenapa** tidak
ada yang ditawarkan, bukan sekadar kosong.

**9 · Penanda "moved".** Tinggalkan portal lebih dari 30 menit, minta orang lain
(atau akun lain) mengubah sebuah klaim, buka lagi. → Klaim itu bertanda, dan
barisnya menyebut jumlahnya. Perubahan **Anda sendiri** tidak pernah bertanda.

**10 · Ekspor.** Export to Excel dari daftar yang sudah disaring. → Jumlah baris
di berkasnya sama dengan jumlah di layar, **bukan 50**.

---

## Bagian 2 · Garansi dua tingkat

> Butuh minimal satu `Products` + satu aturan di `WarrantyRules`. Pakai model
> yang aturannya sudah pasti — apa yang Anda simpan berlaku untuk klaim
> sungguhan atas model itu.

**11 · Aturan pertama.** Master Data → Products, tambah satu model. Lalu
Warranty Rules, tambah aturan sisi `principal`. → Simpan, lalu buka unit model
itu di Master Data → Units. Kolom garansinya **sudah berubah**, tanpa perlu
menjalankan apa pun.

**12 · Principal tidak melihat sisi kita.** Masuk sebagai Tester berperan
Principal, buka klaim atas unitnya. → **Tidak ada** kolom atau pil "Ours to…",
tidak ada penanda "We absorb", **dan tidak ada nama distributor**. Ekspor Excel
sebagai principal → kolom-kolom itu tidak ada di berkasnya sama sekali.

**13 · Tanggal dibaca hari-dulu.** Di formulir unit, isi tanggal instalasi
`03/09/2026`. → Tersimpan sebagai **3 September**, bukan 9 Maret. Coba
`09/13/2026` → ditolak dengan menyebut "no month 13".

**14 · Yang belum bisa dijawab bilang begitu.** Buka unit yang belum punya
tanggal instalasi padahal aturannya menghitung dari situ. → Kolom "Still needed"
menyebut **tanggal apa** yang kurang, bukan "perlu diperiksa".

**15 · Aturan yang bertabrakan ditolak.** Buat aturan kedua untuk model, sisi dan
channel yang sama dengan periode yang bersinggungan. → Ditolak, **menyebut
aturan mana** yang bertabrakan. Aturan `*` bersama aturan yang menyebut channel
tetap **boleh** — itu bentuk "aturan umum + satu pengecualian".

**16 · Laporan biaya.** Menu Cost Borne. → Angkanya cocok dengan daftar klaim di
bawahnya. Ganti rentang tanggal ke satu bulan penuh → klaim di **hari terakhir
bulan itu** ikut terhitung.

---

## Bagian 3 · Mengisi data unit

> Tidak ada mode uji di sini. Kerjakan pada beberapa unit dulu, bukan semuanya.

**17 · Sunting satu unit.** Master Data → Units, cari satu unit, isi `Channel`
dan `InstalledAt`. → Kolom garansinya berubah saat itu juga, dan perubahannya
ada di Audit Log.

**18 · Daftar pekerjaan.** Centang "Only units still missing something", lalu
persempit ke satu distributor. → Yang tersisa adalah unit distributor itu saja,
masing-masing menyebut apa yang kurang. **Itu isi satu email ke distributor
tersebut.**

**19 · Impor CSV, berhenti di pratinjau.** Siapkan CSV berisi 5 unit, satu di
antaranya sengaja diberi tanggal salah (`31/02/2026`) dan satu serial yang tidak
ada di register. Tekan **Check the file** — **jangan** tekan Write. → Barisnya
ditolak **dengan nomor baris dan alasannya**, dan pesannya bilang tidak ada yang
ditulis sampai semua baris diterima. Periksa unitnya di Sheets: **belum berubah**.
Baru setelah itu perbaiki CSV-nya dan tekan Write.

---

## Bagian 4 · Yang paling merusak

**20 · Impor workbook principal.** Ini yang pernah menghapus data.

> **Salin sheet `Population` ke tab cadangan lebih dulu.** Catat jumlah barisnya.

Sebelum impor, pastikan ada minimal satu unit yang sudah Anda isi `Channel` dan
`InstalledAt`-nya (dari uji 17). Lalu impor workbook principal seperti biasa.

→ Setelah impor: buka unit itu. **`Channel` dan `InstalledAt` harus masih ada**,
dan kolom garansinya masih terisi. Jumlah baris `Population` sesuai isi
workbook-nya.

Kalau kolom itu kosong: **berhenti, jangan impor lagi**, dan bilang ke saya.
Itu bug yang sudah diperbaiki sekali; kalau kembali, berarti perbaikannya tidak
mengenai jalur yang Anda pakai.

---

## Yang sengaja tidak ada di sini

- **Beban 2.610 unit dan 1.386 customer** — tidak bisa diuji dari daftar
  periksa; sudah diukur lewat `tools/measure-list.js` dan `verify-cache.js`.
- **Layar di HP** — sudah diukur pada empat lebar layar, terang dan gelap.
- **Batas 6 menit** pada impor 2.610 baris. Uji 19 memakai 5 baris; ukuran penuh
  baru terbukti saat impor sungguhan. Kalau berhenti di tengah, gelombangnya
  utuh sendiri-sendiri — yang sudah ditulis sudah benar.
