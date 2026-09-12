# Latar belakang dan tujuan

Berkas ini menjawab pertanyaan yang tidak bisa dijawab dengan membaca kode:
**siapa yang memakai portal ini, kenapa, dan aturan bisnis apa yang berlaku di
belakangnya.** Isinya hasil wawancara dengan pemilik repo (Manager After Sales
Service) pada 12 September 2026, bukan tebakan.

Baca ini sebelum mengusulkan perubahan apa pun pada model data atau alur kerja.

---

## Perusahaannya

Pabrikan **dan** distributor alat kesehatan, menangani **AKD** (alat kesehatan
dalam negeri, produksi sendiri) maupun **AKL** (alat kesehatan luar negeri,
dari principal). Perbedaan AKD/AKL menyangkut izin edar, bukan aturan garansi.

## Empat pihak

| Pihak | Perannya | Login? |
|---|---|---|
| **Principal** | Pabrikan asal untuk produk AKL. Menyetujui atau menolak klaim atas unitnya, dan memasok sparepart penggantinya. Multi-principal, tiap principal punya kebijakan garansi sendiri | Ya |
| **Perusahaan (kita)** | Pabrikan untuk AKD, distributor untuk AKL. Menjual langsung ke end customer **atau** lewat distributor | Ya — Administrator dan field service |
| **Distributor** | Menjual dan memasang alat ke rumah sakit. Punya field service sendiri | Ya — **satu akun per distributor** |
| **Rumah sakit (end user)** | Pemakai alatnya | **Tidak pernah login** |

Rumah sakit tidak punya akses. Setiap catatan UX yang mengasumsikan "layar
rumah sakit" salah sasaran — yang berdiri di depan alat rusak adalah field
service, entah milik kita atau milik distributor.

## Dua jalur penjualan

```
                     ┌─────────────────────────► rumah sakit   (jalur langsung)
principal ──► kita ──┤
                     └──► distributor ─────────► rumah sakit   (jalur distributor)
```

Jalur itu menentukan dari tanggal apa garansi ke end user dihitung — lihat di
bawah.

## Dua tingkat garansi, bukan satu

Ini yang paling sering salah dimodelkan, dan portal versi pertama memang salah.

1. **Principal → kita.** Apakah principal masih menanggung unit ini.
2. **Kita → pembeli** (distributor atau rumah sakit langsung). Apakah kita masih
   menanggungnya.

**Tanggal keduanya sering berbeda.** Yang paling mahal adalah kotak ini:

|  | Principal masih menanggung | Principal sudah habis |
|---|---|---|
| **Pembeli masih bergaransi** | normal, klaim diteruskan | **biaya yang kita serap** |
| **Pembeli sudah habis** | terjadi kalau barang lama di gudang | jual sparepart biasa |

Kotak kanan-atas adalah angka yang ditanya direksi dan yang hari ini tidak bisa
dijawab portal.

Garansi distributor→rumah sakit **tidak** dicatat di portal ini. Itu urusan
distributor. Jadi: dua tingkat, bukan tiga.

## Aturan garansi

- **Tiap model produk punya masa garansinya sendiri.** Tidak ada pola baku.
- Bisa **ditimpa per kontrak** — per pelanggan, per tender, atau lewat paket
  pembelian yang memuat *extended warranty*.
- **Extended warranty memundurkan dua sisi**, bukan hanya sisi customer.
  Disimpan **per unit**.
- **Dasar hitungnya berbeda-beda**, karena tiap principal punya kebijakan
  sendiri. Keempat dasar ini semuanya berlaku di portofolio:
  - bulan perakitan (dibaca dari serial number)
  - tanggal *selling-in* (barang dikirim principal ke kita)
  - tanggal barang diterima distributor
  - tanggal instalasi / BAST / berita acara uji fungsi di rumah sakit
