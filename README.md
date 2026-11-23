# LSP HDPE Plant — Section 800 / 700 / 200 Reactivation Gas & Dryer Digital Twin

Ứng dụng mô phỏng vận hành thời gian thực (Operator Training Simulator / Digital Twin) liên kết các quy trình SOP:
- **HD-W-8200-04-001:** Start-up Reactivation Gas System (Section 800: `C-801`, `E-801`, `E-802`, `D-802`, `D-803`)
- **HD-W-8200-04-002:** Shutdown Reactivation Gas System
- **HD-W-7000-04-004:** Regenerate Molecular Sieve of Hexane Dryer `D-703A/B` (Section 700)
- **HD-W-2300-04-002:** Regenerate Molecular Sieve of Butene-1 Dryer `D-235A/B` (Section 200)

## Tính năng chính
1. **Interactive P&ID Mimic (Field Operator):** Thao tác đóng/mở trực tiếp van chặn `V1–V4`, van bypass `V5`, xoay kính mù `Spectacle Blind`, xả khí làm mát `CW Vent`, xả nước ngưng `E-801 V3`, vận hành phụ trợ `Seal Oil (PI-804)`, `MN Seal`, chuyển đổi phin lọc `STR-8019 / STR-8020`.
2. **DCS Control Loops Faceplates (Boardman):** Điều khiển chế độ `AUTO/MAN`, `SP`, và `MV%` cho `TIC-801`, `PIC-801`, `FIC-801`, `LIC-802`, `LIC-805`.
3. **Liên động bảo vệ & Cảnh báo (Alarms & ESD I-881):** Giám sát ngưỡng L / H / HH và tự động trip `C-801` khi vi phạm giới hạn an toàn (`PI-804 <= 9.0 kg/cm²g`, `LZI-802 >= 84.3%`, `PZI-815 >= 4.2 kg/cm²g`, `TI-803/804 >= 95°C`).
4. **Kịch bản xử lý sự cố (Deviation Trainer):** Mô phỏng 5 tình huống bất thường theo Mục 8 SOP để luyện tập xử lý hiện trường và phòng điều khiển.

## Cài đặt & Chạy thử trên máy tính
```bash
npm install
npm run dev
```

## Đẩy lên GitHub & Deploy trên Vercel
1. Giải nén file ZIP và đưa toàn bộ thư mục dự án lên repository GitHub.
2. Truy cập [Vercel](https://vercel.com), chọn **Add New -> Project**, Import repository GitHub vừa tạo.
3. Giữ nguyên cấu hình mặc định của **Vite** (`npm run build`, output `dist`) và bấm **Deploy**.
