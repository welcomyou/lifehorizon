# LifeHorizon — Dòng tiền cuộc đời

Mô phỏng dòng tiền cả đời bằng VND chạy hoàn toàn trong trình duyệt: thu nhập, chi phí, BHXH,
tài sản, chiến lược đầu tư và kịch bản rủi ro. Dữ liệu người dùng **lưu trên máy họ**
(localStorage) và trao đổi bằng file JSON nhập/xuất — không có server lưu trữ nào.

## Dùng bản web

Mở <https://lifehorizon.pages.dev>. Mỗi lần push lên `main`, Cloudflare Pages tự build và deploy.

## Chạy bản desktop cục bộ

Bản desktop thêm thư viện hồ sơ dạng file JSON qua `app/server.js` (Node thuần):

```
npm start
```

Cấu hình dữ liệu thật đặt trong `profiles/` (đã gitignore, không đi vào repo).

## Kiểm thử

```
npm test          # toàn bộ test mô phỏng/chiến lược
npm run syntax    # kiểm tra cú pháp các file JS
npm run golden    # đối chứng vàng (cần thư mục audit cục bộ)
```

## Cấu trúc

- `app/index.html` — giao diện 8 tab
- `app/core/` — máy mô phỏng thuần (không đụng DOM)
- `app/ui/` — vẽ và wiring
- `app/state/` — cấu hình mặc định, localStorage, migration schema
- `app/server.js` — dịch vụ hồ sơ cục bộ cho bản desktop (bản web không cần)