- **Polanya ditentukan produk, bukan distributor.** Satu produk punya aturan
  yang sama ke mana pun ia dijual — yang berbeda hanyalah tanggal mana yang
  tersedia untuk jalur itu.
- Jalur langsung ke end customer: dasarnya BAST / BA uji fungsi.

## Dari mana tanggalnya datang

Diisi Administrator ke master unit, dan diimpor dari sistem lain (ERP/Excel).
Bukan dari field service.

**Ada sistem lain di luar portal ini yang mencatat instalasi.** Administrator
memperbarui sistem itu lebih dulu, baru unitnya masuk ke portal.

## Unit yang tidak terdaftar

Keputusan ini **berubah** pada 12 September 2026, membatalkan bagian 2
deskripsi PR #1.

Sebelumnya: serial number di luar `Population` diterima dan ditandai untuk
pemeriksaan manual, dengan alasan "mesin di lapangan tidak menunggu sheet
diperbarui".

Sekarang: **submit ditolak**, karena
1. ada sistem pencatatan instalasi di luar portal yang harus diperbarui dulu, dan
2. ini bentuk edukasi ke distributor agar melaporkan unit yang mereka pasang.

Tetapi pekerjaan lapangan tidak boleh hilang. Yang benar:
**klaimnya tersimpan sebagai draft, dan satu permintaan pendaftaran unit
terkirim ke Administrator** — lengkap dengan serial, foto, dan lokasinya.
Begitu admin mendaftarkan unitnya, draft itu bisa diteruskan.

## Akses

| Peran | Melihat apa |
|---|---|
| Administrator | Semuanya |
| Field service kita | **Hanya klaim yang dia sendiri ajukan** |
| Distributor (satu akun) | **Hanya klaim dari akun itu** |
| Principal | Klaim atas unit principal-nya, garansi principal, status In Review ke atas |

Distributor **tidak boleh** melihat klaim requestor lain **walaupun di rumah
sakit yang sama** — produk berbeda bisa dipegang distributor berbeda, dan bisa
jadi justru kita yang bertanggung jawab atas alat lain di RS itu.

Klaim harus menyebut **distributor dan rumah sakit sekaligus** ketika alatnya
dijual lewat distributor.

Akun distributor adalah akun perusahaan, bukan akun orang. Orang di baliknya
boleh berganti; riwayat klaimnya tetap terlihat.

## Skala

20–100 model produk. 10–50 distributor. ~2.610 unit di `Population` hari ini,
~1.386 rumah sakit di master `Customer`.

Cukup besar untuk butuh impor massal, cukup kecil untuk tetap muat di Sheets.

## Tujuan portal ini

Satu tempat di mana:

1. Field service — milik kita atau milik distributor — mengajukan klaim
   sparepart dan tahu di mana klaimnya berada.
2. Portal menjawab **dengan benar** apakah sebuah unit masih bergaransi, di sisi
   principal maupun di sisi kita, tanpa ada yang harus membuka spreadsheet.
3. Administrator menjalankan antreannya: meneruskan ke principal, memutuskan
   klaim internal, mengatur pemenuhan, mencatat talangan stok dan pengembalian
   part rusak.
4. Principal memutuskan klaim atas unitnya sendiri, tanpa melihat unit principal
   lain.
5. Ada jejak yang bisa dipertahankan saat klaim dipersoalkan.

## Yang belum dijawab

Ditanyakan tapi belum dibahas tuntas; angkat lagi bila relevan:

- Nilai rupiah per sparepart, dan laporan biaya garansi yang diserap
- Telusur serial part rusak ↔ serial part pengganti
- Lingkaran talangan stok: kapan principal mengganti barang yang kita talangi
- SLA dan eskalasi
- Downtime alat
- Teknisi dan laporan pekerjaannya
- Kewajiban pelaporan ke regulator (vigilance)
- Bahasa antarmuka — seluruhnya masih Inggris
- Jalur "butuh informasi tambahan" untuk principal, yang sekarang hanya bisa
  diwakili dengan menolak
