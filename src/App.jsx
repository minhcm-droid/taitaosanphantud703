import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, RotateCcw,
  Sliders, ShieldAlert, FastForward, Layers
} from 'lucide-react';
import {
  DRYER_CONFIGS,
  ALARM_THRESHOLDS,
  SOP_WORKFLOW_STEPS,
  DEVIATION_SCENARIOS
} from './data/sopConfig';

const INITIAL_STATE = {
  selectedDryer: 'D-703A',
  timeScale: 10, // 1x, 10x, 60x, 300x
  simSeconds: 0,
  blowerRunning: false,
  interlockTripped: false,
  tripReason: '',
  activeFault: 'NONE',
  activeStrainer: 'STR-8019', // STR-8019 or STR-8020
  aux: {
    sosSupply: false,
    mnSeal: false,
    cwAirVented: false,
    e801Drained: false
  },
  valves: {
    // Dryer D-703A/B or D-235A/B
    sbInOpen: false,
    sbOutOpen: false,
    v1: false,
    v2: false,
    v3: false,
    v4: false,
    v5: false, // Bypass line
    dryerBleed: false,
    // Cooler E-802 CW
    cwV1: false,
    cwVent: false,
    cwV2: false,
    // Heater E-801 Steam & Drain
    tv801Blk: false,
    e801V3: false,
    // Knock-out drum D-802 & Flare
    d802DrainBlk: false,
    pv801Blk: false,
    fv801Blk: true
  },
  controllers: {
    tic801: { mode: 'MAN', sp: 220, mv: 0 },
    pic801: { mode: 'AUTO', sp: 1.0, mv: 0 },
    fic801: { mode: 'MAN', sp: 100, mv: 0 },
    lic802: { mode: 'AUTO', sp: 30, mv: 0 },
    lic805: { mode: 'AUTO', sp: 40, mv: 0 }
  },
  telemetry: {
    tic801: 35.0,      // E-801 outlet temp (°C)
    ti802: 34.0,       // E-802 outlet temp (°C)
    pic801: 0.2,       // D-802 pressure (kg/cm2g)
    pzi815: 0.2,       // C-801 discharge pressure (kg/cm2g)
    pg7402: 0.5,       // Dryer local pressure gauge (kg/cm2g)
    pg8007: 0.0,       // E-802 CW pressure (kg/cm2g)
    lic802: 28.0,      // D-802 level (%)
    lzi802: 42.0,      // D-802 interlock level (%)
    lic805: 38.0,      // D-803 condensate level (%)
    pi804: 0.0,        // C-801 Seal oil pressure (kg/cm2g)
    ti803: 36.0,       // C-801 DE bearing temp (°C)
    ti804: 36.5,       // C-801 NDE bearing temp (°C)
    dryerTopTemp: 35.0,// TI-742A/B or TI-236A
    dryerBotTemp: 35.0,// TI-741A/B or TI-236B
    mnFlow: 0.0,       // FIC-801 (Nm3/h)
    loopFlow: 0.0,     // Total RGS circulation (Nm3/h)
    moisturePpm: 18.0  // Outlet moisture content (Target < 5 ppm)
  },
  history: []
};

