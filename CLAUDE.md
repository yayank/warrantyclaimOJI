# Warranty Claim Portal — cara kerja di repo ini

Portal klaim garansi sparepart alat medis. Google Apps Script + Google Sheets,
satu web app, tanpa framework dan tanpa build step selain `tools/bundle.js`.

Berkas ini ada supaya sesi berikutnya tidak perlu menemukan ulang hal-hal yang
sudah diputuskan. **Baca ini dulu, jangan jelajahi repo dari nol.**

Lalu baca **`docs/business-context.md`** sebelum mengusulkan perubahan apa pun
pada model data atau alur kerja: siapa pemakainya, dua tingkat garansi, aturan
akses, dan skalanya. Itu hasil wawancara dengan pemilik repo, bukan tebakan.
Rancangan yang menyusul ada di **`docs/warranty-model.md`** (usulan, belum
dikerjakan).

## Bahasa

Jawab dalam **Bahasa Indonesia**, dan tulis deskripsi PR dalam Bahasa Indonesia
juga — seluruh isi PR #1 memang berbahasa Indonesia. Komentar kode dan pesan
commit dalam **Bahasa Inggris**. Itu konvensi yang sudah berjalan; jangan diubah.

Ringkas. Laporkan yang berubah dan kenapa; jangan mengulang isi diff, jangan
membuat daftar berkas yang disentuh kecuali diminta.

## Peta berkas

| Berkas | Isi |
|---|---|
| `src/Code.gs` | `doGet`, dispatcher API tunggal (`route_`), `jsonSafe_` |
| `src/Auth.gs` | `resolveSession_`, `visibleClaims_`, `requireRole_` |
| `src/Repo.gs` | akses sheet: `readAll_`, `update_`, `setCell_`/`setCells_`, `withLock_`, cache berpotongan |
| `src/Config.gs` | `SCHEMA`, `ROLE`, `STATUS`, `ITEM_STATUS`, semua konstanta |
| `src/Claims.gs` | daftar klaim, aturan tab, transisi, aksi massal, kolom ringkasan — **berkas terbesar, 1.800 baris** |
| `src/Warranty.gs` | jaring pengaman garansi 22 bulan dari serial, indeks unit |
| `src/WarrantyRules.gs` | aturan garansi per model dari sheet, dua tingkat, `resolveWarranty_` |
| `src/Units.gs` | register unit: kolom garansi, `parseLocalDate_` (dd/mm/yyyy), `recomputeUnitWarranty_`, `listUnits_`, `saveUnit_`, pratinjau + impor CSV |
| `src/Audit.gs` | jejak audit + arsip per tahun |
| `src/Visits.gs` | stempel kunjungan, penanda "baru sejak terakhir dilihat" |
| `src/Views.gs` | saved views per orang |
| `src/Reports.gs` | laporan biaya garansi yang kita serap — `costReport_`, `exportCostReport_` |
| `src/Mailer.gs` · `Files.gs` · `Export.gs` · `Triggers.gs` · `MasterData.gs` · `Setup.gs` | sesuai namanya |
| `src/Script.html` | **seluruh klien**, 4.300 baris, satu `<script>` |
| `src/Styles.html` | CSS, terang dan gelap, kartu di bawah 700px |
| `dist/` | hasil bundle — **jangan pernah disunting** |

## Aturan kerja

1. **Sunting `src/`, lalu `node tools/bundle.js`.** Bundler menolak berkas `.gs`
   baru yang belum didaftarkan di `ORDER` — daftarkan.
   **Hati-hati memotong blok dari sebuah berkas.** Pernah terjadi: memotong satu
   fungsi ikut membawa empat fungsi lain, dan suite tetap hijau karena tidak ada
   penguji yang memanggil rutenya. `verify-sheets.js` sekarang memeriksa bahwa
   setiap fungsi yang dirutekan `route_` benar-benar ada; jalankan itu setelah
   menghapus apa pun.
2. **Jalankan seluruh suite sebelum commit.** Semua penguji di `tools/`, kecuali
   `verify-warranty.js` yang butuh `units.json` (tidak ada di repo).
3. **Setiap penguji baru harus dibuktikan menangkap bug-nya** — kembalikan
   perbaikannya sementara, jalankan, pastikan gagal, kembalikan lagi. Laporkan
   berapa bug yang dikembalikan dan apa yang gagal. Ini konvensi keras di repo
   ini; penguji yang tidak dibuktikan tidak dianggap selesai.
4. **Commit per permintaan**, pesan berbentuk prosa yang menjelaskan *kenapa*.
5. Branch: `claude/warranty-claim-searchable-dropdowns-2v0b4k`. PR #1.
6. **Jangan buat PR baru** kecuali diminta.

## Jebakan Apps Script yang sudah memakan waktu

Semuanya pernah menghabiskan satu sesi. Jangan ulangi.

- **`google.script.run` menolak `Date`** di mana pun dalam nilai kembalian:
  panggilannya gagal diam-diam dan halaman menerima `null`. `cellValue_` dan
  `jsonSafe_` menjaganya. Sheets berhak membaca teks ISO sebagai date-time.
- **`executeAs: USER_DEPLOYING`** — `PropertiesService.getUserProperties()`
  adalah milik orang yang men-deploy, untuk **semua** pengunjung. State per orang
  disimpan pada properti **skrip** dengan alamat sebagai kunci. Lihat `Views.gs`.
- **`=QUERY()` tidak bisa dipanggil dari skrip.** Endpoint `gviz/tq` bisa, tapi
  tidak punya JOIN, dan satu `claims.list` butuh tiga jawaban — sudah ditimbang
  dan ditolak, jangan diusulkan lagi.
