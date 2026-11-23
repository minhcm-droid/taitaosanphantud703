export const DRYER_CONFIGS = {
  'D-703A': {
    id: 'D-703A',
    name: 'Hexane Dryer A (D-703A)',
    section: 'Section 700 - Hexane Recovery',
    sopRef: 'HD-W-7000-04-004',
    pgTag: 'PG-7402A',
    topTempTag: 'TI-742A',
    botTempTag: 'TI-741A',
    targetRegenTemp: 230,
    psvSet: '18.0 kg/cm²g',
    lineIn: '6"-RGS-8701-A2A-H',
    lineOut: '6"-RGR-8701-A2A-P'
  },
  'D-703B': {
    id: 'D-703B',
    name: 'Hexane Dryer B (D-703B)',
    section: 'Section 700 - Hexane Recovery',
    sopRef: 'HD-W-7000-04-004',
    pgTag: 'PG-7402B',
    topTempTag: 'TI-742B',
    botTempTag: 'TI-741B',
    targetRegenTemp: 230,
    psvSet: '18.0 kg/cm²g',
    lineIn: '6"-RGS-8701-A2A-H',
    lineOut: '6"-RGR-8701-A2A-P'
  },
  'D-235A': {
    id: 'D-235A',
    name: 'Butene-1 Dryer A (D-235A)',
    section: 'Section 200 - Polymerization',
    sopRef: 'HD-W-2300-04-002',
    pgTag: 'PG-236A',
    topTempTag: 'TI-236A',
    botTempTag: 'TI-236B',
    targetRegenTemp: 220,
    psvSet: '20.0 kg/cm²g',
    lineIn: '3"-RGS-8005-A2A-H',
    lineOut: '3"-RGR-8006-A2A-P'
  }
};

export const ALARM_THRESHOLDS = {
  TIC_801: { h: 250, unit: '°C', desc: 'E-801 Outlet Temp High' },
  TI_802: { h: 50, unit: '°C', desc: 'E-802 Outlet Temp High' },
  PIC_801: { l: 2.0, h: 4.0, unit: 'kg/cm²g', desc: 'D-802 Pressure Deviation' },
  PZI_815: { h: 4.0, hh: 4.2, unit: 'kg/cm²g', desc: 'C-801 Discharge Press High (I-881)' },
  LIC_802: { h: 80, unit: '%', desc: 'D-802 Level High' },
  LZI_802: { h: 70, hh: 84.3, unit: '%', desc: 'D-802 Interlock Level High (I-881)' },
  LIC_805: { l: 6.3, h: 90, unit: '%', desc: 'D-803 Condensate Level Deviation' },
  PI_804: { l: 10.0, ll: 9.0, unit: 'kg/cm²g', desc: 'C-801 Seal Oil Pressure Low (I-881)' },
  TI_803: { h: 80, hh: 95, unit: '°C', desc: 'C-801 DE Bearing Temp High' },
  TI_804: { h: 80, hh: 95, unit: '°C', desc: 'C-801 NDE Bearing Temp High' }
};