export default function App() {
  const [sim, setSim] = useState(INITIAL_STATE);
  const [selectedCtrl, setSelectedCtrl] = useState('TIC-801');
  const [activeTab, setActiveTab] = useState('SOP'); // 'SOP' | 'FAULTS' | 'TREND'

  const dryerMeta = DRYER_CONFIGS[sim.selectedDryer];

  // Real-time dynamic thermodynamic & hydraulic solver
  useEffect(() => {
    const interval = setInterval(() => {
      setSim((prev) => {
        const dt = 0.5 * prev.timeScale; // simulated seconds per tick
        const t = { ...prev.telemetry };
        const c = JSON.parse(JSON.stringify(prev.controllers));
        const v = prev.valves;
        const aux = prev.aux;

        // 1. Auxiliary Systems (SOS, MN Seal, CW)
        if (aux.sosSupply) {
          if (prev.activeFault === 'SOS_STRAINER_PLUG' && prev.activeStrainer === 'STR-8019') {
            t.pi804 = Math.max(8.5, t.pi804 - 0.08 * dt);
          } else {
            t.pi804 += (11.0 - t.pi804) * Math.min(1, 0.25 * dt);
          }
        } else {
          t.pi804 = Math.max(0, t.pi804 - 0.5 * dt);
        }

        // E-802 CW pressure PG-8007 (Normal CW = 4.2 kg/cm2g)
        if (v.cwV1 && prev.activeFault !== 'CW_FAIL_E802') {
          t.pg8007 += (4.2 - t.pg8007) * Math.min(1, 0.2 * dt);
        } else {
          t.pg8007 = Math.max(0, t.pg8007 - 0.3 * dt);
        }

        // 2. Check Interlock I-881 & Blower C-801 status
        let tripped = prev.interlockTripped;
        let tripReason = prev.tripReason;
        let running = prev.blowerRunning;

        if (running) {
          if (t.pi804 <= 9.0) {
            running = false;
            tripped = true;
            tripReason = 'I-881 TRIP: PI-804 Seal Oil Pressure <= 9.0 kg/cm²g';
          } else if (t.lzi802 >= 84.3) {
            running = false;
            tripped = true;
            tripReason = 'I-881 TRIP: LZI-802 D-802 Level HH >= 84.3%';
          } else if (t.pzi815 >= 4.2) {
            running = false;
            tripped = true;
            tripReason = 'I-881 TRIP: PZI-815 C-801 Discharge Pressure >= 4.2 kg/cm²g';
          } else if (t.ti803 >= 95 || t.ti804 >= 95) {
            running = false;
            tripped = true;
            tripReason = 'I-881 TRIP: C-801 Bearing Temperature >= 95°C';
          }
        }

        // 3. Flow & Hydraulic Path Calculation
        const dryerPathOpen = v.v1 && v.v2 && v.v3 && v.v4 && v.sbInOpen && v.sbOutOpen;
        const loopPathOpen = dryerPathOpen || v.v5;

        // FIC-801 (MN2 Make-up Flow)
        if (v.fv801Blk) {
          if (c.fic801.mode === 'AUTO') {
            const err = c.fic801.sp - t.mnFlow;
            c.fic801.mv = Math.max(0, Math.min(100, c.fic801.mv + err * 0.15));
          }
          const targetMn = (c.fic801.mv / 100) * 180; // Max 180 Nm3/h
          t.mnFlow += (targetMn - t.mnFlow) * Math.min(1, 0.3 * dt);
        } else {
          t.mnFlow = 0;
          if (c.fic801.mode === 'AUTO') c.fic801.mv = 0;
        }

        // Total circulation flow
        if (running) {
          t.loopFlow = loopPathOpen ? 2295 + t.mnFlow : 120; // Dead-headed if path closed
        } else {
          t.loopFlow = loopPathOpen ? t.mnFlow : 0;
        }

        // 4. Loop Pressure PIC-801, PZI-815, PG-7402
        const pressIn = (t.mnFlow / 180) * 0.045 * dt;
        const flareOpenFactor = v.pv801Blk ? (c.pic801.mv / 100) : 0;
        const pressOut = flareOpenFactor * Math.max(0, t.pic801 - 0.1) * 0.06 * dt;

        t.pic801 = Math.max(0.0, t.pic801 + pressIn - pressOut);

        if (c.pic801.mode === 'AUTO') {
          const pErr = t.pic801 - c.pic801.sp;
          c.pic801.mv = Math.max(0, Math.min(100, c.pic801.mv + pErr * 18.0));
        }

        // C-801 Discharge Pressure PZI-815
        if (running) {
          if (!loopPathOpen) {
            // Blocked discharge causes rapid overpressure!
            t.pzi815 += 0.25 * dt;
          } else {
            const dp = v.v5 ? 0.15 : 0.50; // Rated delta-P = 0.5 kg/cm2g (3.0 -> 3.5)
            t.pzi815 += (t.pic801 + dp - t.pzi815) * Math.min(1, 0.3 * dt);
          }
        } else {
          t.pzi815 += (t.pic801 - t.pzi815) * Math.min(1, 0.3 * dt);
        }

        // Dryer Pressure PG-7402A/B
        if (dryerPathOpen) {
          const dPress = running && !v.v5 ? t.pzi815 - 0.15 : t.pic801;
          t.pg7402 += (dPress - t.pg7402) * Math.min(1, 0.3 * dt);
        } else if (v.dryerBleed) {
          t.pg7402 = Math.max(0.0, t.pg7402 - 0.15 * dt);
        }

        // 5. Thermal Dynamics: Heater E-801 (TIC-801)
        const steamAvailable = v.tv801Blk && t.lic805 < 92;
        if (prev.activeFault === 'TV801_STUCK_OPEN') {
          c.tic801.mv = 100;
        } else if (c.tic801.mode === 'AUTO') {
          const tErr = c.tic801.sp - t.tic801;
          c.tic801.mv = Math.max(0, Math.min(100, c.tic801.mv + tErr * 0.4));
        }

        const effectiveSteamMv = steamAvailable ? c.tic801.mv : 0;
        const targetE801Temp = effectiveSteamMv > 0
          ? 35 + (effectiveSteamMv / 100) * 235
          : (t.loopFlow > 50 ? t.ti802 : 35);

        const heatRate = effectiveSteamMv > 0 ? 0.012 : 0.008;
        t.tic801 += (targetE801Temp - t.tic801) * Math.min(1, heatRate * dt);

        // 6. Dryer Bed Top (TI-742) & Bottom (TI-741) Thermal Wave
        const gasReachingDryer = dryerPathOpen && !v.v5 && t.loopFlow > 20;
        if (gasReachingDryer) {
          const flowFactor = Math.min(1.5, t.loopFlow / 1500);
          // Top bed heats/cools faster than bottom bed
          t.dryerTopTemp += (t.tic801 - t.dryerTopTemp) * Math.min(1, 0.00045 * flowFactor * dt);
          t.dryerBotTemp += (t.dryerTopTemp - t.dryerBotTemp) * Math.min(1, 0.00032 * flowFactor * dt);
        } else {
          // Ambient heat loss when isolated
          t.dryerTopTemp += (35.0 - t.dryerTopTemp) * Math.min(1, 0.00003 * dt);
          t.dryerBotTemp += (35.0 - t.dryerBotTemp) * Math.min(1, 0.00003 * dt);
        }

        // Moisture desorption when bed > 160°C
        if (t.dryerBotTemp > 160 && t.moisturePpm > 1.2) {
          t.moisturePpm = Math.max(1.2, t.moisturePpm - 0.0012 * dt);
        }

        // 7. Cooler E-802 (TI-802)
        const gasInletE802 = dryerPathOpen && !v.v5 ? t.dryerBotTemp : t.tic801;
        const cwEffective = v.cwV1 && v.cwV2 && prev.activeFault !== 'CW_FAIL_E802';
        const targetTi802 = cwEffective
          ? Math.min(44, 34 + (gasInletE802 - 35) * 0.03)
          : gasInletE802 * 0.92;
        t.ti802 += (targetTi802 - t.ti802) * Math.min(1, 0.02 * dt);

        // 8. Condensate Levels: D-803 (LIC-805) & D-802 (LIC-802 / LZI-802)
        // D-803 Steam Condensate
        const steamCondIn = (effectiveSteamMv / 100) * 0.035 * dt;
        if (prev.activeFault === 'LV805_STUCK_CLOSED') {
          c.lic805.mv = 0;
        } else if (c.lic805.mode === 'AUTO') {
          const lErr = t.lic805 - c.lic805.sp;
          c.lic805.mv = Math.max(0, Math.min(100, c.lic805.mv + lErr * 2.5));
        }
        const d803Out = (c.lic805.mv / 100) * 0.06 * dt;
        t.lic805 = Math.max(0, Math.min(100, t.lic805 + steamCondIn - d803Out));

        // D-802 Condensed Hydrocarbon & Water
        const desorbCondIn = (t.dryerTopTemp > 110 && t.dryerBotTemp < 215 && cwEffective)
          ? 0.022 * dt
          : 0.001 * dt;
        if (prev.activeFault === 'LV802_STUCK_CLOSED') {
          c.lic802.mv = 0;
        } else if (c.lic802.mode === 'AUTO') {
          const lErr2 = t.lic802 - c.lic802.sp;
          c.lic802.mv = Math.max(0, Math.min(100, c.lic802.mv + lErr2 * 2.5));
        }
        const d802Out = v.d802DrainBlk ? (c.lic802.mv / 100) * 0.05 * dt : 0;
        t.lic802 = Math.max(0, Math.min(100, t.lic802 + desorbCondIn - d802Out));
        t.lzi802 = Math.min(100, t.lic802 * 1.15 + 10); // LZI-802 normal 45% when LIC-802 is 30%

        // 9. Blower Bearing Temps TI-803 / TI-804
        const targetBearing = running ? 48.0 + Math.max(0, t.ti802 - 40) * 0.5 : 36.0;
        t.ti803 += (targetBearing - t.ti803) * Math.min(1, 0.01 * dt);
        t.ti804 += (targetBearing + 0.8 - t.ti804) * Math.min(1, 0.01 * dt);

        // Append trend point
        const nextSeconds = prev.simSeconds + dt;
        const newHistory = [
          ...prev.history.slice(-59),
          {
            time: Math.floor(nextSeconds),
            tic801: Number(t.tic801.toFixed(1)),
            topTemp: Number(t.dryerTopTemp.toFixed(1)),
            botTemp: Number(t.dryerBotTemp.toFixed(1)),
            ti802: Number(t.ti802.toFixed(1)),
            pic801: Number(t.pic801.toFixed(2))
          }
        ];

        return {
          ...prev,
          simSeconds: nextSeconds,
          blowerRunning: running,
          interlockTripped: tripped,
          tripReason,
          controllers: c,
          telemetry: t,
          history: newHistory
        };
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  // Active Alarms Evaluation
  const activeAlarms = useMemo(() => {
    const t = sim.telemetry;
    const list = [];
    if (sim.interlockTripped) list.push({ level: 'ESD', tag: 'I-881', msg: sim.tripReason });
    if (t.tic801 >= ALARM_THRESHOLDS.TIC_801.h) list.push({ level: 'H', tag: 'TIC-801', msg: `E-801 Outlet Temp High (${t.tic801.toFixed(1)}°C >= 250°C)` });
    if (t.ti802 >= ALARM_THRESHOLDS.TI_802.h) list.push({ level: 'H', tag: 'TI-802', msg: `E-802 Outlet Temp High (${t.ti802.toFixed(1)}°C >= 50°C)` });
    if (t.pzi815 >= ALARM_THRESHOLDS.PZI_815.h) list.push({ level: 'H', tag: 'PZI-815', msg: `C-801 Discharge Press High (${t.pzi815.toFixed(2)} >= 4.0 kg/cm²g)` });
    if (sim.blowerRunning && t.pic801 < ALARM_THRESHOLDS.PIC_801.l) list.push({ level: 'L', tag: 'PIC-801', msg: `D-802 Pressure Low (${t.pic801.toFixed(2)} < 2.0 kg/cm²g)` });
    if (t.pic801 > ALARM_THRESHOLDS.PIC_801.h) list.push({ level: 'H', tag: 'PIC-801', msg: `D-802 Pressure High (${t.pic801.toFixed(2)} > 4.0 kg/cm²g)` });
    if (t.lic802 >= ALARM_THRESHOLDS.LIC_802.h) list.push({ level: 'H', tag: 'LIC-802', msg: `D-802 Level High (${t.lic802.toFixed(1)}% >= 80%)` });
    if (t.lzi802 >= ALARM_THRESHOLDS.LZI_802.h) list.push({ level: 'H', tag: 'LZI-802', msg: `D-802 Interlock Level High (${t.lzi802.toFixed(1)}% >= 70%)` });
    if (t.lic805 >= ALARM_THRESHOLDS.LIC_805.h) list.push({ level: 'H', tag: 'LIC-805', msg: `D-803 Level High (${t.lic805.toFixed(1)}% >= 90% - E-801 Flooding)` });
    if (t.lic805 <= ALARM_THRESHOLDS.LIC_805.l) list.push({ level: 'L', tag: 'LIC-805', msg: `D-803 Level Low (${t.lic805.toFixed(1)}% <= 6.3% - Steam Blow-by)` });
    if (sim.aux.sosSupply && t.pi804 <= ALARM_THRESHOLDS.PI_804.l) list.push({ level: 'L', tag: 'PI-804', msg: `C-801 Seal Oil Press Low (${t.pi804.toFixed(2)} <= 10.0 kg/cm²g)` });
    if (t.ti803 >= ALARM_THRESHOLDS.TI_803.h || t.ti804 >= ALARM_THRESHOLDS.TI_804.h) list.push({ level: 'H', tag: 'TI-803/804', msg: `C-801 Bearing Temp High (>= 80°C)` });
    return list;
  }, [sim]);

  // Helper Handlers
  const toggleValve = (key) => {
    setSim((s) => {
      const nextVal = !s.valves[key];
      const nextAux = { ...s.aux };
      if (key === 'cwVent' && nextVal && s.valves.cwV1) nextAux.cwAirVented = true;
      if (key === 'e801V3' && nextVal) nextAux.e801Drained = true;
      return {
        ...s,
        aux: nextAux,
        valves: { ...s.valves, [key]: nextVal }
      };
    });
  };

  const toggleAux = (key) => {
    setSim((s) => ({
      ...s,
      aux: { ...s.aux, [key]: !s.aux[key] }
    }));
  };

  const handleBlowerToggle = () => {
    setSim((s) => {
      if (s.blowerRunning) {
        return { ...s, blowerRunning: false };
      }
      if (s.interlockTripped) return s;
      if (s.telemetry.pi804 <= 9.0) {
        return {
          ...s,
          interlockTripped: true,
          tripReason: 'I-881 PREVENT START: Seal Oil PI-804 <= 9.0 kg/cm²g!'
        };
      }
      return { ...s, blowerRunning: true };
    });
  };

  const resetInterlock = () => {
    setSim((s) => ({
      ...s,
      interlockTripped: false,
      tripReason: '',
      telemetry: {
        ...s.telemetry,
        pzi815: s.telemetry.pic801
      }
    }));
  };

  const updateController = (ctrlKey, field, value) => {
    setSim((s) => ({
      ...s,
      controllers: {
        ...s.controllers,
        [ctrlKey]: {
          ...s.controllers[ctrlKey],
          [field]: value
        }
      }
    }));
  };

  // Auto-Step Assistant for rapid training walkthrough
  const applySopPreset = (stepId) => {
    setSim((s) => {
      const next = JSON.parse(JSON.stringify(s));
      next.activeFault = 'NONE';
      next.interlockTripped = false;
      next.tripReason = '';

      if (stepId === 1) {
        next.aux.sosSupply = true;
        next.aux.mnSeal = true;
        next.telemetry.pi804 = 11.0;
      } else if (stepId === 2) {
        next.aux.sosSupply = true;
        next.aux.mnSeal = true;
        next.telemetry.pi804 = 11.0;
        next.valves.sbInOpen = true;
        next.valves.sbOutOpen = true;
        next.valves.v1 = true;
        next.valves.v2 = true;
        next.valves.v3 = true;
        next.valves.v4 = true;
        next.valves.v5 = true;
      } else if (stepId === 3) {
        next.valves.cwV1 = true;
        next.valves.cwV2 = true;
        next.aux.cwAirVented = true;
        next.aux.e801Drained = true;
        next.valves.e801V3 = false;
        next.telemetry.pg8007 = 4.2;
      } else if (stepId === 4) {
        next.valves.d802DrainBlk = true;
        next.valves.pv801Blk = true;
        next.valves.fv801Blk = true;
        next.valves.v5 = false;
        next.controllers.pic801 = { mode: 'AUTO', sp: 1.0, mv: 15 };
        next.controllers.fic801 = { mode: 'AUTO', sp: 100, mv: 55 };
        next.controllers.lic802 = { mode: 'AUTO', sp: 30, mv: 30 };
        next.controllers.lic805 = { mode: 'AUTO', sp: 40, mv: 40 };
        next.telemetry.pic801 = 1.0;
        next.telemetry.pg7402 = 1.0;
        next.telemetry.mnFlow = 100;
      } else if (stepId === 5) {
        next.aux.sosSupply = true;
        next.aux.mnSeal = true;
        next.telemetry.pi804 = 11.0;
        next.valves.sbInOpen = true;
        next.valves.sbOutOpen = true;
        next.valves.v1 = true;
        next.valves.v2 = true;
        next.valves.v3 = true;
        next.valves.v4 = true;
        next.valves.v5 = false;
        next.valves.cwV1 = true;
        next.valves.cwV2 = true;
        next.valves.d802DrainBlk = true;
        next.valves.pv801Blk = true;
        next.blowerRunning = true;
      } else if (stepId === 6) {
        next.blowerRunning = true;
        next.valves.tv801Blk = true;
        next.valves.v5 = false;
        next.controllers.tic801 = { mode: 'AUTO', sp: dryerMeta.targetRegenTemp, mv: 82 };
        next.controllers.pic801 = { mode: 'AUTO', sp: 3.0, mv: 22 };
        next.telemetry.tic801 = dryerMeta.targetRegenTemp;
        next.telemetry.dryerTopTemp = dryerMeta.targetRegenTemp - 2;
        next.telemetry.dryerBotTemp = 212.0;
        next.telemetry.pic801 = 3.0;
        next.telemetry.pzi815 = 3.5;
        next.telemetry.pg7402 = 3.35;
        next.telemetry.moisturePpm = 1.5;
      } else if (stepId === 7) {
        next.blowerRunning = true;
        next.controllers.tic801 = { mode: 'MAN', sp: 0, mv: 0 };
        next.valves.tv801Blk = false;
        next.telemetry.tic801 = 42.0;
        next.telemetry.dryerTopTemp = 45.0;
        next.telemetry.dryerBotTemp = 46.5;
      } else if (stepId === 8) {
        next.blowerRunning = false;
        next.aux.sosSupply = false;
        next.aux.mnSeal = false;
        next.telemetry.pi804 = 0.0;
        next.controllers.pic801 = { mode: 'AUTO', sp: 1.0, mv: 25 };
        next.controllers.fic801 = { mode: 'AUTO', sp: 30, mv: 18 };
        next.telemetry.pic801 = 1.0;
        next.telemetry.dryerTopTemp = 41.5;
        next.telemetry.dryerBotTemp = 42.0;
      } else if (stepId === 9) {
        next.blowerRunning = false;
        next.controllers.fic801 = { mode: 'MAN', sp: 0, mv: 0 };
        next.valves.fv801Blk = false;
        next.valves.pv801Blk = false;
        next.valves.v1 = false;
        next.valves.v2 = false;
        next.valves.v3 = false;
        next.valves.v4 = false;
        next.valves.sbInOpen = false;
        next.valves.sbOutOpen = false;
        next.valves.cwV1 = false;
        next.valves.cwV2 = false;
        next.valves.d802DrainBlk = false;
        next.telemetry.pg7402 = 0.5;
        next.telemetry.pic801 = 0.5;
      }
      return next;
    });
  };

  const formatSimTime = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const t = sim.telemetry;
  const v = sim.valves;
  const hotGas = t.tic801 > 100;
  const dryerReceivingGas = v.v1 && v.v2 && v.v3 && v.v4 && v.sbInOpen && v.sbOutOpen && !v.v5 && t.loopFlow > 20;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* TOP SCADA HEADER */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded-lg">
            <Activity className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                LSP HDPE PLANT
              </span>
              <h1 className="text-sm md:text-base font-bold tracking-wide text-white">
                SECTION 800 / 700 / 200 — REACTIVATION GAS & DRYER DIGITAL TWIN
              </h1>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Linked SOPs: HD-W-8200-04-001 • HD-W-8200-04-002 • {dryerMeta.sopRef}
            </p>
          </div>
        </div>

        {/* Dryer Selector & Simulation Speed */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sim.selectedDryer}
            onChange={(e) => setSim((s) => ({ ...s, selectedDryer: e.target.value }))}
            className="bg-slate-800 border border-slate-700 text-xs font-mono rounded px-2.5 py-1.5 text-cyan-300 focus:outline-none focus:border-cyan-500"
          >
            <option value="D-703A">Target: D-703A (Hexane Dryer A)</option>
            <option value="D-703B">Target: D-703B (Hexane Dryer B)</option>
            <option value="D-235A">Target: D-235A (Butene-1 Dryer A)</option>
          </select>

          <div className="flex items-center bg-slate-800 rounded border border-slate-700 p-0.5 text-xs font-mono">
            {[1, 10, 60, 300].map((spd) => (
              <button
                key={spd}
                onClick={() => setSim((s) => ({ ...s, timeScale: spd }))}
                className={`px-2 py-1 rounded transition ${
                  sim.timeScale === spd
                    ? 'bg-cyan-600 text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          <div className="bg-slate-950 border border-slate-800 px-3 py-1.5 rounded font-mono text-xs text-emerald-400">
            SIM TIME: {formatSimTime(sim.simSeconds)}
          </div>

          <button
            onClick={() => setSim(INITIAL_STATE)}
            title="Reset Simulation"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* ALARM & INTERLOCK BANNER */}
      <div className="bg-slate-900/80 border-b border-slate-800 px-4 py-1.5 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-2 min-w-max">
          {activeAlarms.length === 0 ? (
            <span className="flex items-center gap-1.5 text-xs font-mono text-emerald-400">
              <CheckCircle2 className="w-4 h-4" /> SYSTEM NORMAL — NO ACTIVE ALARMS / INTERLOCK I-881 HEALTHY
            </span>
          ) : (
            activeAlarms.map((al, idx) => (
              <span
                key={idx}
                className={`flex items-center gap-1.5 text-xs font-mono px-2.5 py-0.5 rounded border animate-pulse ${
                  al.level === 'ESD'
                    ? 'bg-red-950/90 border-red-500 text-red-200 font-bold'
                    : 'bg-amber-950/90 border-amber-500 text-amber-200'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                [{al.level}] {al.tag}: {al.msg}
              </span>
            ))
          )}
        </div>

        {sim.interlockTripped && (
          <button
            onClick={resetInterlock}
            className="shrink-0 bg-red-600 hover:bg-red-500 text-white text-xs font-mono font-bold px-3 py-1 rounded flex items-center gap-1"
          >
            <ShieldAlert className="w-3.5 h-3.5" /> RESET ESD I-881
          </button>
        )}
      </div>

      {/* MAIN WORKSPACE GRID */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-3 p-3">
        {/* LEFT + CENTER: INTERACTIVE P&ID + DCS FACEPLATES (8 COLS) */}
        <div className="xl:col-span-8 flex flex-col gap-3">
          {/* INTERACTIVE P&ID MIMIC */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Interactive P&ID Mimic (Click vào Van / Spectacle Blind / Blower C-801 để thao tác hiện trường)
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> OPEN / RUN
                </span>
                <span className="flex items-center gap-1 text-rose-400">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" /> CLOSE / STOP
                </span>
              </div>
            </div>

            <div className="w-full overflow-x-auto">
              <svg viewBox="0 0 980 470" className="w-full min-w-[780px] h-auto bg-slate-950 rounded-lg border border-slate-800/80 select-none">
                {/* GRID BACKGROUND */}
                <defs>
                  <pattern id="pidGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                    <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="980" height="470" fill="url(#pidGrid)" />

                {/* SECTION DIVIDERS */}
                <line x1="650" y1="10" x2="650" y2="460" stroke="#334155" strokeDasharray="4 4" />
                <text x="20" y="24" fill="#64748b" fontSize="11" fontFamily="monospace" fontWeight="bold">
                  SECTION 800: REACTIVATION GAS SYSTEM (C-801 / E-801 / E-802 / D-802 / D-803)
                </text>
                <text x="665" y="24" fill="#38bdf8" fontSize="11" fontFamily="monospace" fontWeight="bold">
                  {dryerMeta.section.toUpperCase()}
                </text>

                {/* PIPING LINES */}
                {/* MN2 Make-up line to C-801 suction */}
                <path
                  d="M 40 75 L 180 75 L 180 285 L 220 285"
                  fill="none"
                  stroke={t.mnFlow > 2 ? '#38bdf8' : '#334155'}
                  strokeWidth="3"
                  className={t.mnFlow > 2 ? 'pipe-flow' : ''}
                />
                <text x="42" y="67" fill="#38bdf8" fontSize="10" fontFamily="monospace">MN2 HEADER</text>

                {/* C-801 Discharge to E-801 */}
                <path
                  d="M 275 285 L 330 285 L 330 110 L 395 110"
                  fill="none"
                  stroke={t.loopFlow > 20 ? '#22d3ee' : '#334155'}
                  strokeWidth="3.5"
                  className={t.loopFlow > 20 ? 'pipe-flow-fast' : ''}
                />

                {/* E-801 Outlet RGS Supply Header to Dryer */}
                <path
                  d="M 455 110 L 790 110 L 790 155"
                  fill="none"
                  stroke={t.loopFlow > 20 ? (hotGas ? '#f97316' : '#22d3ee') : '#334155'}
                  strokeWidth="4"
                  className={t.loopFlow > 20 ? 'pipe-flow-fast' : ''}
                />
                <text x="530" y="102" fill={hotGas ? '#fb923c' : '#94a3b8'} fontSize="10" fontFamily="monospace">
                  {dryerMeta.lineIn}
                </text>

                {/* Bypass V5 Line */}
                <path
                  d="M 685 110 L 685 375"
                  fill="none"
                  stroke={v.v5 && t.loopFlow > 20 ? (hotGas ? '#f97316' : '#22d3ee') : '#334155'}
                  strokeWidth="3"
                  className={v.v5 && t.loopFlow > 20 ? 'pipe-flow-fast' : ''}
                />

                {/* Dryer Outlet RGR Return Header to E-802 */}
                <path
                  d="M 790 315 L 790 375 L 545 375 L 545 315"
                  fill="none"
                  stroke={dryerReceivingGas ? (t.dryerBotTemp > 90 ? '#f59e0b' : '#22d3ee') : '#334155'}
                  strokeWidth="4"
                  className={dryerReceivingGas ? 'pipe-flow-fast' : ''}
                />
                <text x="580" y="390" fill="#94a3b8" fontSize="10" fontFamily="monospace">
                  {dryerMeta.lineOut}
                </text>

                {/* E-802 to D-802 */}
                <path
                  d="M 485 285 L 430 285"
                  fill="none"
                  stroke={t.loopFlow > 20 ? '#2dd4bf' : '#334155'}
                  strokeWidth="3.5"
                  className={t.loopFlow > 20 ? 'pipe-flow' : ''}
                />

                {/* D-802 Top to C-801 Suction & Flare PV-801 */}
                <path
                  d="M 395 215 L 395 190 L 245 190 L 245 260"
                  fill="none"
                  stroke={t.loopFlow > 20 ? '#22d3ee' : '#334155'}
                  strokeWidth="3.5"
                  className={t.loopFlow > 20 ? 'pipe-flow-fast' : ''}
                />
                {/* Flare branch */}
                <path
                  d="M 310 190 L 310 145 L 220 145"
                  fill="none"
                  stroke={v.pv801Blk && sim.controllers.pic801.mv > 5 ? '#eab308' : '#334155'}
                  strokeWidth="2.5"
                />
                <text x="175" y="148" fill="#eab308" fontSize="10" fontFamily="monospace" fontWeight="bold">TO FLARE</text>

                {/* High Steam HS to E-801 & Condensate to D-803 */}
                <path
                  d="M 425 45 L 425 85"
                  fill="none"
                  stroke={v.tv801Blk && sim.controllers.tic801.mv > 0 ? '#e879f9' : '#334155'}
                  strokeWidth="3"
                />
                <text x="380" y="40" fill="#e879f9" fontSize="10" fontFamily="monospace">HS STEAM</text>
                <path
                  d="M 455 125 L 520 125 L 520 145"
                  fill="none"
                  stroke={v.tv801Blk && sim.controllers.tic801.mv > 0 ? '#c084fc' : '#334155'}
                  strokeWidth="2.5"
                />

                {/* E-802 CW Supply & Return */}
                <path d="M 515 215 L 515 255" fill="none" stroke={v.cwV1 ? '#06b6d4' : '#334155'} strokeWidth="2.5" />
                <path d="M 515 315 L 515 345" fill="none" stroke={v.cwV2 ? '#06b6d4' : '#334155'} strokeWidth="2.5" />
                <text x="480" y="210" fill="#06b6d4" fontSize="9" fontFamily="monospace">CWS</text>
                <text x="480" y="355" fill="#06b6d4" fontSize="9" fontFamily="monospace">CWR</text>

                {/* D-802 Bottom Drain to TK-703 */}
                <path
                  d="M 395 345 L 395 425 L 485 425"
                  fill="none"
                  stroke={v.d802DrainBlk && sim.controllers.lic802.mv > 5 ? '#a855f7' : '#334155'}
                  strokeWidth="2.5"
                />
                <text x="492" y="429" fill="#c084fc" fontSize="10" fontFamily="monospace" fontWeight="bold">TO TK-703</text>

                {/* ==================== VESSELS & EQUIPMENT ==================== */}

                {/* BLOWER C-801 */}
                <g onClick={handleBlowerToggle} className="cursor-pointer">
                  <circle
                    cx="248"
                    cy="285"
                    r="26"
                    fill={sim.blowerRunning ? '#064e3b' : sim.interlockTripped ? '#7f1d1d' : '#1e293b'}
                    stroke={sim.blowerRunning ? '#10b981' : sim.interlockTripped ? '#ef4444' : '#64748b'}
                    strokeWidth="3"
                  />
                  <text x="248" y="283" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="monospace" fontWeight="bold">
                    C-801
                  </text>
                  <text x="248" y="296" textAnchor="middle" fill={sim.blowerRunning ? '#34d399' : '#94a3b8'} fontSize="9" fontFamily="monospace">
                    {sim.blowerRunning ? 'RUN' : 'STOP'}
                  </text>
                </g>

                {/* C-801 AUXILIARIES BOX (SOS & MN SEAL & BEARINGS) */}
                <rect x="20" y="330" width="245" height="125" rx="6" fill="#0f172a" stroke="#334155" />
                <text x="30" y="347" fill="#94a3b8" fontSize="10" fontFamily="monospace" fontWeight="bold">
                  C-801 AUXILIARIES (SOS / MN SEAL)
                </text>
                <g onClick={() => toggleAux('sosSupply')} className="cursor-pointer">
                  <rect x="30" y="356" width="105" height="22" rx="4" fill={aux.sosSupply ? '#065f46' : '#3f1d2e'} stroke={aux.sosSupply ? '#10b981' : '#f43f5e'} />
                  <text x="82" y="370" textAnchor="middle" fill="#fff" fontSize="9.5" fontFamily="monospace">
                    SOS: {aux.sosSupply ? 'ON' : 'OFF'}
                  </text>
                </g>
                <g onClick={() => toggleAux('mnSeal')} className="cursor-pointer">
                  <rect x="145" y="356" width="110" height="22" rx="4" fill={aux.mnSeal ? '#065f46' : '#3f1d2e'} stroke={aux.mnSeal ? '#10b981' : '#f43f5e'} />
                  <text x="200" y="370" textAnchor="middle" fill="#fff" fontSize="9.5" fontFamily="monospace">
                    MN Seal: {aux.mnSeal ? 'ON' : 'OFF'}
                  </text>
                </g>
                <g
                  onClick={() =>
                    setSim((s) => ({
                      ...s,
                      activeStrainer: s.activeStrainer === 'STR-8019' ? 'STR-8020' : 'STR-8019'
                    }))
                  }
                  className="cursor-pointer"
                >
                  <rect x="30" y="384" width="225" height="20" rx="4" fill="#1e293b" stroke="#475569" />
                  <text x="142" y="397" textAnchor="middle" fill="#38bdf8" fontSize="9.5" fontFamily="monospace">
                    Duty Strainer: {sim.activeStrainer} (Click Switch)
                  </text>
                </g>
                <text x="30" y="422" fill={t.pi804 <= 10 ? '#f87171' : '#34d399'} fontSize="10" fontFamily="monospace">
                  PI-804 (SOS): {t.pi804.toFixed(1)} kg/cm²g
                </text>
                <text x="30" y="438" fill="#cbd5e1" fontSize="10" fontFamily="monospace">
                  TI-803/804: {t.ti803.toFixed(1)}°C / {t.ti804.toFixed(1)}°C
                </text>

                {/* HEATER E-801 */}
                <circle cx="425" cy="110" r="28" fill={hotGas ? '#431407' : '#1e293b'} stroke={hotGas ? '#f97316' : '#64748b'} strokeWidth="2.5" />
                <path d="M 405 110 L 415 100 L 425 120 L 435 100 L 445 110" fill="none" stroke="#fb923c" strokeWidth="2" />
                <text x="425" y="150" textAnchor="middle" fill="#fff" fontSize="10.5" fontFamily="monospace" fontWeight="bold">E-801</text>

                {/* CONDENSATE DRUM D-803 */}
                <rect x="502" y="145" width="36" height="65" rx="14" fill="#1e293b" stroke="#64748b" strokeWidth="2" />
                <rect
                  x="505"
                  y={207 - (t.lic805 / 100) * 58}
                  width="30"
                  height={(t.lic805 / 100) * 58}
                  rx="6"
                  fill="#a855f7"
                  opacity="0.7"
                />
                <text x="520" y="223" textAnchor="middle" fill="#fff" fontSize="10" fontFamily="monospace" fontWeight="bold">D-803</text>
                <text x="558" y="175" fill={t.lic805 >= 90 || t.lic805 <= 6.3 ? '#f87171' : '#e2e8f0'} fontSize="10" fontFamily="monospace">
                  LIC-805: {t.lic805.toFixed(0)}%
                </text>

                {/* COOLER E-802 */}
                <circle cx="515" cy="285" r="28" fill="#083344" stroke="#06b6d4" strokeWidth="2.5" />
                <path d="M 495 285 L 505 275 L 515 295 L 525 275 L 535 285" fill="none" stroke="#22d3ee" strokeWidth="2" />
                <text x="558" y="282" fill="#fff" fontSize="10.5" fontFamily="monospace" fontWeight="bold">E-802</text>
                <text x="558" y="296" fill="#22d3ee" fontSize="9.5" fontFamily="monospace">PG-8007: {t.pg8007.toFixed(1)}</text>

                {/* KNOCK-OUT DRUM D-802 */}
                <rect x="360" y="215" width="70" height="130" rx="22" fill="#1e293b" stroke="#64748b" strokeWidth="2.5" />
                <rect
                  x="364"
                  y={340 - (t.lic802 / 100) * 115}
                  width="62"
                  height={(t.lic802 / 100) * 115}
                  rx="12"
                  fill="#8b5cf6"
                  opacity="0.65"
                />
                <text x="395" y="275" textAnchor="middle" fill="#fff" fontSize="12" fontFamily="monospace" fontWeight="bold">D-802</text>
                <text x="395" y="292" textAnchor="middle" fill="#cbd5e1" fontSize="9.5" fontFamily="monospace">
                  LIC-802: {t.lic802.toFixed(0)}%
                </text>
                <text x="395" y="306" textAnchor="middle" fill={t.lzi802 >= 70 ? '#f87171' : '#94a3b8'} fontSize="9.5" fontFamily="monospace">
                  LZI-802: {t.lzi802.toFixed(0)}%
                </text>

                {/* MOLECULAR SIEVE DRYER (D-703A / D-703B / D-235A) */}
                <rect
                  x="745"
                  y="155"
                  width="90"
                  height="160"
                  rx="32"
                  fill={t.dryerTopTemp > 120 ? '#431407' : '#1e293b'}
                  stroke={t.dryerTopTemp > 120 ? '#f97316' : '#38bdf8'}
                  strokeWidth="3"
                />
                {/* Molecular Sieve Bed Hatching */}
                <rect x="753" y="185" width="74" height="100" fill="#334155" opacity="0.45" stroke="#475569" strokeDasharray="3 3" />
                <text x="790" y="225" textAnchor="middle" fill="#fff" fontSize="13" fontFamily="monospace" fontWeight="bold">
                  {dryerMeta.id}
                </text>
                <text x="790" y="242" textAnchor="middle" fill="#38bdf8" fontSize="9.5" fontFamily="monospace">
                  MOL. SIEVE
                </text>
                <text x="790" y="258" textAnchor="middle" fill={t.moisturePpm <= 5 ? '#34d399' : '#fbbf24'} fontSize="9.5" fontFamily="monospace">
                  H2O: {t.moisturePpm.toFixed(1)} ppm
                </text>

                {/* Dryer Instrument Callouts */}
                <rect x="850" y="155" width="118" height="160" rx="6" fill="#0f172a" stroke="#334155" />
                <text x="858" y="173" fill="#94a3b8" fontSize="9.5" fontFamily="monospace" fontWeight="bold">DRYER TELEMETRY</text>
                <text x="858" y="193" fill="#38bdf8" fontSize="10" fontFamily="monospace">
                  {dryerMeta.pgTag}: {t.pg7402.toFixed(2)}
                </text>
                <text x="858" y="213" fill="#fb923c" fontSize="10" fontFamily="monospace">
                  {dryerMeta.topTempTag}: {t.dryerTopTemp.toFixed(1)}°C
                </text>
                <text x="858" y="233" fill="#fbbf24" fontSize="10" fontFamily="monospace">
                  {dryerMeta.botTempTag}: {t.dryerBotTemp.toFixed(1)}°C
                </text>
                <text x="858" y="255" fill="#94a3b8" fontSize="9" fontFamily="monospace">
                  PSV: {dryerMeta.psvSet}
                </text>
                <g onClick={() => toggleValve('dryerBleed')} className="cursor-pointer">
                  <rect x="858" y="272" width="102" height="24" rx="4" fill={v.dryerBleed ? '#991b1b' : '#1e293b'} stroke={v.dryerBleed ? '#f87171' : '#475569'} />
                  <text x="909" y="287" textAnchor="middle" fill="#fff" fontSize="9" fontFamily="monospace">
                    Bleed: {v.dryerBleed ? 'OPEN' : 'SHUT'}
                  </text>
                </g>

                {/* ==================== CLICKABLE FIELD VALVES ==================== */}
                {[
                  { key: 'fv801Blk', x: 115, y: 75, label: 'FV-801 Blk' },
                  { key: 'pv801Blk', x: 265, y: 145, label: 'PV-801 Blk' },
                  { key: 'tv801Blk', x: 425, y: 63, label: 'TV-801 Blk' },
                  { key: 'e801V3', x: 472, y: 125, label: 'V3 Drain' },
                  { key: 'cwV1', x: 515, y: 234, label: 'CW-V1' },
                  { key: 'cwV2', x: 515, y: 332, label: 'CW-V2' },
                  { key: 'd802DrainBlk', x: 435, y: 425, label: 'LV-802 Blk' },
                  { key: 'v5', x: 685, y: 245, label: 'V5 Bypass' },
                  { key: 'v1', x: 720, y: 110, label: 'V1 In' },
                  { key: 'v2', x: 765, y: 110, label: 'V2 In' },
                  { key: 'v3', x: 755, y: 375, label: 'V3 Out' },
                  { key: 'v4', x: 710, y: 375, label: 'V4 Out' }
                ].map((item) => {
                  const isOpen = v[item.key];
                  return (
                    <g key={item.key} onClick={() => toggleValve(item.key)} className="cursor-pointer group">
                      <rect
                        x={item.x - 12}
                        y={item.y - 10}
                        width="24"
                        height="20"
                        rx="4"
                        fill={isOpen ? '#065f46' : '#881337'}
                        stroke={isOpen ? '#34d399' : '#fb7185'}
                        strokeWidth="2"
                      />
                      <text
                        x={item.x}
                        y={item.y + 3}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize="8.5"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {isOpen ? 'O' : 'C'}
                      </text>
                      <text
                        x={item.x}
                        y={item.y - 14}
                        textAnchor="middle"
                        fill="#cbd5e1"
                        fontSize="8.5"
                        fontFamily="monospace"
                      >
                        {item.label}
                      </text>
                    </g>
                  );
                })}

                {/* CW VENT BUTTON */}
                <g onClick={() => toggleValve('cwVent')} className="cursor-pointer">
                  <rect x="558" y="232" width="76" height="20" rx="4" fill={v.cwVent ? '#0e7490' : '#1e293b'} stroke="#22d3ee" />
                  <text x="596" y="245" textAnchor="middle" fill="#fff" fontSize="8.5" fontFamily="monospace">
                    CW Vent: {v.cwVent ? 'OPEN' : 'SHUT'}
                  </text>
                </g>

                {/* SPECTACLE BLINDS (V2 Inlet & V3 Outlet) */}
                <g onClick={() => toggleValve('sbInOpen')} className="cursor-pointer">
                  <rect
                    x="742"
                    y="128"
                    width="96"
                    height="20"
                    rx="4"
                    fill={v.sbInOpen ? '#064e3b' : '#4c0519'}
                    stroke={v.sbInOpen ? '#10b981' : '#f43f5e'}
                  />
                  <text x="790" y="141" textAnchor="middle" fill="#fff" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                    SB-V2: {v.sbInOpen ? 'OPEN' : 'BLIND'}
                  </text>
                </g>

                <g onClick={() => toggleValve('sbOutOpen')} className="cursor-pointer">
                  <rect
                    x="742"
                    y="324"
                    width="96"
                    height="20"
                    rx="4"
                    fill={v.sbOutOpen ? '#064e3b' : '#4c0519'}
                    stroke={v.sbOutOpen ? '#10b981' : '#f43f5e'}
                  />
                  <text x="790" y="337" textAnchor="middle" fill="#fff" fontSize="8.5" fontFamily="monospace" fontWeight="bold">
                    SB-V3: {v.sbOutOpen ? 'OPEN' : 'BLIND'}
                  </text>
                </g>

                {/* KEY LIVE PROCESS CALLOUTS ON P&ID */}
                <g transform="translate(55, 25)">
                  <text x="0" y="12" fill="#38bdf8" fontSize="10" fontFamily="monospace" fontWeight="bold">
                    FIC-801: {t.mnFlow.toFixed(1)} Nm³/h
                  </text>
                </g>
                <g transform="translate(275, 225)">
                  <text x="0" y="12" fill={t.pzi815 >= 4.0 ? '#f87171' : '#34d399'} fontSize="10" fontFamily="monospace" fontWeight="bold">
                    PZI-815: {t.pzi815.toFixed(2)}
                  </text>
                </g>
                <g transform="translate(360, 175)">
                  <text x="0" y="10" fill={t.pic801 > 4.0 ? '#f87171' : '#fbbf24'} fontSize="10" fontFamily="monospace" fontWeight="bold">
                    PIC-801: {t.pic801.toFixed(2)}
                  </text>
                </g>
                <g transform="translate(465, 85)">
                  <text x="0" y="10" fill={t.tic801 >= 250 ? '#f87171' : '#fb923c'} fontSize="10" fontFamily="monospace" fontWeight="bold">
                    TIC-801: {t.tic801.toFixed(1)}°C
                  </text>
                </g>
                <g transform="translate(558, 315)">
                  <text x="0" y="10" fill={t.ti802 >= 50 ? '#f87171' : '#22d3ee'} fontSize="10" fontFamily="monospace" fontWeight="bold">
                    TI-802: {t.ti802.toFixed(1)}°C
                  </text>
                </g>
              </svg>
            </div>
          </div>

          {/* BOARDMAN (BM) DCS CONTROLLER FACEPLATES */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Boardman (BM) — DCS Control Loops Faceplates
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                Click chọn vòng điều khiển để chỉnh Mode (AUTO/MAN), SP và MV%
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {[
                { key: 'tic801', tag: 'TIC-801', desc: 'E-801 Out Temp', pv: t.tic801.toFixed(1), unit: '°C', min: 0, max: 260, step: 5 },
                { key: 'pic801', tag: 'PIC-801', desc: 'D-802 Pressure', pv: t.pic801.toFixed(2), unit: 'kg/cm²g', min: 0, max: 4.5, step: 0.1 },
                { key: 'fic801', tag: 'FIC-801', desc: 'MN2 Make-up', pv: t.mnFlow.toFixed(1), unit: 'Nm³/h', min: 0, max: 180, step: 10 },
                { key: 'lic802', tag: 'LIC-802', desc: 'D-802 Level', pv: t.lic802.toFixed(1), unit: '%', min: 0, max: 100, step: 5 },
                { key: 'lic805', tag: 'LIC-805', desc: 'D-803 Level', pv: t.lic805.toFixed(1), unit: '%', min: 0, max: 100, step: 5 }
              ].map((loop) => {
                const ctrl = sim.controllers[loop.key];
                const isSelected = selectedCtrl === loop.tag;
                return (
                  <div
                    key={loop.key}
                    onClick={() => setSelectedCtrl(loop.tag)}
                    className={`rounded-lg p-2.5 border transition cursor-pointer ${
                      isSelected
                        ? 'bg-slate-800/90 border-cyan-500 shadow-lg shadow-cyan-950/30'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold text-white">{loop.tag}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateController(loop.key, 'mode', ctrl.mode === 'AUTO' ? 'MAN' : 'AUTO');
                        }}
                        className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                          ctrl.mode === 'AUTO'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                            : 'bg-amber-950 text-amber-400 border border-amber-700'
                        }`}
                      >
                        {ctrl.mode}
                      </button>
                    </div>
                    <div className="text-[10px] text-slate-400 mb-1.5 truncate">{loop.desc}</div>

                    <div className="bg-slate-900 rounded p-1.5 font-mono text-xs space-y-1 border border-slate-800">
                      <div className="flex justify-between">
                        <span className="text-slate-400">PV:</span>
                        <span className="text-cyan-300 font-bold">{loop.pv}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">SP:</span>
                        <input
                          type="number"
                          step={loop.step}
                          min={loop.min}
                          max={loop.max}
                          value={ctrl.sp}
                          onChange={(e) => updateController(loop.key, 'sp', Number(e.target.value))}
                          className="w-16 bg-slate-950 border border-slate-700 rounded px-1 text-right text-emerald-300 text-xs"
                        />
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400">MV%:</span>
                        <input
                          type="number"
                          step={5}
                          min={0}
                          max={100}
                          disabled={ctrl.mode === 'AUTO'}
                          value={Math.round(ctrl.mv)}
                          onChange={(e) => updateController(loop.key, 'mv', Number(e.target.value))}
                          className="w-16 bg-slate-950 border border-slate-700 rounded px-1 text-right text-amber-300 text-xs disabled:opacity-60"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: SOP EXECUTION / DEVIATION TRAINER / LIVE TREND (4 COLS) */}
        <div className="xl:col-span-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
          {/* TABS */}
          <div className="grid grid-cols-3 border-b border-slate-800 bg-slate-950/60 text-xs font-mono">
            <button
              onClick={() => setActiveTab('SOP')}
              className={`py-2.5 font-bold border-b-2 transition ${
                activeTab === 'SOP' ? 'border-cyan-400 text-cyan-300 bg-slate-900' : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              SOP STEPS (9)
            </button>
            <button
              onClick={() => setActiveTab('FAULTS')}
              className={`py-2.5 font-bold border-b-2 transition ${
                activeTab === 'FAULTS' ? 'border-amber-400 text-amber-300 bg-slate-900' : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              SỰ CỐ & XỬ LÝ
            </button>
            <button
              onClick={() => setActiveTab('TREND')}
              className={`py-2.5 font-bold border-b-2 transition ${
                activeTab === 'TREND' ? 'border-emerald-400 text-emerald-300 bg-slate-900' : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              LIVE TREND
            </button>
          </div>

          {/* TAB 1: LINKED SOP CHECKLIST */}
          {activeTab === 'SOP' && (
            <div className="p-3 overflow-y-auto space-y-2.5 max-h-[720px]">
              <div className="text-[11px] text-slate-400 bg-slate-950 p-2 rounded border border-slate-800">
                Hệ thống tự động kiểm tra điều kiện thực tế trên P&ID & DCS. Bạn có thể tự thao tác hoặc bấm <strong className="text-cyan-300">Auto-Set</strong> từng bước để mô phỏng nhanh.
              </div>

              {SOP_WORKFLOW_STEPS.map((step) => {
                const passed = step.check(sim);
                return (
                  <div
                    key={step.id}
                    className={`p-2.5 rounded-lg border transition ${
                      passed
                        ? 'bg-emerald-950/20 border-emerald-700/60'
                        : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${
                            step.phase === 'START-UP'
                              ? 'bg-cyan-950 text-cyan-300'
                              : step.phase.includes('REGEN')
                              ? 'bg-orange-950 text-orange-300'
                              : 'bg-purple-950 text-purple-300'
                          }`}
                        >
                          {step.phase}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">[{step.role}]</span>
                      </div>

                      <button
                        onClick={() => applySopPreset(step.id)}
                        className="text-[10px] font-mono bg-slate-800 hover:bg-cyan-700 text-cyan-200 px-2 py-0.5 rounded flex items-center gap-1 shrink-0"
                      >
                        <FastForward className="w-3 h-3" /> Auto-Set
                      </button>
                    </div>

                    <h3 className="text-xs font-bold text-slate-100 mt-1.5 flex items-center gap-1.5">
                      {passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <span className="w-3.5 h-3.5 rounded-full border border-slate-600 inline-block shrink-0" />
                      )}
                      {step.title}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{step.detail}</p>
                    <div className="text-[10px] font-mono text-slate-500 mt-1">Ref: {step.sop}</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: DEVIATION ANALYSIS & FAULT INJECTION */}
          {activeTab === 'FAULTS' && (
            <div className="p-3 overflow-y-auto space-y-2.5 max-h-[720px]">
              <div className="text-[11px] text-amber-200/90 bg-amber-950/30 p-2.5 rounded border border-amber-800/50">
                <strong>Mô phỏng tình huống bất thường (Section 8 - HD-W-8200-04-001):</strong> Kích hoạt lỗi để kiểm tra phản ứng của FO/BM trước khi kích hoạt liên động dừng khẩn cấp ESD.
              </div>

              {DEVIATION_SCENARIOS.map((sc) => {
                const isActive = sim.activeFault === sc.id;
                return (
                  <div
                    key={sc.id}
                    onClick={() => setSim((s) => ({ ...s, activeFault: sc.id }))}
                    className={`p-3 rounded-lg border cursor-pointer transition ${
                      isActive
                        ? 'bg-amber-950/40 border-amber-500'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{sc.name}</span>
                      {isActive && (
                        <span className="text-[10px] font-mono bg-amber-500 text-slate-950 font-bold px-1.5 py-0.5 rounded">
                          ACTIVE
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-rose-300 mt-1.5">
                      <strong>Hiện tượng:</strong> {sc.symptom}
                    </p>
                    <p className="text-[11px] text-emerald-300 mt-1">
                      <strong>Xử lý chuẩn SOP:</strong> {sc.action}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 3: REAL-TIME TELEMETRY TREND */}
          {activeTab === 'TREND' && (
            <div className="p-3 flex flex-col gap-3">
              <div className="text-xs font-bold text-slate-200">
                Biểu đồ nhiệt độ & áp suất tái sinh thời gian thực
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-2">
                <svg viewBox="0 0 360 200" className="w-full h-48">
                  <line x1="30" y1="20" x2="30" y2="180" stroke="#334155" />
                  <line x1="30" y1="180" x2="350" y2="180" stroke="#334155" />
                  <text x="4" y="25" fill="#64748b" fontSize="9" fontFamily="monospace">250°C</text>
                  <text x="4" y="102" fill="#64748b" fontSize="9" fontFamily="monospace">125°C</text>
                  <text x="10" y="180" fill="#64748b" fontSize="9" fontFamily="monospace">0°C</text>

                  {sim.history.length > 1 && (
                    <>
                      {/* TIC-801 */}
                      <polyline
                        fill="none"
                        stroke="#f97316"
                        strokeWidth="2"
                        points={sim.history
                          .map((pt, i) => {
                            const x = 30 + (i / 59) * 320;
                            const y = 180 - Math.min(250, pt.tic801) * (160 / 250);
                            return `${x},${y}`;
                          })
                          .join(' ')}
                      />
                      {/* Top Bed Temp */}
                      <polyline
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="2"
                        points={sim.history
                          .map((pt, i) => {
                            const x = 30 + (i / 59) * 320;
                            const y = 180 - Math.min(250, pt.topTemp) * (160 / 250);
                            return `${x},${y}`;
                          })
                          .join(' ')}
                      />
                      {/* Bottom Bed Temp */}
                      <polyline
                        fill="none"
                        stroke="#34d399"
                        strokeWidth="2"
                        points={sim.history
                          .map((pt, i) => {
                            const x = 30 + (i / 59) * 320;
                            const y = 180 - Math.min(250, pt.botTemp) * (160 / 250);
                            return `${x},${y}`;
                          })
                          .join(' ')}
                      />
                    </>
                  )}
                </svg>

                <div className="flex flex-wrap gap-3 text-[10px] font-mono mt-2 px-2">
                  <span className="text-orange-400">■ TIC-801 ({t.tic801.toFixed(1)}°C)</span>
                  <span className="text-sky-400">■ {dryerMeta.topTempTag} ({t.dryerTopTemp.toFixed(1)}°C)</span>
                  <span className="text-emerald-400">■ {dryerMeta.botTempTag} ({t.dryerBotTemp.toFixed(1)}°C)</span>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs space-y-1.5">
                <div className="text-slate-400 font-bold mb-1">TÓM TẮT THÔNG SỐ CỤM:</div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Lưu lượng tuần hoàn RGS:</span>
                  <span className="text-cyan-300 font-bold">{t.loopFlow.toFixed(0)} Nm³/h</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Áp suất hút / đẩy C-801:</span>
                  <span className="text-emerald-300 font-bold">
                    {t.pic801.toFixed(2)} / {t.pzi815.toFixed(2)} kg/cm²g
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Hàm ẩm Hexane/Butene-1 đầu ra:</span>
                  <span className={t.moisturePpm <= 5 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                    {t.moisturePpm.toFixed(2)} ppm (Target &lt; 5 ppm)
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