- **Satu entri `CacheService` maksimal 100KB**; `put` yang kelebihan melempar
  diam-diam. Pakai `cachePutLarge_`.
- **`sheet_()` melempar** kalau sheet tidak ada. Untuk sheet yang boleh belum ada
  (arsip audit) pakai `readSheetRows_`.
- **Batas eksekusi 6 menit.** Operasi massal berulang di server dalam satu
  eksekusi, bukan satu perjalanan per baris dari browser.

## Yang mahal di sini adalah baca sheet

Bukan payload, bukan CPU. Satu `claims.list` membaca sheet `Claims` utuh
(~16.500 sel pada 412 klaim). Ukur sebelum dan sesudah dengan:

```
node tools/measure-list.js [jumlah-klaim] [item-per-klaim]
```

Aturan yang sudah berlaku:

- Aturan tab dijawab dari **kolom ringkasan** pada baris `Claims`, bukan dari
  `ClaimItems`. Kolomnya dipelihara oleh `refreshClaimSummaries_` /
  `writeClaimSummary_`, **selalu hitung ulang dari itemnya, tidak pernah
  menambah/mengurangi**. Setiap jalur yang menulis `ClaimItems` wajib menghitung
  ulang — `verify-summary.js` membaca `Claims.gs` sebagai teks untuk memaksanya.
- `setCells_` menulis tanpa menaikkan `RowVersion`. Angka yang dihitung server
  sendiri bukan suntingan siapa pun.
- Paging **opt-in** (`limit`). Default halaman akan diam-diam memotong ekspor
  Excel jadi 50 baris yang tampak lengkap.
- `listClaims_` menerima `items: 'all' | 'page' | 'none'`; defaultnya `'all'`
  karena layar Orders dan ekspor butuh part tiap baris.

## Keputusan yang sudah diambil — jangan diubah tanpa diminta

- **Baris sparepart tetap digambar di bawah tiap klaim** walaupun itu berarti
  daftar tetap membaca `ClaimItems` (−46% sel tersedia kalau tidak). Pemilik repo
  memilih begitu, 12 Sep 2026.
- **Tahap 3 butir D (`gviz/tq`) ditolak.** Alasannya di `docs/backlog.md`.
- **Unit di luar `Population` DITOLAK saat submit** — membatalkan bagian 2
  deskripsi PR #1. Sudah dikerjakan (butir M): klaimnya tetap tersimpan sebagai
  draft lengkap dengan lampirannya, satu baris masuk `UnitRequests`, dan
  Administrator diberi tahu lewat email **dan** antrean. `resolveUnitRequests_`
  menutup permintaan itu dari **keempat** jalur unit bisa masuk — jangan
  gantungkan ke satu pemanggil saja.
- **Tanggal impor selalu `dd/mm/yyyy`.** Lewat `parseLocalDate_` di `Units.gs`,
  tidak pernah lewat `new Date()`. `03/09/2025` adalah 3 September, dan
  `new Date()` membacanya 9 Maret. Yang tersimpan di sheet adalah ISO —
  dinormalkan saat masuk, bukan saat dibaca.
- **Impor workbook principal hanya boleh menyentuh kolom yang dibawa berkasnya.**
  Berkas itu tidak tahu apa-apa tentang `Channel`, `InstalledAt`, atau kolom
  garansi terhitung; mengosongkan seluruh baris sebelum menulis balik akan
  menghapus semuanya, diam-diam, setiap kali impor.
- **`WarrantyType` berarti sisi principal**, bukan sisi pembeli. Garansi kita ke
  pembeli ada di `CustomerWarranty*`. Jangan tumpangkan artinya.
- **Principal tidak boleh menerima satu pun field sisi customer, termasuk nama
  distributornya** — itu jalur dagang kita, bukan urusan mereka. Daftar
  fieldnya di `CUSTOMER_SIDE_FIELDS` (`Claims.gs`), disaring dua kali:
  `listClaims_`/`getClaim_` — karena **ekspor Excel ditulis di server dan tidak
  pernah lewat dispatcher** — dan sekali lagi di `api()` untuk apa pun yang
  ditulis nanti. Menambah field sisi customer berarti menambahnya ke daftar itu.
- **Antarmuka tetap Bahasa Inggris.** Ditanyakan 12 Sep 2026, dijawab tidak
  perlu diterjemahkan. Jangan usulkan lagi.
- **Laporan menghitung jumlah, bukan rupiah.** Tidak ada harga di portal ini.
  Menambahkan nilai uang dimulai dari master `sparepart`, dan itu butir
  tersendiri — jangan diselundupkan ke laporan mana pun.
- Dashboard, grafik, notifikasi realtime, aplikasi mobile terpisah: sudah
  ditimbang dan tidak disarankan.

## Kalau diminta mengerjakan butir backlog

`docs/backlog.md` berisi prompt siap-tempel. **A–N selesai; O belum** (akun
distributor satu per perusahaan).
Gelombang H–N adalah model garansi dua tingkat; rancangannya di
`docs/warranty-model.md`, latar belakangnya di `docs/business-context.md`.
Setiap butir mencatat koreksi terhadap promptnya sendiri kalau promptnya keliru
— beberapa memang keliru. Kalau ada butir baru, tulis catatan koreksi yang sama
bila menemukan promptnya salah.

## Dokumentasi

`README.md` (ikhtisar + daftar penguji), `docs/business-context.md` (latar
belakang bisnis — baca lebih dulu), `docs/warranty-model.md` (rancangan model
garansi dua tingkat, usulan), `docs/specification.md` (aturan bisnis),
`docs/deployment.md`, `docs/architecture.md`, `docs/ui-mockups.html`,
`docs/test-plan.md` (uji terima di data asli dengan akun Tester). Perbarui
daftar penguji di README saat menambah penguji.