export const SOP_WORKFLOW_STEPS = [
  {
    id: 1,
    phase: 'START-UP',
    sop: 'HD-W-8200-04-001 / 7000-04-004',
    role: 'FO',
    title: '1. Kiểm tra phụ trợ C-801 (SOS, MN Seal, Lube Oil)',
    detail: 'Cấp Seal Oil sạch (PI-804 = 11 kg/cm²g), MN Seal (3.0 kg/cm²g) và kiểm tra mức dầu bôi trơn ổ trục C-801.',
    check: (s) => s.aux.sosSupply && s.aux.mnSeal && s.telemetry.pi804 >= 10.5
  },
  {
    id: 2,
    phase: 'START-UP',
    sop: 'HD-W-7000-04-004',
    role: 'FO',
    title: '2. Line-up Dryer: Xoay Spectacle Blind & Mở V1, V2, V3, V4, V5',
    detail: 'Xoay Spectacle Blind tại V2, V3 sang OPEN; mở V1/V2 (inlet), V3/V4 (outlet) và mở hoàn toàn bypass V5 chống cuốn hạt sàng.',
    check: (s) => s.valves.sbInOpen && s.valves.sbOutOpen && s.valves.v1 && s.valves.v2 && s.valves.v3 && s.valves.v4 && s.valves.v5
  },
  {
    id: 3,
    phase: 'START-UP',
    sop: 'HD-W-8200-04-001',
    role: 'FO / BM',
    title: '3. Đưa Cooler E-802 vào vận hành & Xả nước ngưng E-801 (V3)',
    detail: 'Mở V1 CW inlet, xả khí CW Vent đến khi ra nước, mở V2 CW outlet. Mở/đóng V3 xả sạch nước ngưng E-801.',
    check: (s) => s.valves.cwV1 && s.valves.cwV2 && s.aux.cwAirVented && s.aux.e801Drained && !s.valves.e801V3
  },
  {
    id: 4,
    phase: 'START-UP',
    sop: 'HD-W-8200-04-001',
    role: 'BM',
    title: '4. Cài đặt bộ điều khiển & Nạp MN2 100 Nm³/h nâng áp 1.0 kg/cm²g',
    detail: 'Đặt PIC-801 AUTO (1.0 kg/cm²g), LIC-802 AUTO (30%), LIC-805 AUTO (40%). Mở FV-801 đạt 100 Nm³/h đuổi ẩm 1h, sau đó đóng V5.',
    check: (s) => s.controllers.pic801.mode === 'AUTO' && s.telemetry.pic801 >= 0.95 && !s.valves.v5 && s.valves.d802DrainBlk && s.valves.pv801Blk
  },
  {
    id: 5,
    phase: 'START-UP',
    sop: 'HD-W-8200-04-001',
    role: 'BM',
    title: '5. Khởi động Reactivation Gas Blower C-801',
    detail: 'Chạy C-801 tuần hoàn kín qua Dryer (~2295 Nm³/h), giám sát PIC-801 và PZI-815 ổn định.',
    check: (s) => s.blowerRunning && !s.interlockTripped
  },
  {
    id: 6,
    phase: 'REGEN (15H)',
    sop: 'HD-W-8200-04-001 / 7000-04-004',
    role: 'BM / FO',
    title: '6. Gia nhiệt E-801 lên 220–230°C & Nâng áp PIC-801 lên 3.0 kg/cm²g',
    detail: 'Mở van chặn TV-801, tăng TIC-801 từng bước 50°C/h lên 220-230°C (AUTO), nâng PIC-801 lên 3.0 kg/cm²g. Duy trì TI-741/742 > 200°C.',
    check: (s) => s.valves.tv801Blk && s.telemetry.tic801 >= 215 && s.telemetry.pic801 >= 2.9 && s.telemetry.dryerBotTemp >= 200
  },
  {
    id: 7,
    phase: 'SHUTDOWN',
    sop: 'HD-W-8200-04-002',
    role: 'BM / FO',
    title: '7. Ngừng gia nhiệt E-801 & Chạy C-801 làm mát tháp < 50°C (5h)',
    detail: 'Đặt TIC-801 MV=0% đóng TV-801, FO đóng van chặn TV-801. Chạy C-801 làm nguội đỉnh/đáy Dryer xuống < 50°C.',
    check: (s) => s.controllers.tic801.mv === 0 && !s.valves.tv801Blk && s.telemetry.dryerTopTemp < 50 && s.telemetry.dryerBotTemp < 50
  },
  {
    id: 8,
    phase: 'SHUTDOWN',
    sop: 'HD-W-8200-04-002',
    role: 'BM / FO',
    title: '8. Dừng C-801, đóng SOS/MN Seal & Hạ áp/làm mát về ~42°C',
    detail: 'Dừng C-801, đóng MN Seal & Seal Oil. Giảm PIC-801 về 1.0 kg/cm²g, duy trì FIC-801 ~30 Nm³/h hạ nhiệt về ~42°C.',
    check: (s) => !s.blowerRunning && !s.aux.sosSupply && !s.aux.mnSeal && s.telemetry.dryerBotTemp <= 43
  },
  {
    id: 9,
    phase: 'ISOLATION',
    sop: 'HD-W-8200-04-002 / 7000-04-004',
    role: 'FO / BM',
    title: '9. Hạ áp 0.5 kg/cm²g, cô lập Dryer (Spectacle Blind CLOSE) & Off E-802',
    detail: 'Giảm áp 0.5 kg/cm²g bảo quản N2, đóng FV-801, PV-801, V1-V4, xoay Spectacle Blind về CLOSE, tắt CW E-802 và xả D-802.',
    check: (s) => !s.valves.v1 && !s.valves.v2 && !s.valves.v3 && !s.valves.v4 && !s.valves.sbInOpen && !s.valves.sbOutOpen && !s.valves.cwV1 && !s.valves.cwV2
  }
];

