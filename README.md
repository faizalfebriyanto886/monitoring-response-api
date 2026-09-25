# Flutter API Monitor — Node.js + Express + Firebase Firestore

## Persiapan Firebase

1. Buat project di Firebase Console dan aktifkan Cloud Firestore.
2. Buat service account untuk backend di Firebase Project Settings → Service accounts, lalu simpan JSON key dengan aman.
3. Salin `.env.example` menjadi `.env`, isi `FIREBASE_PROJECT_ID` dan `FIREBASE_SERVICE_ACCOUNT` dengan JSON service account satu baris. Alternatifnya, jalankan backend pada Google Cloud dengan Application Default Credentials.
4. Atur `MONITOR_API_KEY`.

## Menjalankan

```sh
npm install
npm run dev
```

Buka `http://localhost:3000`. Backend membuat dokumen log secara otomatis di koleksi `api_logs`. Firestore tidak memerlukan pembuatan tabel atau index awal untuk query yang digunakan.

## Endpoint

- `POST /api/v1/logs` — menerima log; membutuhkan header `X-Mobile-Monitor-Key`.
- `GET /api/v1/logs` — daftar log dengan filter `limit`, `offset`, `status`, `platform`, `app_version`, dan `search`.
- `GET /api/v1/logs/:id` — detail log.
- `GET /api/v1/stats` — statistik dashboard.
- `DELETE /api/v1/logs` — menghapus seluruh log.
- `GET /health` — status koneksi Firestore.

## Catatan produksi

- Gunakan HTTPS dan batasi akses dashboard serta endpoint penghapusan.
- Jangan menanamkan kunci permanen di aplikasi mobile; gunakan autentikasi per instalasi dan rate limiting.
- Simpan key service account sebagai secret di platform deployment, jangan commit file `.env` atau key JSON.
- Filter dan statistik saat ini membaca dokumen log ke backend. Terapkan retensi atau agregasi terjadwal jika volume log sudah besar.
- Hindari menyimpan PII atau kredensial di log.