export const DEVIATION_SCENARIOS = [
  {
    id: 'NONE',
    name: 'Vận hành bình thường (Normal)',
    symptom: 'Tất cả thông số nằm trong giới hạn vận hành an toàn.',
    action: 'Giám sát định kỳ trên DCS và tuần tra hiện trường.'
  },
  {
    id: 'TV801_STUCK_OPEN',
    name: 'Sự cố 1: Kẹt mở TV-801 / Lỗi TIC-801',
    symptom: 'Cấp hơi HS quá mức -> TIC-801 tăng vượt 250°C (H-Alarm), nguy cơ quá nhiệt tự bốc cháy Hexane.',
    action: 'BM chuyển TIC-801 sang MAN giảm MV về 0% hoặc FO tiết lưu van chặn / đóng nhánh bypass TV-801.'
  },
  {
    id: 'CW_FAIL_E802',
    name: 'Sự cố 2: Mất nước làm mát CW tới E-802',
    symptom: 'TI-802 tăng vượt 50°C (H-Alarm), nhiệt độ D-802 (TG-8002) và đầu hút C-801 tăng cao gây hư hỏng máy.',
    action: 'FO kiểm tra chéo van V1/V2 tại E-802, kiểm tra nhiệt độ CWR (TW-8004) và khôi phục cấp CW.'
  },
  {
    id: 'SOS_STRAINER_PLUG',
    name: 'Sự cố 3: Nghẹt phin lọc Seal Oil STR-8019',
    symptom: 'Áp suất Seal Oil PI-804 tụt dưới 10.0 kg/cm²g (L-Alarm) tiến tới 9.0 kg/cm²g (Trip liên động I-881).',
    action: 'FO chuyển đổi ngay sang phin lọc dự phòng STR-8020 sang chế độ Duty và cô lập vệ sinh STR-8019.'
  },
  {
    id: 'LV802_STUCK_CLOSED',
    name: 'Sự cố 4: Kẹt đóng van xả LV-802 tại D-802',
    symptom: 'Mức hydrocarbon ngưng tụ D-802 tăng cao: LIC-802 > 80%, LZI-802 > 70% -> 84.3% (Trip C-801).',
    action: 'BM chuyển LIC-802 sang MAN mở LV-802 hoặc FO mở van bypass xả về bồn TK-703.'
  },
  {
    id: 'LV805_STUCK_CLOSED',
    name: 'Sự cố 5: Kẹt đóng van xả nước ngưng LV-805 (D-803)',
    symptom: 'Mức D-803 tăng vượt 90% (LIC-805 H-Alarm), gây ngập ống trao đổi nhiệt E-801 và thủy kích.',
    action: 'BM kiểm tra chéo kính thủy LG-8045, chuyển LIC-805 sang MAN hoặc FO mở bypass xả nước ngưng.'
  }
];
